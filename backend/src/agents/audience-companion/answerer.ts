/**
 * answerer.ts — Audience Companion Gemini boundary
 *
 * All calls to Gemini and all response parsing happen here and nowhere else
 * in the Companion. The pack-builder and classifier are Gemini-free.
 *
 * Responsibilities:
 *   1. Build the Gemini user turn from the pack
 *   2. Call Gemini with responseMimeType: "application/json", 30s timeout
 *   3. Parse and Zod-validate the raw response
 *   4. Retry once on parse failure with the same pack and question
 *   5. Guard factsUsed: strip any ID not in the pack; downgrade epistemicState
 *      to "partial" if IDs were stripped
 *   6. Return a safe fallback on second failure — never throws
 */

import { GoogleGenAI } from "@google/genai";
import { config } from "../../config/index.js";
import {
  RawGeminiAnswerSchema,
  type CompanionPack,
  type CompanionAnswer,
  type RawGeminiAnswer,
} from "./types.js";
import { SYSTEM_PROMPT, buildUserTurn } from "./prompt.js";
import { GEMINI_MODEL } from "../../config/models.js";

// =============================================================================
// Constants
// =============================================================================

const MODEL = GEMINI_MODEL;
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

/**
 * Safe fallback returned when both Gemini attempts fail.
 * The answer is honest about the failure without exposing internal details
 * to the reader. boundary is filled in by answerQuestion() at call time.
 */
function makeFallbackAnswer(
  boundary: CompanionPack["boundary"],
  detail: string,
): CompanionAnswer {
  return {
    answer:
      "I wasn't able to process that question right now. Please try again.",
    epistemicState: "unknown",
    factsUsed: [],
    notKnownAspects: [
      `Companion reasoning failed: ${detail}`,
    ],
    boundary,
    boundaryEnforced: true,
  };
}

// =============================================================================
// Gemini client
// =============================================================================

const genai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

// =============================================================================
// Public entry point
// =============================================================================

/**
 * answerQuestion
 *
 * The single public entry point. Takes an assembled CompanionPack and the
 * viewer's question; returns a validated CompanionAnswer.
 *
 * Never throws. On unrecoverable failure, returns a safe fallback.
 */
export async function answerQuestion(
  pack: CompanionPack,
  question: string,
): Promise<CompanionAnswer> {
  const userTurn = buildUserTurn(pack, question);
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;

    try {
      raw = await callGemini(userTurn);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) continue;
      return makeFallbackAnswer(
        pack.boundary,
        `Gemini call failed after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`,
      );
    }

    const result = parseAndValidate(raw);

    if (result.ok) {
      return guardFactsUsed(result.data, pack);
    }

    lastError = result.error;
    if (attempt < MAX_ATTEMPTS) continue;

    // Both parse attempts failed.
    return makeFallbackAnswer(
      pack.boundary,
      `Response validation failed after ${MAX_ATTEMPTS} attempts. ` +
        `Last error: ${lastError}. Raw (truncated): ${raw!.slice(0, 200)}`,
    );
  }

  // Unreachable — loop always returns.
  return makeFallbackAnswer(pack.boundary, "Unexpected loop exit.");
}

// =============================================================================
// callGemini
// =============================================================================

/**
 * callGemini
 *
 * Single Gemini request with a hard 30-second timeout via Promise.race.
 * The system prompt is sent as a primed exchange (user → model ACK) before
 * the actual user turn, matching the pattern used by the Guardian reasoner.
 *
 * responseMimeType: "application/json" constrains the model to valid JSON.
 *
 * Throws on timeout or empty response — caller handles retries.
 */
export async function callGemini(userTurn: string): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(`Gemini request timed out after ${TIMEOUT_MS}ms`),
        ),
      TIMEOUT_MS,
    ),
  );

  const geminiPromise = genai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: SYSTEM_PROMPT }],
      },
      {
        role: "model",
        parts: [{ text: "Understood. I am ready to answer questions about this story." }],
      },
      {
        role: "user",
        parts: [{ text: userTurn }],
      },
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

// =============================================================================
// parseAndValidate
// =============================================================================

type ParseResult =
  | { ok: true; data: RawGeminiAnswer }
  | { ok: false; error: string };

/**
 * parseAndValidate
 *
 * JSON.parse then Zod validation against RawGeminiAnswerSchema.
 * Returns a discriminated union — no nested try/catch at the call site.
 */
export function parseAndValidate(raw: string): ParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = RawGeminiAnswerSchema.safeParse(parsed);

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

// =============================================================================
// guardFactsUsed
// =============================================================================

/**
 * guardFactsUsed
 *
 * Validates that every ID in factsUsed exists in the pack.
 * Strips any ID that is not present.
 * If any IDs were stripped, downgrades epistemicState to "partial".
 *
 * This is a deterministic post-processing rule enforced in code, not in the
 * prompt. Gemini cannot cite a fact that was not supplied — this guard makes
 * that invariant hard rather than advisory.
 *
 * Also maps the raw Gemini answer to a CompanionAnswer, adding the boundary
 * and boundaryEnforced fields that Gemini does not produce.
 */
export function guardFactsUsed(
  raw: RawGeminiAnswer,
  pack: CompanionPack,
): CompanionAnswer {
  const validIds = new Set(pack.facts.map((f) => f.factId));

  const strippedIds: string[] = [];
  const guardedFactsUsed = raw.factsUsed.filter((id) => {
    if (validIds.has(id)) return true;
    strippedIds.push(id);
    return false;
  });

  // Downgrade epistemic state if we had to strip IDs — Gemini cited something
  // outside the pack, which means its answer may be partially unsupported.
  let epistemicState = raw.epistemicState;

  if (strippedIds.length > 0 && epistemicState === 'known') {
    epistemicState = 'partial';
  }

  const factsUsed = epistemicState === 'unknown' ? [] : guardedFactsUsed;

  const notKnownAspects =
    strippedIds.length > 0
      ? [
          ...raw.notKnownAspects,
          `${strippedIds.length} unsupported fact reference(s) were removed because they were not present in the retrieved story memory.`,
        ]
      : raw.notKnownAspects;

  return {
    answer: raw.answer,
    epistemicState,
    factsUsed,
    notKnownAspects,
    boundary: pack.boundary,
    boundaryEnforced: true,
  };
}
