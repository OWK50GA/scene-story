import { config } from "../config/index";
import type { FindingScope, ConflictType, SourceType } from "../types/index";

// ---------------------------------------------------------------------------
// Config — same degradation pattern as logger.ts.
// If Prometheus env vars are missing, metric calls become no-ops.
// ---------------------------------------------------------------------------

const {
  GRAFANA_PROMETHEUS_URL: PROM_URL,
  GRAFANA_PROMETHEUS_USERNAME: PROM_USERNAME,
  GRAFANA_PROMETHEUS_TOKEN: PROM_TOKEN,
} = config;

const promEnabled =
  Boolean(PROM_URL) && Boolean(PROM_USERNAME) && Boolean(PROM_TOKEN);

if (!promEnabled) {
  console.warn(
    "[metrics] Prometheus env vars missing — metrics disabled. " +
      "Set GRAFANA_PROMETHEUS_URL, GRAFANA_PROMETHEUS_USERNAME, GRAFANA_PROMETHEUS_TOKEN to enable."
  );
}

// ---------------------------------------------------------------------------
// In-memory buffer
//
// Prometheus remote write accepts batches of time series samples.
// We accumulate samples here and flush them after each pipeline stage
// (triggered by the typed metric functions below) rather than on a timer,
// because pipeline stages are the natural reporting boundary.
//
// Buffer cap: 500 samples. When full, oldest sample is evicted to make room.
// A dropped-samples counter is kept and included in the next successful push.
// ---------------------------------------------------------------------------

const MAX_BUFFER_SIZE = 500;
const RETRY_DELAY_MS = 500;

// Prometheus remote write uses a protobuf format in production, but Grafana
// Cloud also accepts a simpler JSON-over-HTTP format via the metrics push API.
// We use the push API (application/json) to avoid a protobuf dependency.
//
// Each sample carries: metric name, label set, value, and timestamp.
type MetricSample = {
  name: string;
  labels: Record<string, string>;
  value: number;
  timestampMs: number;
};

const buffer: MetricSample[] = [];
let droppedSamples = 0; // surfaced in next push so we know if eviction happened

// ---------------------------------------------------------------------------
// Internal buffer helpers
// ---------------------------------------------------------------------------

function _enqueue(sample: MetricSample): void {
  if (buffer.length >= MAX_BUFFER_SIZE) {
    // Evict the oldest sample — index 0 — to make room.
    buffer.shift();
    droppedSamples++;
  }
  buffer.push(sample);
}

function _record(
  name: string,
  value: number,
  labels: Record<string, string> = {}
): void {
  _enqueue({ name, labels, value, timestampMs: Date.now() });
}

// ---------------------------------------------------------------------------
// Public flush
//
// Called at the end of each pipeline stage (ingestion, guardian pass,
// companion query) rather than on a timer. This keeps metric timing aligned
// with the actual work units rather than clock ticks.
// ---------------------------------------------------------------------------

