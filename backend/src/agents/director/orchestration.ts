import EventEmitter from "events";
import {
  getStoryUnit,
  getProject,
  getScenesForUnit,
  getFailedSceneNumbers,
  updateStoryUnitStatus,
  updateStoryUnitCounts,
} from "../../mcp/clickhouse/operations.js";
import { processScene } from "../story-analyst/agent.js";
import { guardianAgent } from "../continuity-guardian/agent.js";
import { companionAgent } from "../audience-companion/agent.js";
import { log } from "../../observability/logger.js";
import {
  recordSceneIngestionDuration,
  recordClaimWritten,
  flushMetrics,
} from "../../observability/metrics.js";
import type {
  ContinuityFinding,
  SpoilerBoundaryEntry,
} from "../../types/index.js";

// =============================================================================
// Director — Orchestration
//
// Four exported functions, each registered as a Director tool:
//
//   runIngestionPipeline    — processes all scenes for a story unit sequentially;
//                             emits SSE progress events; triggers Guardian passes
//                             automatically on completion
//   runWithinUnitGuardian   — delegates to the Guardian sub-agent (within-unit pass)
//   runCrossUnitGuardian    — delegates to the Guardian sub-agent (cross-unit pass)
//   runCompanionQuery       — delegates to the Companion sub-agent
//
// Guardian and Companion delegation is currently stubbed. Replace the stub
// bodies when Tasks 10–12 are complete.
//
// The SSE emitter is passed in per pipeline run. The Director never touches
// HTTP — it emits to whatever EventEmitter it receives. The route handler
// owns the emitter and writes events to the response stream.
// =============================================================================

// -----------------------------------------------------------------------------
// Return types
// -----------------------------------------------------------------------------

export type IngestionSummary = {
  storyUnitId: string;
  sceneCount: number;
  claimCount: number;
  failedScenes: number[];
  durationMs: number;
  withinUnitFindings: ContinuityFinding[];
  crossUnitFindings: ContinuityFinding[];
};

export type GuardianSummary = {
  findingsCount: number;
  findings: ContinuityFinding[];
};

export type CompanionAnswer = {
  answer: string;
  factsUsed: string[];
  claimsUsed: Array<{
    entityName: string;
    property: string;
    value: string;
    sourceUnitTitle: string;
    sceneNumber: number;
  }>;
  boundaryEnforced: true;
  boundarySummary: string;
};

// -----------------------------------------------------------------------------
// Anomaly thresholds (from design.md)
// -----------------------------------------------------------------------------

