/**
 * types.ts — Audience Companion private types
 *
 * All types and Zod schemas that are internal to the Companion agent.
 * Nothing outside the audience-companion directory should import from here.
 * The public contract is CompanionAnswer, which agent.ts re-exports.
 *
 * Three concerns are expressed here:
 *   1. The context pack that the pack-builder assembles and answerer consumes
 *   2. The answer the Companion returns to callers
 *   3. The raw Gemini response shape, validated before the factsUsed guard runs
 */

import { z } from "zod";
import type { SpoilerBoundaryEntry } from "../../types/index.js";

// =============================================================================
// Question mode
// =============================================================================

/**
 * The retrieval strategy determined by the classifier.
 *
 * - current_state  default; latest claim per entity+property, deduped
 * - historical     full claim chain including superseded; used for causal questions
 * - summary        all events + high-confidence claims; used for catch-up questions
 *
 * The mode controls what data goes into the pack.
 * The system prompt encodes all nine abilities regardless of mode.
 */
export type QuestionMode = "current_state" | "historical" | "summary";

// =============================================================================
// Context pack — what the pack-builder assembles
// =============================================================================

/**
 * A single fact inside the context pack.
 *
 * factId is the stable identifier Gemini must cite in factsUsed.
 * It is set to the underlying claim_id so the frontend can link back to the
 * source screenplay line via sourceLine.
 *
 * isHistorical marks superseded claims included in historical mode.
 * The Companion prompt explains what this flag means so Gemini can reason
 * about causal chains rather than treating old values as contradictions.
 */
export type PackFact = {
  factId: string; // = claim_id from ClickHouse
  entityId: string;
  entityName: string;
  property: string;
  value: string;
  sourceType: "explicit" | "implied" | "inferred";
  confidence: number;
  sceneNumber: number; // valid_from_scene — when this became true
  sourceLine: string; // raw screenplay line the claim was extracted from
  isHistorical: boolean; // true for superseded claims in historical/summary mode
};

/**
 * A one-to-three sentence orientation summary for a single scene.
 * Built deterministically from events and claim changes — no Gemini call.
 * Placed in the pack before the fact list so Gemini has narrative orientation.
 */
export type SceneDigest = {
  sceneNumber: number;
  heading: string;
  oneLiner: string; // 1–3 sentences: events first, significant state changes second
};

/**
 * Lightweight entity summary included in every pack regardless of mode.
 * Helps Gemini answer entity/relationship questions (abilities 1 and 2)
 * without requiring every claim to repeat entity metadata.
 *
 * aliases is populated from the entity's description field in v1.
 * A proper aliases column is deferred to post-hackathon.
 */
export type EntitySummary = {
  entityId: string;
  canonicalName: string;
  entityType: "character" | "object" | "location" | "faction" | "concept";
  firstSeenScene: number; // lowest source_scene_number in the boundary
  aliases: string[]; // v1: parsed from description; defaults to [canonicalName]
};

/**
 * The complete context pack handed from the pack-builder to the answerer.
 *
 * boundary records what was requested so the answerer can include it in the
 * Gemini user turn and in the final CompanionAnswer for the API response.
 *
 * mode is included so the answerer can annotate the Gemini user turn with
 * which retrieval strategy was used (useful for debugging).
 */
export type CompanionPack = {
  boundary: SpoilerBoundaryEntry[];
  entitySummaries: EntitySummary[];
  sceneDigests: SceneDigest[];
  facts: PackFact[];
  mode: QuestionMode;
};

// =============================================================================
// Answer — what the Companion returns to callers
// =============================================================================

/**
 * Three epistemic states, not a boolean.
 *
 * - known    answer directly supported by explicit/implied claims; factsUsed non-empty
 * - partial  some aspects established, others not; notKnownAspects names the gaps
 * - unknown  boundary contains nothing answering this; factsUsed is empty
 *
 * epistemicState is determined by Gemini from the facts provided.
 * The backend enforces the factsUsed ⊆ pack IDs constraint deterministically
 * and downgrades to "partial" if any IDs are stripped by the guard.
 */
export type EpistemicState = "known" | "partial" | "unknown";

/**
 * The answer returned by the Companion agent.
 *
 * factsUsed contains the factIds of every PackFact that supports the answer.
 * The frontend can use these to link back to the source screenplay lines.
 *
 * notKnownAspects is non-empty only when epistemicState is "partial".
 * It explicitly names what the screenplay has not established — this is the
 * Companion's core value proposition over a generic chatbot.
 *
 * boundaryEnforced is always true — it confirms to the caller that spoiler
 * exclusion was applied at data retrieval time, not just at prompt time.
 */
export type CompanionAnswer = {
  answer: string;
  epistemicState: EpistemicState;
  factsUsed: string[]; // subset of pack.facts.map(f => f.factId)
  notKnownAspects: string[]; // empty when epistemicState is "known" or "unknown"
  boundary: SpoilerBoundaryEntry[];
  boundaryEnforced: true;
};

// =============================================================================
// Raw Gemini response — validated before the factsUsed guard runs
// =============================================================================

/**
 * The JSON schema Gemini must return.
 * Validated by Zod in parseAndValidate() before guardFactsUsed() runs.
 *
 * notKnownAspects must always be present as an array; empty when epistemicState
 * is "known" or "unknown". Gemini is instructed to be explicit about this.
 */
export const RawGeminiAnswerSchema = z.object({
  answer: z.string().min(1),
  epistemicState: z.enum(["known", "partial", "unknown"]),
  factsUsed: z.array(z.string()),
  notKnownAspects: z.array(z.string()),
});

export type RawGeminiAnswer = z.infer<typeof RawGeminiAnswerSchema>;