export async function flushMetrics(): Promise<void> {
  if (buffer.length === 0 || !promEnabled) return;

  // Include a meta-metric for dropped samples if any were evicted.
  if (droppedSamples > 0) {
    _record("lmm_dropped_metric_samples_total", droppedSamples);
    droppedSamples = 0;
  }

  // Drain atomically, same pattern as logger.ts.
  const batch = buffer.splice(0, buffer.length);

  const success = await _pushToPrometheus(batch);

  if (!success) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    const retried = await _pushToPrometheus(batch);

    if (!retried) {
      console.error(
        `[metrics] Prometheus push failed after retry. Dropped ${batch.length} samples.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP push
//
// Grafana Cloud Prometheus accepts time series via the push API:
//   POST /api/prom/push  (application/json)
//
// Payload shape (Grafana Mimir-compatible):
//   {
//     "streams": [
//       {
//         "labels": "{__name__=\"lmm_scene_ingestion_duration_ms\",story_unit_id=\"abc\"}",
//         "entries": [{ "ts": "<RFC3339>", "line": "<value>" }]
//       }
//     ]
//   }
//
// Actually, Grafana Cloud uses the Prometheus remote write protocol for metrics
// (not Loki streams). For simplicity we use the influx-line / metric push
// endpoint which accepts plain text in Prometheus exposition format:
//
//   metric_name{label="value"} numeric_value timestamp_ms
//
// This avoids a protobuf dependency entirely.
// ---------------------------------------------------------------------------

async function _pushToPrometheus(batch: MetricSample[]): Promise<boolean> {
  try {
    // Build Prometheus text exposition format.
    // One line per sample: name{labels} value timestamp
    const lines = batch.map((s) => {
      const labelStr = Object.entries(s.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");
      const labelBlock = labelStr ? `{${labelStr}}` : "";
      return `${s.name}${labelBlock} ${s.value} ${s.timestampMs}`;
    });

    const body = lines.join("\n");
    const credentials = Buffer.from(
      `${PROM_USERNAME}:${PROM_TOKEN}`
    ).toString("base64");

    const response = await fetch(`${PROM_URL}/api/prom/push`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Basic ${credentials}`,
      },
      body,
    });

    if (!response.ok) {
      console.error(
        `[metrics] Prometheus returned ${response.status}: ${await response.text()}`
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error("[metrics] Prometheus push threw:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Typed metric recording functions
//
// One function per metric defined in design.md → Observability.
// Agents call these directly — no magic string metric names anywhere else.
// Each function records to the buffer; call flushMetrics() after the stage
// that produces the metrics to send the batch.
// ---------------------------------------------------------------------------

// --- Story Analyst / Ingestion ---

/**
 * How long a single scene took to process end-to-end (parse + extract + write).
 */
export function recordSceneIngestionDuration(
  storyUnitId: string,
  durationMs: number
): void {
  _record("lmm_scene_ingestion_duration_ms", durationMs, {
    story_unit_id: storyUnitId,
  });
}

/**
 * Increments the total claim count for a story unit, broken down by source_type.
 * Call once per claim written.
 */
export function recordClaimWritten(
  storyUnitId: string,
  sourceType: SourceType
): void {
  _record("lmm_claims_written_total", 1, {
    story_unit_id: storyUnitId,
    source_type: sourceType,
  });
}

/**
 * Records a confidence score observation for distribution tracking.
 * Call once per claim written. Grafana can bucket these into a histogram.
 */
export function recordConfidence(
  sourceType: SourceType,
  confidence: number
): void {
  _record("lmm_confidence_distribution", confidence, {
    source_type: sourceType,
  });
}

/**
 * Increments the extraction retry counter. Call when Gemini output fails
 * schema validation and the extractor retries.
 */
export function recordExtractionRetry(storyUnitId: string): void {
  _record("lmm_extraction_retries_total", 1, {
    story_unit_id: storyUnitId,
  });
}

/**
 * Increments the extraction failure counter. Call when both attempts fail
 * and the scene is marked failed.
 */
export function recordExtractionFailure(storyUnitId: string): void {
  _record("lmm_extraction_failures_total", 1, {
    story_unit_id: storyUnitId,
  });
}

// --- Continuity Guardian ---

/**
 * How long a full Guardian pass took (within-unit or cross-unit).
 */
export function recordGuardianDuration(
  scope: FindingScope,
  durationMs: number
): void {
  _record("lmm_guardian_duration_ms", durationMs, { scope });
}

/**
 * How many claim pairs the Guardian examined in a pass.
 */
export function recordClaimPairsExamined(
  scope: FindingScope,
  count: number
): void {
  _record("lmm_claim_pairs_examined_total", count, { scope });
}

/**
 * Increments the findings counter. Call once per finding written.
 */
export function recordFindingWritten(
  conflictType: Exclude<ConflictType, "normal_transition">,
  scope: FindingScope
): void {
  _record("lmm_findings_written_total", 1, {
    conflict_type: conflictType,
    scope,
  });
}

/**
 * Records the outcome of a temporal ordering resolution attempt.
 * - "precise"      — both units had in_universe_date_start, no Gemini call needed
 * - "cached"       — a stored temporal_relation was found and reused
 * - "fuzzy_gemini" — Gemini was called to reason over period labels
 * - "indeterminate"— Gemini returned indeterminate, or the call failed
 */
export function recordTemporalResolution(
  method: "precise" | "cached" | "fuzzy_gemini" | "indeterminate"
): void {
  _record("lmm_temporal_resolution_total", 1, { method });
}

// --- Audience Companion ---

/**
 * How long a Companion query took end-to-end (boundary query + Gemini call).
 */
export function recordCompanionQueryDuration(durationMs: number): void {
  _record("lmm_companion_query_duration_ms", durationMs);
}

/**
 * How many claims were retrieved and passed to the Companion's Gemini prompt.
 */
export function recordCompanionClaimsRetrieved(count: number): void {
  _record("lmm_companion_claims_retrieved_total", count);
}

/**
 * How many story units were in the viewer's spoiler boundary for this query.
 */
export function recordCompanionBoundaryUnits(count: number): void {
  _record("lmm_companion_boundary_units_count", count);
}
