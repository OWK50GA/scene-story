/**
 * temporal.ts
 *
 * Resolves the temporal ordering between two story units.
 *
 * Used by cross-unit.ts before building a dossier for any cross-unit
 * candidate pair. The result is stored in the dossier's temporalRelation
 * field and rendered into the Guardian's prompt.
 *
 * Algorithm — 4 branches, tried in order:
 *
 *   Branch 1 — Both units have precise in-universe dates.
 *              Compare inUniverseDateStart numerically. No Gemini, no write.
 *
 *   Branch 2 — A stored relation already exists in temporal_relations.
 *              Return the cached result. Gemini is never called twice for the
 *              same pair.
 *
 *   Branch 3 — No cache, no precise dates. Ask Gemini.
 *              Build a short prompt from period labels, any available dates,
 *              and release order. Parse the response. Store the result before
 *              returning so the next call hits Branch 2.
 *
 *   Branch 4 — Gemini fails or returns something unparseable.
 *              Treat as indeterminate. Store indeterminate so we do not
 *              call Gemini again for the same pair. Return indeterminate.
 *
 * The cross-unit pass writes an ambiguous finding immediately when
 * it receives indeterminate — the Guardian reasoning step is skipped.
 */

import { GoogleGenAI } from "@google/genai";
import { config } from "../../config/index.js";
import {
  getStoryUnit,
  getTemporalRelation,
  writeTemporalRelation,
} from "../../mcp/clickhouse/operations.js";
import { log } from "../../observability/logger.js";
import type { TemporalRelationType } from "../../types/index.js";
import { GEMINI_MODEL } from "../../config/models.js";

// =============================================================================
// Constants
// =============================================================================

const MODEL = GEMINI_MODEL;
const TIMEOUT_MS = 30_000;

// The four values Gemini is allowed to return. Anything else is treated as
// indeterminate — we do not let an unexpected string propagate.
const VALID_RELATIONS = new Set<string>([
  "before",
  "after",
  "overlapping",
  "indeterminate",
]);

// =============================================================================
// Gemini client
// =============================================================================

const genai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

// =============================================================================
// Public API
// =============================================================================

/**
 * resolveTemporalOrder
 *
 * Returns the temporal relation of unitA relative to unitB:
 *   "before"        — unitA is set earlier in the story world than unitB
 *   "after"         — unitA is set later
 *   "overlapping"   — the two units share in-universe time
 *   "indeterminate" — cannot be determined; cross-unit pass forces ambiguous
 *
 * Never throws. On any unrecoverable error, returns "indeterminate" and
 * attempts to store that so we do not retry unnecessarily.
 */
