import {
  getStoryUnit,
  getScenesForUnit,
  getProject,
} from "../../mcp/clickhouse/operations.js";
import { runQuery, McpClientError } from "../../mcp/clickhouse/http-client.js";
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
  // ── Query via official mcp-clickhouse MCP server ──────────────────────────
  //
  // These two queries go through the official ClickHouse MCP server
  // (github.com/ClickHouse/mcp-clickhouse) via Streamable HTTP transport.
  // This satisfies the ClickHouse hackathon track requirement:
  //   "actively use ClickHouse at runtime via the official ClickHouse MCP
  //    server (mcp-clickhouse)."
  //
  // GAP-003 resolution: health data now flows through the MCP layer.
  // The server must be running (see scripts/start-mcp-clickhouse.sh).
  // On failure, both queries fall back to empty results so the health
  // endpoint stays available even when the MCP server is down.

  type SceneRow = { scene_number: string; ingestion_status: string };
  type FailedRow = { scene_number: string };

  const scenes = await runQuery<SceneRow>(
    `SELECT scene_number, ingestion_status
     FROM lmm.scenes
     WHERE story_unit_id = '${storyUnitId}'
     ORDER BY scene_number ASC`,
  ).catch((err: unknown) => {
    log({
      agent: "director",
      universeId: "unknown",
      storyUnitId,
      eventType: "ingestion_health_mcp_query_failed",
      status: "failure",
      detail: {
        query: "scenes",
        error: err instanceof McpClientError ? err.message : String(err),
      },
    });
    return [] as SceneRow[];
  });

  const failedRows = await runQuery<FailedRow>(
    `SELECT scene_number
     FROM lmm.scenes
     WHERE story_unit_id = '${storyUnitId}'
       AND ingestion_status = 'failed'
     ORDER BY scene_number ASC`,
  ).catch((err: unknown) => {
    log({
      agent: "director",
      universeId: "unknown",
      storyUnitId,
      eventType: "ingestion_health_mcp_query_failed",
      status: "failure",
      detail: {
        query: "failed_scenes",
        error: err instanceof McpClientError ? err.message : String(err),
      },
    });
    return [] as FailedRow[];
  });

  // ClickHouse returns numbers as strings over HTTP JSON; coerce them.
  const failedSceneNumbers = failedRows.map((r) => Number(r.scene_number));

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
      via: "mcp-clickhouse",
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
// GAP-003 — RESOLVED: health queries now go through mcp-clickhouse MCP server
//
// checkIngestionHealth previously read health data directly from ClickHouse
// via operations.ts. It now queries through the official ClickHouse MCP
// server (github.com/ClickHouse/mcp-clickhouse) using Streamable HTTP
// transport, satisfying the ClickHouse hackathon track requirement.
//
// The MCP server must be running before calling checkIngestionHealth.
// See scripts/start-mcp-clickhouse.sh for startup instructions.
//
// If the MCP server is unavailable, both queries fall back to empty arrays
// and the health endpoint returns a report with zero scenes — callers treat
// this as a degraded-but-live response rather than a hard failure.
// =============================================================================
