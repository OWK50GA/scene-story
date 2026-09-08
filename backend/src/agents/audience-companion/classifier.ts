/**
 * classifier.ts — question mode classifier
 *
 * Pure function. No imports beyond local types. No side effects. Independently
 * testable without any mocks.
 *
 * Determines which retrieval strategy the pack-builder should use based on
 * the viewer's question text. The mode controls what data goes into the pack;
 * it does not limit which of the nine Companion abilities can be exercised.
 *
 * Classification order matters:
 *   1. Summary triggers are checked first — they are more specific phrases
 *      that would also match historical triggers ("what do we know so far"
 *      contains "what", "tell me about" could be causal).
 *   2. Historical triggers are checked second.
 *   3. Default is current_state.
 */

import type { QuestionMode } from "./types.js";

// =============================================================================
// Trigger lists
// =============================================================================

/**
 * Summary mode triggers.
 * Checked before historical triggers. These are multi-word phrases or
 * keywords that unambiguously signal a catch-up or aggregate request.
 *
 * Rationale for each:
 *   "catch me up"      — ability 6: explicit catch-up request
 *   "what should i remember" — ability 7: forward-looking relevance
 *   "what do we know"  — ability 5: aggregate picture across all claims
 *   "so far"           — ability 5/6: signals desire for cumulative view
 *   "everything about" — ability 5: all-properties aggregate
 *   "tell me about"    — broad summary of an entity or topic
 *   "remind me"        — catch-up or recap request
 */
export const SUMMARY_TRIGGERS: readonly string[] = [
  "catch me up",
  "what should i remember",
  "what do we know",
  "so far",
  "everything about",
  "tell me about",
  "remind me",
] as const;

/**
 * Historical mode triggers.
 * These question words signal a causal or narrative chain question (ability 3)
 * rather than a point-in-time state lookup. Single words are intentional —
 * "how did", "why did", "what caused" all start with one of these.
 *
 * Rationale for each:
 *   "how"          — "how did X happen", "how did Clara get the device"
 *   "why"          — "why did X", causal explanation
 *   "what caused"  — explicit causation
 *   "how did"      — redundant with "how" but included for clarity in intent
 *   "when did"     — temporal chain question
 *   "where did"    — origin question requiring history
 *   "what happened to" — narrative trace
 */
export const HISTORICAL_TRIGGERS: readonly string[] = [
  "what caused",
  "what happened to",
  "how did",
  "when did",
  "where did",
  "why",
  "how",
] as const;

// =============================================================================
// Classifier
// =============================================================================

/**
 * classifyQuestion
 *
 * Determines the retrieval mode for a viewer question.
 * Case-insensitive substring match against the normalised question text.
 *
 * Summary triggers are evaluated before historical triggers.
 * Longer / more specific phrases are listed first within each group so that
 * "what do we know so far" matches "what do we know" before it could
 * (hypothetically) match a shorter trigger.
 *
 * Returns "current_state" when no trigger matches — this covers abilities
 * 1, 4, and most of 5: entity lookup, current-state questions, relationship
 * questions that don't require causal chains.
 */
export function classifyQuestion(question: string): QuestionMode {
  const normalised = question.toLowerCase().trim();

  for (const trigger of SUMMARY_TRIGGERS) {
    if (normalised.includes(trigger)) {
      return "summary";
    }
  }

  for (const trigger of HISTORICAL_TRIGGERS) {
    if (normalised.includes(trigger)) {
      return "historical";
    }
  }

  return "current_state";
}