export async function resolveTemporalOrder(
  unitAId: string,
  unitBId: string,
  universeId: string,
): Promise<TemporalRelationType> {
  // ── Branch 1: both units have precise dates ────────────────────────────────
  // Load both units. We need their data for Branches 1 and 3 either way,
  // so fetch them upfront in parallel.
  let unitA;
  let unitB;
  try {
    [unitA, unitB] = await Promise.all([
      getStoryUnit(unitAId),
      getStoryUnit(unitBId),
    ]);
  } catch (err) {
    log({
      agent: "guardian",
      universeId,
      eventType: "temporal_resolution_load_failed",
      status: "failure",
      detail: {
        unitAId,
        unitBId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return "indeterminate";
  }

  if (
    unitA.inUniverseDateStart !== null &&
    unitB.inUniverseDateStart !== null
  ) {
    const relation: TemporalRelationType =
      unitA.inUniverseDateStart < unitB.inUniverseDateStart
        ? "before"
        : unitA.inUniverseDateStart > unitB.inUniverseDateStart
          ? "after"
          : "overlapping"; // same start year — treat as overlapping

    log({
      agent: "guardian",
      universeId,
      eventType: "temporal_resolution_precise",
      status: "success",
      detail: {
        unitAId,
        unitBId,
        dateA: unitA.inUniverseDateStart,
        dateB: unitB.inUniverseDateStart,
        relation,
      },
    });

    return relation;
  }

  // ── Branch 2: cached relation exists ──────────────────────────────────────
  try {
    const cached = await getTemporalRelation(universeId, unitAId, unitBId);
    if (cached !== null) {
      // The table stores the relation from the perspective of the
      // lexicographically smaller unit ID as "unit A". If the caller passed
      // unitAId as the larger ID, the stored relation is from the other
      // perspective and must be flipped.
      const relation = flipIfNeeded(cached.relation, unitAId, unitBId);

      log({
        agent: "guardian",
        universeId,
        eventType: "temporal_resolution_cached",
        status: "success",
        detail: { unitAId, unitBId, relation },
      });

      return relation;
    }
  } catch (err) {
    // Cache miss due to query error — fall through to Gemini.
    log({
      agent: "guardian",
      universeId,
      eventType: "temporal_cache_lookup_failed",
      status: "failure",
      detail: {
        unitAId,
        unitBId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }

  // ── Branch 3: ask Gemini ───────────────────────────────────────────────────
  let relation: TemporalRelationType = "indeterminate";
  let reasoning = "Gemini was not called or did not return a usable result.";

  try {
    const geminiResult = await askGeminiForTemporalOrder(unitA, unitB);
    relation = geminiResult.relation;
    reasoning = geminiResult.reasoning;

    log({
      agent: "guardian",
      universeId,
      eventType: "temporal_resolution_gemini",
      status: "success",
      detail: { unitAId, unitBId, relation, reasoning },
    });
  } catch (err) {
    // Branch 4: Gemini failed. Store indeterminate and return.
    reasoning = `Gemini call failed: ${err instanceof Error ? err.message : String(err)}`;

    log({
      agent: "guardian",
      universeId,
      eventType: "temporal_resolution_gemini_failed",
      status: "failure",
      detail: { unitAId, unitBId, error: reasoning },
    });
  }

  // Store the result (whether from Gemini or fallback indeterminate) so
  // subsequent calls for the same pair hit Branch 2 instead.
  try {
    await writeTemporalRelation({
      unitAId,
      unitBId,
      universeId,
      relation,
      reasoning,
    });
  } catch (err) {
    // Write failure is non-fatal — we still return the relation we computed.
    log({
      agent: "guardian",
      universeId,
      eventType: "temporal_relation_write_failed",
      status: "failure",
      detail: {
        unitAId,
        unitBId,
        relation,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }

  return relation;
}

// =============================================================================
// Gemini temporal ordering call
// =============================================================================

type GeminiTemporalResult = {
  relation: TemporalRelationType;
  reasoning: string;
};

/**
 * askGeminiForTemporalOrder
 *
 * Builds a compact prompt from the two story units' period labels,
 * any available date starts, and release order. Asks Gemini to classify
 * the temporal relationship. Parses the response strictly — any value
 * outside the four allowed enum strings is treated as indeterminate.
 *
 * Throws on network failure or timeout so the caller can handle Branch 4.
 */
async function askGeminiForTemporalOrder(
  unitA: Awaited<ReturnType<typeof getStoryUnit>>,
  unitB: Awaited<ReturnType<typeof getStoryUnit>>,
): Promise<GeminiTemporalResult> {
  const dateA =
    unitA.inUniverseDateStart !== null
      ? String(unitA.inUniverseDateStart)
      : "not specified";

  const dateB =
    unitB.inUniverseDateStart !== null
      ? String(unitB.inUniverseDateStart)
      : "not specified";

  const prompt = `\
You are determining the temporal relationship between two story units in a shared fictional universe.

Story Unit A:
  Title:          ${unitA.title}
  In-universe period: ${unitA.inUniversePeriod}
  In-universe date start: ${dateA}
  Release order:  ${unitA.releaseOrder}

Story Unit B:
  Title:          ${unitB.title}
  In-universe period: ${unitB.inUniversePeriod}
  In-universe date start: ${dateB}
  Release order:  ${unitB.releaseOrder}

Determine whether the in-universe events of Story Unit A occur BEFORE, AFTER, or OVERLAPPING with those of Story Unit B.

If the relationship cannot be determined from the available information, respond with INDETERMINATE.

Respond with exactly one JSON object. No markdown. No explanation outside the JSON.

{
  "relation": "before" | "after" | "overlapping" | "indeterminate",
  "reasoning": "One concise sentence explaining the basis for this classification."
}`;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(`Gemini temporal request timed out after ${TIMEOUT_MS}ms`),
        ),
      TIMEOUT_MS,
    ),
  );

  const geminiPromise = genai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { responseMimeType: "application/json" },
  });

  const response = await Promise.race([geminiPromise, timeoutPromise]);

  const text = response.text?.trim() ?? "";
  if (!text) throw new Error("Gemini returned an empty response");

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).relation !== "string" ||
    typeof (parsed as Record<string, unknown>).reasoning !== "string"
  ) {
    throw new Error(
      `Gemini response missing required fields: ${text.slice(0, 200)}`,
    );
  }

  const raw = parsed as { relation: string; reasoning: string };

  const relation: TemporalRelationType = VALID_RELATIONS.has(raw.relation)
    ? (raw.relation as TemporalRelationType)
    : "indeterminate";

  return { relation, reasoning: raw.reasoning };
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * flipIfNeeded
 *
 * The temporal_relations table always stores the row with the lexicographically
 * smaller unit ID as "unit_a". The stored relation is therefore always from
 * the perspective of that smaller ID.
 *
 * If the caller passed unitAId as the LARGER of the two IDs, the stored
 * relation describes "smaller → larger" but the caller wants "larger → smaller",
 * so "before" becomes "after" and vice versa. Overlapping and indeterminate
 * are symmetric and do not flip.
 */
function flipIfNeeded(
  stored: TemporalRelationType,
  callerUnitAId: string,
  callerUnitBId: string,
): TemporalRelationType {
  // If callerUnitAId is lexicographically smaller, the stored relation already
  // reflects the caller's perspective — no flip needed.
  if (callerUnitAId < callerUnitBId) return stored;

  // callerUnitAId is the larger ID, so the stored perspective is reversed.
  if (stored === "before") return "after";
  if (stored === "after") return "before";
  return stored; // overlapping, indeterminate — symmetric
}
