/**
 * agent.ts — Audience Companion public facade
 *
 * External callers (orchestration.ts, route handlers) interact only with
 * the `companionAgent` singleton exported from this file. Internal files
 * (pack-builder, answerer, classifier, prompt) are never imported directly
 * by code outside the audience-companion directory.
 *
 * Two entry points:
 *
 *   askUnit(storyUnitId, upToScene, question)
 *     Unit-level path. Used by POST /api/units/:id/ask.
 *     Single-entry boundary; the primary demo path.
 *
 *   ask(universeId, question, boundary)
 *     Multi-unit path. Used by POST /api/universes/:id/ask via orchestration.
 *     v1: builds the pack from the first boundary entry only.
 *     Full multi-unit merge is deferred post-hackathon.
 */

import { classifyQuestion } from "./classifier.js";
import { buildPack } from "./pack-builder.js";
import { answerQuestion } from "./answerer.js";
import type { CompanionAnswer } from "./types.js";
import type { SpoilerBoundaryEntry } from "../../types/index.js";
import { getStoryUnit } from "../../mcp/clickhouse/operations.js";
import { log } from "../../observability/logger.js";
import {
  recordCompanionQueryDuration,
  recordCompanionClaimsRetrieved,
  recordCompanionBoundaryUnits,
} from "../../observability/metrics.js";

// =============================================================================
// AudienceCompanionAgent
// =============================================================================

class AudienceCompanionAgent {
  /**
   * askUnit
   *
   * Unit-level entry point. The full pipeline for a single-unit boundary:
   *   1. classifyQuestion  → QuestionMode
   *   2. buildPack         → CompanionPack  (deterministic, no Gemini)
   *   3. answerQuestion    → CompanionAnswer (Gemini + guard)
   *
   * Emits observability metrics and a structured log entry on every call.
   * Never throws — answerQuestion guarantees a safe fallback.
   */
  async askUnit(
    storyUnitId: string,
    upToScene: number,
    question: string,
  ): Promise<CompanionAnswer> {
    const start = Date.now();

    const mode = classifyQuestion(question);

    const pack = await buildPack(storyUnitId, upToScene, question, mode);

    const answer = await answerQuestion(pack, question);

    const durationMs = Date.now() - start;

    // Observability
    recordCompanionQueryDuration(durationMs);
    recordCompanionClaimsRetrieved(pack.facts.length);
    recordCompanionBoundaryUnits(1);

    log({
      agent: "companion",
      universeId: "",       // not available at unit level without an extra lookup
      storyUnitId,
      eventType: "companion_query",
      durationMs,
      status: answer.epistemicState === "unknown" ? "failure" : "success",
      detail: {
        mode,
        factsInPack: pack.facts.length,
        factsUsed: answer.factsUsed.length,
        epistemicState: answer.epistemicState,
        upToScene,
      },
    });

    return answer;
  }

  /**
   * ask
   *
   * Multi-unit entry point. Used by the universe-level ask endpoint via
   * orchestration.ts. In v1, builds the pack from the first boundary entry.
   *
   * A proper multi-unit implementation would merge facts across all boundary
   * entries, resolve cross-unit entity identity, and order events by
   * in-universe time. Deferred to post-hackathon.
   */
  async ask(
    universeId: string,
    question: string,
    boundary: SpoilerBoundaryEntry[],
  ): Promise<CompanionAnswer> {
    if (boundary.length === 0) {
      return {
        answer: "No watched boundary was provided.",
        epistemicState: "unknown",
        factsUsed: [],
        notKnownAspects: ["No story units in the boundary."],
        boundary: [],
        boundaryEnforced: true,
      };
    }

    const start = Date.now();

    // Validate that the first boundary entry belongs to the requested universe
    // before building the pack. buildPack resolves universeId from getStoryUnit
    // internally, but a mismatch would silently return zero facts rather than
    // an explicit error.
    const first = boundary[0]!;
    const firstUnit = await getStoryUnit(first.storyUnitId);
    if (firstUnit.universeId !== universeId) {
      return {
        answer: `Story unit ${first.storyUnitId} does not belong to universe ${universeId}.`,
        epistemicState: "unknown",
        factsUsed: [],
        notKnownAspects: [
          `The story unit in the boundary belongs to universe ${firstUnit.universeId}, not ${universeId}.`,
        ],
        boundary,
        boundaryEnforced: true,
      };
    }

    // v1: use the first boundary entry.
    const mode = classifyQuestion(question);
    const pack = await buildPack(first.storyUnitId, first.upToScene, question, mode);

    const answer = await answerQuestion(pack, question);

    const durationMs = Date.now() - start;

    recordCompanionQueryDuration(durationMs);
    recordCompanionClaimsRetrieved(pack.facts.length);
    recordCompanionBoundaryUnits(boundary.length);

    log({
      agent: "companion",
      universeId,
      storyUnitId: first.storyUnitId,
      eventType: "companion_query_universe",
      durationMs,
      status: answer.epistemicState === "unknown" ? "failure" : "success",
      detail: {
        mode,
        boundaryUnits: boundary.length,
        factsInPack: pack.facts.length,
        factsUsed: answer.factsUsed.length,
        epistemicState: answer.epistemicState,
        note: "v1: pack built from first boundary entry only",
      },
    });

    return answer;
  }
}

// =============================================================================
// Singleton export
// =============================================================================

export const companionAgent = new AudienceCompanionAgent();