const MIN_CLAIMS_PER_SCENE = 2;
// Duration anomaly is assessed against the running median, not a fixed value.
// ANOMALY_DURATION_MULTIPLIER is the multiplier above which a scene is flagged.
const ANOMALY_DURATION_MULTIPLIER = 5;

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * runIngestionPipeline
 *
 * Processes all scenes for a story unit sequentially. Guarantees that scene N's
 * ClickHouse writes are committed before scene N+1 begins — this is required
 * for correct context injection in the Story Analyst.
 *
 * After all scenes complete (or fail), automatically runs:
 *   1. within-unit Guardian pass
 *   2. cross-unit Guardian pass
 *
 * Progress is emitted to the caller via the supplied EventEmitter:
 *   "scene_complete" — { scene_number, claims_written, status: "complete" }
 *   "scene_failed"   — { scene_number, reason }
 *   "ingestion_complete" — { scene_count, claim_count, failed_scenes }
 *
 * Never throws. On fatal errors (can't load unit or scenes) emits
 * "ingestion_complete" with all scenes marked failed.
 *
 * @param storyUnitId  The unit to process.
 * @param emitter      SSE event emitter owned by the route handler.
 * @param onRetry      Optional callback — called when the Director decides to
 *                     retry an anomalous scene. Signature: (sceneNumber) => void.
 *                     Used by monitoring.ts to coordinate retry logging.
 */
export async function runIngestionPipeline(
  storyUnitId: string,
  emitter: EventEmitter,
  onRetry?: (sceneNumber: number) => void,
): Promise<IngestionSummary> {
  const pipelineStart = Date.now();

  // ── Load unit and project ─────────────────────────────────────────────────
  let unit;
  let project;
  try {
    unit = await getStoryUnit(storyUnitId);
    project = await getProject(unit.projectId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({
      agent: "director",
      universeId: "unknown",
      storyUnitId,
      eventType: "ingestion_load_failed",
      status: "failure",
      detail: { error: message },
    });
    emitter.emit("ingestion_complete", {
      scene_count: 0,
      claim_count: 0,
      failed_scenes: [],
    });
    return {
      storyUnitId,
      sceneCount: 0,
      claimCount: 0,
      failedScenes: [],
      durationMs: Date.now() - pipelineStart,
      withinUnitFindings: [],
      crossUnitFindings: [],
    };
  }

  // Mark unit as ingesting.
  await updateStoryUnitStatus(storyUnitId, "ingesting").catch(() => {});

  // ── Load scenes ───────────────────────────────────────────────────────────
  let scenes;
  try {
    scenes = await getScenesForUnit(storyUnitId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateStoryUnitStatus(storyUnitId, "failed").catch(() => {});
    log({
      agent: "director",
      universeId: unit.universeId,
      storyUnitId,
      eventType: "ingestion_scenes_load_failed",
      status: "failure",
      detail: { error: message },
    });
    emitter.emit("ingestion_complete", {
      scene_count: 0,
      claim_count: 0,
      failed_scenes: [],
    });
    return {
      storyUnitId,
      sceneCount: 0,
      claimCount: 0,
      failedScenes: [],
      durationMs: Date.now() - pipelineStart,
      withinUnitFindings: [],
      crossUnitFindings: [],
    };
  }

  // Sort ascending — must process in order for context injection to work.
  scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);
  const sceneTotal = scenes.length;

  // ── Per-scene processing ──────────────────────────────────────────────────
  const failedScenes: number[] = [];
  let totalClaimsWritten = 0;
  const durations: number[] = [];

  for (const scene of scenes) {
    let result = await processScene(scene, unit, project, sceneTotal);

    // ── Anomaly check ─────────────────────────────────────────────────────
    // Only retry scenes that actually failed. Low-claim or slow-but-complete
    // scenes are flagged for review but not re-run — retrying a completed scene
    // would duplicate the claims and events already written to ClickHouse.
    const isAnomaly = detectAnomaly(result, durations);

    if (isAnomaly && result.status === "failed") {
      onRetry?.(scene.sceneNumber);

      // Single retry.
      log({
        agent: "director",
        universeId: unit.universeId,
        storyUnitId,
        sceneNumber: scene.sceneNumber,
        eventType: "scene_anomaly_retry",
        status: "retry",
        detail: {
          claimsWritten: result.claimsWritten,
          durationMs: result.durationMs,
          reason: result.error ?? "failed",
        },
      });

      result = await processScene(scene, unit, project, sceneTotal);

      if (detectAnomaly(result, durations)) {
        // Still anomalous after retry — flag for review and continue.
        await flagForReview(unit.universeId, {
          reason: "scene_anomaly_unresolved_after_retry",
          storyUnitId,
          sceneNumber: scene.sceneNumber,
          claimsWritten: result.claimsWritten,
          durationMs: result.durationMs,
        });
      }
    } else if (isAnomaly) {
      // Completed but anomalous (e.g. low claims, slow) — flag without retrying.
      await flagForReview(unit.universeId, {
        reason: "scene_anomaly_completed",
        storyUnitId,
        sceneNumber: scene.sceneNumber,
        claimsWritten: result.claimsWritten,
        durationMs: result.durationMs,
      });
    }

    // ── Accumulate results ────────────────────────────────────────────────
    durations.push(result.durationMs);

    if (result.status === "failed") {
      failedScenes.push(scene.sceneNumber);
      emitter.emit("scene_failed", {
        scene_number: scene.sceneNumber,
        reason: result.error ?? "unknown",
      });
    } else {
      totalClaimsWritten += result.claimsWritten;
      emitter.emit("scene_complete", {
        scene_number: scene.sceneNumber,
        claims_written: result.claimsWritten,
        status: "complete",
      });
    }

    recordSceneIngestionDuration(storyUnitId, result.durationMs);
  }

  // ── Update unit status and counts ─────────────────────────────────────────
  const finalStatus =
    failedScenes.length === sceneTotal ? "failed" : "complete";
  await updateStoryUnitStatus(storyUnitId, finalStatus).catch(() => {});
  await updateStoryUnitCounts(
    storyUnitId,
    sceneTotal,
    totalClaimsWritten,
  ).catch(() => {});

  // ── Automatic Guardian passes ─────────────────────────────────────────────
  // Within-unit always runs, even if some scenes failed — partial analysis is
  // better than none.
  //
  // Brief pause before Guardian queries — ClickHouse Cloud uses ReplicatedMergeTree
  // and writes from ingestion need a moment to be visible to JOIN queries.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const withinUnitResult = await runWithinUnitGuardian(storyUnitId);
  const crossUnitResult = await runCrossUnitGuardian(unit.universeId);

  // ── Emit completion and flush ─────────────────────────────────────────────
  const failedSceneNumbers = await getFailedSceneNumbers(storyUnitId).catch(
    () => failedScenes,
  );

  emitter.emit("ingestion_complete", {
    scene_count: sceneTotal,
    claim_count: totalClaimsWritten,
    failed_scenes: failedSceneNumbers,
  });

  await flushMetrics().catch(() => {});

  const durationMs = Date.now() - pipelineStart;

  log({
    agent: "director",
    universeId: unit.universeId,
    storyUnitId,
    eventType: "ingestion_pipeline_complete",
    durationMs,
    status: failedScenes.length === 0 ? "success" : "failure",
    detail: {
      sceneCount: sceneTotal,
      claimCount: totalClaimsWritten,
      failedScenes: failedSceneNumbers,
      withinUnitFindings: withinUnitResult.findingsCount,
      crossUnitFindings: crossUnitResult.findingsCount,
    },
  });

  return {
    storyUnitId,
    sceneCount: sceneTotal,
    claimCount: totalClaimsWritten,
    failedScenes: failedSceneNumbers,
    durationMs,
    withinUnitFindings: withinUnitResult.findings,
    crossUnitFindings: crossUnitResult.findings,
  };
}

/**
 * runWithinUnitGuardian
 *
 * Triggers the Continuity Guardian's within-unit pass for a story unit.
 */
export async function runWithinUnitGuardian(
  storyUnitId: string,
): Promise<GuardianSummary> {
  return guardianAgent.analyzeUnit(storyUnitId);
}

/**
 * runCrossUnitGuardian
 *
 * Triggers the Continuity Guardian's cross-unit pass for a universe.
 */
export async function runCrossUnitGuardian(
  universeId: string,
): Promise<GuardianSummary> {
  return guardianAgent.analyzeUniverse(universeId);
}

/**
 * runCompanionQuery
 *
 * Delegates a viewer question to the Audience Companion.
 */
export async function runCompanionQuery(
  universeId: string,
  question: string,
  boundary: SpoilerBoundaryEntry[],
): Promise<CompanionAnswer> {
  const result = await companionAgent.ask(universeId, question, boundary);
  return {
    answer: result.answer,
    factsUsed: result.factsUsed,
    claimsUsed: [],
    boundaryEnforced: true,
    boundarySummary: boundary
      .map((b) => `${b.storyUnitId} up to scene ${b.upToScene}`)
      .join(", "),
  };
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/**
 * detectAnomaly
 *
 * Returns true if the scene result should trigger an automatic retry.
 * Criteria (from design.md):
 *   - Scene status is "failed"
 *   - Claims written < MIN_CLAIMS_PER_SCENE
 *   - Duration > ANOMALY_DURATION_MULTIPLIER × running median
 */
function detectAnomaly(
  result: Awaited<ReturnType<typeof processScene>>,
  priorDurations: number[],
): boolean {
  if (result.status === "failed") return true;
  if (result.claimsWritten < MIN_CLAIMS_PER_SCENE) return true;

  if (priorDurations.length >= 3) {
    const median = computeMedian(priorDurations);
    if (result.durationMs > ANOMALY_DURATION_MULTIPLIER * median) return true;
  }

  return false;
}

/**
 * computeMedian — simple median over a sorted copy of the array.
 */
function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * flagForReview — fire-and-forget Loki alert at severity critical.
 * Also exported for use by monitoring.ts.
 */
export async function flagForReview(
  universeId: string,
  context: Record<string, unknown>,
): Promise<void> {
  log({
    agent: "director",
    universeId,
    eventType: "flag_for_review",
    status: "failure",
    detail: { severity: "critical", ...context },
  });
  // Flush immediately so the alert reaches Loki before any error propagates.
  await flushMetrics().catch(() => {});
}
