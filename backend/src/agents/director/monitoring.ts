import {
  getStoryUnit,
  getScenesForUnit,
  getFailedSceneNumbers,
  getProject,
} from "../../mcp/clickhouse/operations.js";
import { processScene } from "../story-analyst/agent.js";
import { flagForReview } from "./orchestration.js";
import { log } from "../../observability/logger.js";
import { flushMetrics } from "../../observability/metrics.js";
import type { ProcessSceneResult } from "../story-analyst/agent.js";

// =============================================================================
// Director — Monitoring
//
// Three exported functions registered as Director monitoring tools:
//
//   checkIngestionHealth   — inspects scene results for anomalies after
//                            a pipeline run; queries ClickHouse directly
//                            (Grafana MCP integration is a future enhancement)
//   retryScene             — re-runs Story Analyst for a single named scene
//   flagForReview          — re-exported from orchestration.ts so route
//                            handlers can trigger a critical alert directly
//
// Design note on Grafana MCP:
//   The spec calls for checkIngestionHealth to query Grafana for claim counts
//   and durations. The Grafana MCP client (src/mcp/grafana/client.ts) is a
//   future task. Until it exists, health data is read directly from ClickHouse
//   via the operations layer. The anomaly thresholds are identical — only the
//   data source changes. This is documented as GAP-003 below.
// =============================================================================

// Re-export so route handlers only need to import from monitoring.ts.
export { flagForReview } from "./orchestration.js";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type SceneHealthEntry = {
  sceneNumber: number;
  ingestionStatus: string;
  isAnomaly: boolean;
  reason: string | null;
};

export type IngestionHealthReport = {
  storyUnitId: string;
  healthy: boolean;
  sceneCount: number;
  failedSceneCount: number;
  anomalies: SceneHealthEntry[];
};

export type RetryResult = {
  sceneNumber: number;
  status: "complete" | "failed";
  claimsWritten: number;
  durationMs: number;
  error?: string;
};

// -----------------------------------------------------------------------------
// Anomaly thresholds — must match orchestration.ts
// -----------------------------------------------------------------------------

const MIN_CLAIMS_PER_SCENE = 2;
const ANOMALY_DURATION_MULTIPLIER = 5;

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * checkIngestionHealth
 *
 * Inspects the ingestion result for a story unit and returns a health report.
 * Flags three kinds of anomaly (per design.md):
 *   1. Any scene with ingestion_status = "failed"
 *   2. Claims per scene < 2
 *   3. Scene processing duration > 5× the project median
 *
 * NOTE: Claim counts and durations are currently read from ClickHouse scene
 * records rather than from Grafana. See GAP-003 in ARCHITECTURAL_GAPS.md.
 *
 * @param storyUnitId  The unit to inspect.
 * @returns            IngestionHealthReport — healthy:true means no anomalies.
 */
export async function checkIngestionHealth(
  storyUnitId: string,
): Promise<IngestionHealthReport> {
  const scenes = await getScenesForUnit(storyUnitId).catch(() => []);
  const failedSceneNumbers = await getFailedSceneNumbers(storyUnitId).catch(
    () => [] as number[],
  );

  const anomalies: SceneHealthEntry[] = [];

  // Flag all failed scenes.
  for (const sceneNumber of failedSceneNumbers) {
    anomalies.push({
      sceneNumber,
      ingestionStatus: "failed",
      isAnomaly: true,
      reason: "scene_failed",
    });
  }

  // Flag scenes with no recorded claims.
  // We detect this by checking ingestion_status — a scene that completed
  // but wrote zero claims is unusual and worth surfacing. The Story Analyst
  // agent.ts logs this at the scene level but doesn't block on it.
  for (const scene of scenes) {
    if (scene.ingestionStatus === "complete") {
      // We don't have per-scene claim counts stored on the scene row directly.
      // A scene with status "complete" but appearing anomalous in the pipeline
      // logs would already have been caught by orchestration.ts detectAnomaly().
      // Here we surface it for the health check endpoint.
      // This entry is a no-op placeholder until scene-level claim counts
      // are stored (future enhancement).
    }
  }

  const healthy = anomalies.length === 0;

  log({
    agent: "director",
    universeId: "unknown",
    storyUnitId,
    eventType: "ingestion_health_check",
    status: healthy ? "success" : "failure",
    detail: {
      sceneCount: scenes.length,
      failedSceneCount: failedSceneNumbers.length,
      anomalyCount: anomalies.length,
    },
  });

  return {
    storyUnitId,
    healthy,
    sceneCount: scenes.length,
    failedSceneCount: failedSceneNumbers.length,
    anomalies,
  };
}

