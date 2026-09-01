import { config } from "../config/index";
import type { LogEvent } from "../types/index";

// ---------------------------------------------------------------------------
// Config — read once at module load. If any value is missing the logger
// degrades to console-only mode rather than crashing the server at startup.
// ---------------------------------------------------------------------------

const { 
  GRAFANA_LOKI_URL: LOKI_URL, 
  GRAFANA_LOKI_USERNAME: LOKI_USERNAME, 
  GRAFANA_LOKI_TOKEN: LOKI_TOKEN,
  NODE_ENV: ENV
} = config;

const lokiEnabled =
  Boolean(LOKI_URL) && Boolean(LOKI_USERNAME) && Boolean(LOKI_TOKEN);

if (!lokiEnabled) {
  console.warn(
    "[logger] Loki env vars missing — logging to console only. " +
      "Set GRAFANA_LOKI_URL, GRAFANA_LOKI_USERNAME, GRAFANA_LOKI_TOKEN to enable."
  );
}

// ---------------------------------------------------------------------------
// In-memory queue
//
// Events are enqueued synchronously by log() and flushed either:
//   - every FLUSH_INTERVAL_MS (timer-driven), or
//   - immediately when the queue reaches MAX_QUEUE_SIZE (size-driven)
//
// Both paths call _flush(), which is the single drain point.
// ---------------------------------------------------------------------------

const MAX_QUEUE_SIZE = 1000;
const FLUSH_INTERVAL_MS = 2000;
const RETRY_DELAY_MS = 500;

// Each queued item pairs the original event with the nanosecond timestamp
// captured at enqueue time, so ordering is accurate even if a flush is delayed.
type QueuedEvent = {
  event: LogEvent;
  timestampNs: string; // Loki requires nanosecond-precision Unix timestamp as string
};

const queue: QueuedEvent[] = [];

// The interval handle is kept so flushLogs() can clear it on graceful shutdown.
const flushInterval = setInterval(() => {
  void _flush();
}, FLUSH_INTERVAL_MS);

// Prevent the interval from keeping the Node process alive if everything else
// has shut down (e.g. in tests).
if (flushInterval.unref) {
  flushInterval.unref();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enqueue a log event. Returns immediately — never awaits, never throws.
 * Safe to call from anywhere in the agent pipeline.
 */
export function log(event: LogEvent): void {
  // Nanosecond timestamp: Date.now() gives milliseconds; multiply to nanoseconds.
  const timestampNs = (BigInt(Date.now()) * 1_000_000n).toString();

  queue.push({ event, timestampNs });

  // Always mirror to console so local dev doesn't require Grafana.
  console.log(`[${event.agent}] ${event.eventType}`, {
    status: event.status,
    storyUnitId: event.storyUnitId,
    sceneNumber: event.sceneNumber,
    durationMs: event.durationMs,
  });

  // Size-driven flush — don't wait for the timer if the queue is full.
  if (queue.length >= MAX_QUEUE_SIZE) {
    void _flush();
  }
}

/**
 * Drain the queue immediately. Call this on graceful shutdown to avoid
 * losing the last batch of events.
 */
export async function flushLogs(): Promise<void> {
  clearInterval(flushInterval);
  await _flush();
}

/**
 * Returns the number of events currently waiting in the queue.
 * Used by the Director's health monitoring to detect Loki backpressure.
 */
export function getLokiQueueDepth(): number {
  return queue.length;
}

// ---------------------------------------------------------------------------
// Internal flush
//
// Drains the entire queue into a single Loki push request. One HTTP call
// per flush, regardless of how many events are in the batch.
//
// Loki push payload shape:
//   { streams: [{ stream: <labels>, values: [["<ns_timestamp>", "<json>"]] }] }
//
// We use one stream per agent value so Grafana can filter by agent label
// without parsing the log line JSON.
// ---------------------------------------------------------------------------

async function _flush(): Promise<void> {
  if (queue.length === 0 || !lokiEnabled) return;

  // Drain the queue atomically — splice out everything currently in it.
  // New events arriving during the async push go into a fresh batch.
  const batch = queue.splice(0, queue.length);

  // Group events by agent so each agent gets its own Loki stream label.
  // This makes Grafana LogQL queries like {agent="guardian"} work efficiently.
  const byAgent = new Map<string, QueuedEvent[]>();
  for (const item of batch) {
    const key = item.event.agent;
    if (!byAgent.has(key)) byAgent.set(key, []);
    byAgent.get(key)!.push(item);
  }

  const streams = Array.from(byAgent.entries()).map(([agent, items]) => ({
    stream: { app: "lmm", agent, env: ENV },
    values: items.map(({ timestampNs, event }) => [
      timestampNs,
      JSON.stringify(event),
    ]),
  }));

  const payload = JSON.stringify({ streams });

  const success = await _pushToLoki(payload);

  if (!success) {
    // One retry after a short delay.
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    const retried = await _pushToLoki(payload);

    if (!retried) {
      // Drop the batch after one retry — we cannot let the queue grow unboundedly.
      console.error(
        `[logger] Loki push failed after retry. Dropped ${batch.length} log events.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP push — returns true on success, false on any failure.
// Intentionally does not throw so the caller can handle retry cleanly.
// ---------------------------------------------------------------------------

async function _pushToLoki(payload: string): Promise<boolean> {
  try {
    const credentials = Buffer.from(
      `${LOKI_USERNAME}:${LOKI_TOKEN}`
    ).toString("base64");

    const response = await fetch(`${LOKI_URL}/loki/api/v1/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: payload,
    });

    if (!response.ok) {
      console.error(
        `[logger] Loki returned ${response.status}: ${await response.text()}`
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error("[logger] Loki push threw:", err);
    return false;
  }
}
