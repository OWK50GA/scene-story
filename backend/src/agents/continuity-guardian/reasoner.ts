/**
 * reasoner.ts
 *
 * Calls Gemini with a Guardian dossier and returns a validated verdict.
 *
 * Responsibilities:
 *   1. Build the prompt from the dossier
 *   2. Call Gemini with responseMimeType: "application/json", 30s timeout
 *   3. Parse and validate the response against GuardianVerdictSchema
 *   4. Retry once on validation failure with the same dossier
 *   5. On second failure: return ambiguous rather than throwing — the
 *      Guardian pass must not crash because one candidate is unparseable
 *   6. Apply the confidence downgrade rule in code after Gemini returns
 *
 * The reasoner has no ClickHouse access and no side effects.
 * All writes (writeFinding, updateClaimValidTo) happen in within-unit.ts.
 */

import { GoogleGenAI } from "@google/genai";
import { config } from "../../config/index.js";
import {
  GuardianVerdictSchema,
  type GuardianVerdict,
} from "../../types/index.js";
import { STATIC_SYSTEM_PROMPT, buildDossierPrompt } from "./prompt.js";
import type { EntityDossier } from "./dossier.js";

// =============================================================================
// Constants
// =============================================================================

const MODEL = "gemini-3.5-flash";
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

// Confidence threshold below which a "confirmed" verdict is downgraded.
// Defined here so it is co-located with the rule that enforces it.
const CONFIDENCE_DOWNGRADE_THRESHOLD = 0.7;

// Fallback verdict used when both Gemini attempts fail to produce valid JSON.
// We never let a parse failure crash the Guardian pass — ambiguous is the
// honest answer when evidence cannot be evaluated.
const FALLBACK_VERDICT: GuardianVerdict = {
  conflictType: "ambiguous",
  severity: "low",
  explanation:
    "Guardian reasoning could not be completed: Gemini returned an unparseable response on both attempts. The transition has been flagged as ambiguous pending manual review.",
  resolutionSuggestion:
    "Re-run the Guardian pass after verifying the Gemini API key and model availability.",
};

// =============================================================================
// Gemini client
// =============================================================================

const genai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

// =============================================================================
// Public API
// =============================================================================

/**
 * reasonAboutDossier
 *
 * The single public entry point. Takes a fully assembled EntityDossier,
 * sends it to Gemini, and returns a validated GuardianVerdict.
 *
 * Never throws. On unrecoverable failure, returns FALLBACK_VERDICT.
 */
export async function reasonAboutDossier(
  dossier: EntityDossier,
): Promise<GuardianVerdict> {
  const userTurn = buildDossierPrompt(dossier);

  let lastRaw = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;

    try {
      raw = await callGemini(userTurn);
    } catch (err) {
      lastRaw = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) continue;
      // Both network attempts failed — return fallback
      return {
        ...FALLBACK_VERDICT,
        explanation:
          `Guardian reasoning failed: Gemini call error after ${MAX_ATTEMPTS} attempts. ` +
          `Last error: ${lastRaw}`,
      };
    }

    lastRaw = raw;

    const result = parseAndValidate(raw);

    if (result.ok) {
      return applyConfidenceDowngrade(result.data, dossier);
    }

    // Validation failed — retry or fall back
    if (attempt < MAX_ATTEMPTS) continue;

    // Both parse attempts failed — return fallback with parse error detail
    return {
      ...FALLBACK_VERDICT,
      explanation:
        `Guardian reasoning could not be completed: schema validation failed ` +
        `after ${MAX_ATTEMPTS} attempts. Last parse error: ${result.error}. ` +
        `Raw response (truncated): ${lastRaw.slice(0, 200)}`,
    };
  }

  // Unreachable — loop always returns
  return FALLBACK_VERDICT;
}

// =============================================================================
// Confidence downgrade rule
// =============================================================================

/**
 * applyConfidenceDowngrade
 *
 * If Gemini returned "confirmed" but either candidate claim has confidence
 * <= CONFIDENCE_DOWNGRADE_THRESHOLD, downgrade to "ambiguous".
 *
 * This is a deterministic post-processing rule, not a prompt instruction.
 * Enforcing it in code means it cannot be bypassed by a model that ignores
 * the instruction.
 */
function applyConfidenceDowngrade(
  verdict: GuardianVerdict,
  dossier: EntityDossier,
): GuardianVerdict {
  if (verdict.conflictType !== "confirmed") return verdict;

  const { claimA, claimB } = dossier.candidateTransition;

  if (
    claimA.confidence <= CONFIDENCE_DOWNGRADE_THRESHOLD ||
    claimB.confidence <= CONFIDENCE_DOWNGRADE_THRESHOLD
  ) {
    return {
      ...verdict,
      conflictType: "ambiguous",
      explanation:
        verdict.explanation +
        ` [Downgraded from confirmed: claim confidence below threshold ` +
        `(claimA=${claimA.confidence.toFixed(2)}, claimB=${claimB.confidence.toFixed(2)}, ` +
        `threshold=${CONFIDENCE_DOWNGRADE_THRESHOLD})]`,
    };
  }

  return verdict;
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * callGemini
 *
 * Single Gemini request with a hard 30-second timeout.
 * The system prompt is sent as the first user turn before the dossier.
 * responseMimeType: "application/json" constrains the model to valid JSON.
 *
 * Throws on timeout or empty response.
 */
async function callGemini(userTurn: string): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Gemini request timed out after ${TIMEOUT_MS}ms`)),
      TIMEOUT_MS,
    ),
  );

  const geminiPromise = genai.models.generateContent({
    model: MODEL,
    contents: [
      // System context first, then the dossier as a separate user turn.
      // This mirrors the Story Analyst pattern and keeps the static prompt
      // out of the per-candidate content so it could be cached in future.
      { role: "user", parts: [{ text: STATIC_SYSTEM_PROMPT }] },
      { role: "model", parts: [{ text: "Understood. I am ready to investigate." }] },
      { role: "user", parts: [{ text: userTurn }] },
    ],
    config: {
      responseMimeType: "application/json",
    },
  });

  const response = await Promise.race([geminiPromise, timeoutPromise]);

  const text = response.text;

  if (!text || text.trim() === "") {
    throw new Error("Gemini returned an empty response");
  }

  return text.trim();
}

/**
 * parseAndValidate
 *
 * Attempts JSON.parse then Zod validation against GuardianVerdictSchema.
 * Returns a discriminated union so the caller avoids nested try/catch.
 */
type ParseResult =
  | { ok: true; data: GuardianVerdict }
  | { ok: false; error: string };

function parseAndValidate(raw: string): ParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = GuardianVerdictSchema.safeParse(parsed);

  if (result.success) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    error: result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; "),
  };
}