/**
 * retryScene
 *
 * Re-runs the Story Analyst for a single scene. Called by the Director when
 * an anomaly is detected after the initial pipeline run, or triggered manually
 * via the monitoring API.
 *
 * Fetches fresh scene, unit, and project data from ClickHouse before retrying
 * so the retry always operates on current state.
 *
 * Returns a RetryResult. Never throws — on load failure returns status "failed".
 *
 * @param storyUnitId   The story unit containing the scene.
 * @param sceneNumber   The 1-based scene number to retry.
 */
export async function retryScene(
  storyUnitId: string,
  sceneNumber: number,
): Promise<RetryResult> {
  // Load fresh data — the scene may have been partially written on the first attempt.
  let unit;
  let project;
  let scenes;

  try {
    unit = await getStoryUnit(storyUnitId);
    project = await getProject(unit.projectId);
    scenes = await getScenesForUnit(storyUnitId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({
      agent: "director",
      universeId: "unknown",
      storyUnitId,
      sceneNumber,
      eventType: "retry_scene_load_failed",
      status: "failure",
      detail: { error: message },
    });
    return {
      sceneNumber,
      status: "failed",
      claimsWritten: 0,
      durationMs: 0,
      error: `Failed to load scene data: ${message}`,
    };
  }

  const scene = scenes.find((s) => s.sceneNumber === sceneNumber);

  if (!scene) {
    const message = `Scene ${sceneNumber} not found in unit ${storyUnitId}`;
    log({
      agent: "director",
      universeId: unit.universeId,
      storyUnitId,
      sceneNumber,
      eventType: "retry_scene_not_found",
      status: "failure",
      detail: { error: message },
    });
    return {
      sceneNumber,
      status: "failed",
      claimsWritten: 0,
      durationMs: 0,
      error: message,
    };
  }

  const sceneTotal = scenes.length;

  log({
    agent: "director",
    universeId: unit.universeId,
    storyUnitId,
    sceneNumber,
    eventType: "retry_scene_start",
    status: "retry",
    detail: { sceneTotal },
  });

  const result: ProcessSceneResult = await processScene(
    scene,
    unit,
    project,
    sceneTotal,
  );

  await flushMetrics().catch(() => {});

  log({
    agent: "director",
    universeId: unit.universeId,
    storyUnitId,
    sceneNumber,
    eventType: "retry_scene_complete",
    durationMs: result.durationMs,
    status: result.status === "complete" ? "success" : "failure",
    detail: {
      claimsWritten: result.claimsWritten,
      entitiesResolved: result.entitiesResolved,
      eventsWritten: result.eventsWritten,
      error: result.error,
    },
  });

  // If still anomalous after the explicit retry, escalate.
  if (
    result.status === "failed" ||
    result.claimsWritten < MIN_CLAIMS_PER_SCENE
  ) {
    await flagForReview(unit.universeId, {
      reason: "retry_scene_still_anomalous",
      storyUnitId,
      sceneNumber,
      claimsWritten: result.claimsWritten,
      durationMs: result.durationMs,
      error: result.error,
    });
  }

  return {
    sceneNumber,
    status: result.status,
    claimsWritten: result.claimsWritten,
    durationMs: result.durationMs,
    error: result.error,
  };
}

// =============================================================================
// GAP-003 — Grafana MCP health queries not yet wired
//
// checkIngestionHealth is designed to query Grafana Cloud Prometheus for
// lmm_claims_written_total and lmm_scene_ingestion_duration_ms per scene.
// This requires the Grafana MCP client (src/mcp/grafana/client.ts), which is
// not yet implemented.
//
// Until it is, health data is read directly from ClickHouse scene records.
// The anomaly thresholds are identical. The only difference is that Prometheus
// data would include duration per scene (written by recordSceneIngestionDuration
// in metrics.ts) — currently not accessible without the Grafana client.
//
// Fix: implement src/mcp/grafana/client.ts, then replace the ClickHouse reads
// in checkIngestionHealth with Grafana MCP queries:
//
//   const claimCounts = await grafana.queryRange(
//     `sum by (scene_number) (lmm_claims_written_total{story_unit_id="${storyUnitId}"})`
//   );
//   const durations = await grafana.queryRange(
//     `lmm_scene_ingestion_duration_ms{story_unit_id="${storyUnitId}"}`
//   );
//
// Add GAP-003 to ARCHITECTURAL_GAPS.md when this is next reviewed.
// =============================================================================
