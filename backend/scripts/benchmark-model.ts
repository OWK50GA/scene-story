/**
 * benchmark-model.ts
 *
 * Measures Gemini latency across multiple model candidates using the real
 * workloads in this codebase: scene extraction (Story Analyst) and dossier
 * reasoning (Continuity Guardian temporal ordering).
 *
 * Each model is tested against three probes that mirror actual agent calls:
 *
 *   PROBE 1 — Extraction (small output)
 *     Mirrors extractScene. ~1 k input tokens, ~200 output tokens.
 *     Goal: isolate time-to-first-token cost at minimal output size.
 *
 *   PROBE 2 — Extraction (large output)
 *     Full scene prompt with rich JSON output expected. ~5.7 k input tokens,
 *     ~2.5 k output tokens. Mirrors the real slow case documented in
 *     gemini-extraction-latency.md (Scene 1, 28 s baseline).
 *
 *   PROBE 3 — Temporal ordering (Guardian)
 *     Mirrors askGeminiForTemporalOrder. Short prompt, short JSON output.
 *     Useful baseline — if this is slow, TTFT is the culprit, not output size.
 *
 * Each probe is repeated REPS times per model (default 3). Results per probe:
 *   - individual durations
 *   - mean, median, p95, min, max
 *   - input/output token counts (from usageMetadata when available)
 *   - throughput: output tokens / total seconds
 *
 * Usage:
 *
 *   # benchmark all candidates with default reps (3)
 *   pnpm tsx scripts/benchmark-model.ts
 *
 *   # custom candidates and reps
 *   BENCHMARK_MODELS="gemini-3.5-flash,gemini-3.7-flash" BENCHMARK_REPS=5 \
 *     pnpm tsx scripts/benchmark-model.ts
 *
 *   # test a single model without editing models.ts
 *   GEMINI_MODEL_OVERRIDE="gemini-3.8-flash" BENCHMARK_MODELS="gemini-3.8-flash" \
 *     pnpm tsx scripts/benchmark-model.ts
 *
 * Outputs:
 *   scripts/output/benchmark-<timestamp>.json   — full results
 *   scripts/output/benchmark-<timestamp>.txt    — human-readable table
 *
 * The script never touches ClickHouse or the live agent pipeline.
 * It calls Gemini directly and writes only to the output/ directory.
 *
 * Rate-limit handling:
 *   A configurable inter-call delay (default 4 s) is inserted between every
 *   Gemini request. This keeps the benchmark well under the free-tier limit of
 *   20 RPM described in gemini-extraction-latency.md. Increase BENCHMARK_DELAY_MS
 *   if you hit 429s.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { config } from "../src/config/index.js";

// =============================================================================
// Configuration
// =============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, "output");

/** Models to benchmark. Override via BENCHMARK_MODELS env var (comma-separated). */
const CANDIDATE_MODELS: string[] = (
  process.env.BENCHMARK_MODELS ?? "gemini-3.5-flash,gemini-3.6-flash,gemini-3.7-flash,gemini-3.8-flash"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Repetitions per probe per model. Override via BENCHMARK_REPS. */
const REPS = Math.max(1, parseInt(process.env.BENCHMARK_REPS ?? "3", 10));

/** Milliseconds to wait between Gemini calls to avoid 429s. Override via BENCHMARK_DELAY_MS. */
const DELAY_MS = Math.max(0, parseInt(process.env.BENCHMARK_DELAY_MS ?? "4000", 10));

const TIMEOUT_MS = 60_000;

// =============================================================================
// Gemini client
// =============================================================================

const genai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

// =============================================================================
// Probe definitions
// =============================================================================

/**
 * Each probe has:
 *   id        — short identifier used in the output table
 *   label     — human-readable description
 *   buildPrompt  — returns the prompt string to send
 *   contents  — how to structure the contents array (single user turn vs multi-turn)
 */
type ProbeContents = Array<{ role: string; parts: Array<{ text: string }> }>;

type Probe = {
  id: string;
  label: string;
  buildContents: () => ProbeContents;
};

// ── Probe 1: extraction, small output ────────────────────────────────────────
// A short scene with a minimal extraction request. Designed to isolate TTFT
// with nearly no output tokens.
const PROBE_1_SCENE = `\
INT. EMBASSY BALLROOM - NIGHT

A string quartet plays in the corner. CLARA VOSS (30s, composed) scans the room from a doorway.
She spots MEINHARDT (50s, imperious) near the bar, the SIGNAL WATCH visible on her wrist.
`;

const PROBE_1_PROMPT = `\
You are extracting structured story data from a screenplay scene.

Scene text:
${PROBE_1_SCENE}

Extract ONLY the entities mentioned. Return a JSON object with a single key "entities", which is an array of objects with fields: canonicalName (string), entityType ("person"|"object"|"location").

No explanation. Respond with valid JSON only.`;

// ── Probe 2: extraction, large output ────────────────────────────────────────
// Mirrors the real Story Analyst prompt shape. Large instruction block +
// a moderately complex scene. Expected output: multiple claims, entities,
// events, all with rationale fields — mimics the 2.5 k token output case.
const PROBE_2_SYSTEM = `\
You are the Story Analyst for a continuity-tracking system for cinematic universes.

Your task is to extract structured story facts from a screenplay scene. You must identify:
1. CLAIMS — factual assertions about the state of an entity (location, possession, knowledge, identity, status, relationship).
   Each claim has: entityName, property, value, sourceType ("explicit"|"implicit"|"inferred"), confidence (0-1), confidenceRationale (one sentence), sourceLine (verbatim quote from scene).
2. ENTITIES — distinct characters, objects, and named locations appearing in the scene.
   Each entity has: canonicalName, entityType ("person"|"object"|"location"), aliases (array of strings).
3. EVENTS — significant actions that change or reveal story state.
   Each event has: subject, action, object (nullable), description (one sentence).

Output format — exactly this JSON schema, no markdown, no explanation outside the object:
{
  "claims": [ { "entityName": "", "property": "", "value": "", "sourceType": "", "confidence": 0.0, "confidenceRationale": "", "sourceLine": "" } ],
  "entities": [ { "canonicalName": "", "entityType": "", "aliases": [] } ],
  "events": [ { "subject": "", "action": "", "object": null, "description": "" } ]
}

Rules:
- Every claim must reference an entity in the entities array.
- confidence must be between 0.0 and 1.0.
- sourceType "explicit" = directly stated. "implicit" = strongly implied. "inferred" = reasoned from context.
- Include at least one claim per named entity.
- Do NOT invent facts not present in the scene.
- sourceLine must be a verbatim fragment from the scene text, maximum 120 characters.`;

const PROBE_2_SCENE = `\
INT. MEINHARDT'S STUDY - NIGHT (SCENE 5)

Story unit: "The Voss Cipher" — World War II, 1943. Scene 5 of 14.
Known state from prior scenes: Clara Voss (agent) is operating undercover. Meinhardt is a high-ranking official.

MEINHARDT moves to a heavy iron SAFE built into the bookcase wall. He turns the combination, the door swings open. Inside, among papers, sits the CIPHER DEVICE — a brass instrument the size of a typewriter.

MEINHARDT
(to aide)
The cipher goes nowhere. No one touches it.

He closes the safe. The lock clicks.

HARTLEY (O.S.)
(through earpiece)
Agent Voss, do you copy? We need the cipher's configuration before dawn.

Clara watches from the darkened doorway, unseen.
`;

const PROBE_2_PROMPT = `\
${PROBE_2_SYSTEM}

Scene text:
${PROBE_2_SCENE}

Extract all claims, entities, and events from this scene. Be thorough — each named entity should have multiple claims if the scene supports them.`;

// ── Probe 3: temporal ordering (Guardian) ────────────────────────────────────
// Short prompt, short JSON output. Mirrors askGeminiForTemporalOrder exactly.
// This probe measures raw TTFT + minimal generation cost.
const PROBE_3_PROMPT = `\
You are determining the temporal relationship between two story units in a shared fictional universe.

Story Unit A:
  Title:          The Voss Cipher
  In-universe period: World War II, 1943
  In-universe date start: 1943
  Release order:  1

Story Unit B:
  Title:          The Voss Legacy
  In-universe period: Cold War, 1962
  In-universe date start: 1962
  Release order:  2

Determine whether the in-universe events of Story Unit A occur BEFORE, AFTER, or OVERLAPPING with those of Story Unit B.

If the relationship cannot be determined from the available information, respond with INDETERMINATE.

Respond with exactly one JSON object. No markdown. No explanation outside the JSON.

{
  "relation": "before" | "after" | "overlapping" | "indeterminate",
  "reasoning": "One concise sentence explaining the basis for this classification."
}`;

const PROBES: Probe[] = [
  {
    id: "P1",
    label: "Extraction — small output (TTFT probe)",
    buildContents: () => [
      { role: "user", parts: [{ text: PROBE_1_PROMPT }] },
    ],
  },
  {
    id: "P2",
    label: "Extraction — large output (real workload)",
    buildContents: () => [
      { role: "user", parts: [{ text: PROBE_2_SYSTEM }] },
      { role: "model", parts: [{ text: "Understood. Ready to extract." }] },
      { role: "user", parts: [{ text: `Scene text:\n${PROBE_2_SCENE}\n\nExtract all claims, entities, and events from this scene. Be thorough — each named entity should have multiple claims if the scene supports them.` }] },
    ],
  },
  {
    id: "P3",
    label: "Temporal ordering (Guardian)",
    buildContents: () => [
      { role: "user", parts: [{ text: PROBE_3_PROMPT }] },
    ],
  },
];

// =============================================================================
// Types
// =============================================================================

type RepResult = {
  rep: number;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Characters in the response text, useful when token counts unavailable. */
  outputChars: number;
  error: string | null;
};

type ProbeResult = {
  probeId: string;
  probeLabel: string;
  reps: RepResult[];
  stats: {
    successCount: number;
    failCount: number;
    meanMs: number | null;
    medianMs: number | null;
    p95Ms: number | null;
    minMs: number | null;
    maxMs: number | null;
    meanInputTokens: number | null;
    meanOutputTokens: number | null;
    /** output tokens / second, mean across successful reps */
    meanThroughputToksPerSec: number | null;
  };
};

type ModelResult = {
  model: string;
  probes: ProbeResult[];
};

type BenchmarkOutput = {
  runTimestamp: string;
  config: {
    models: string[];
    reps: number;
    delayMs: number;
    timeoutMs: number;
    probes: string[];
  };
  results: ModelResult[];
};

// =============================================================================
// Stats helpers
// =============================================================================

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeStats(reps: RepResult[]): ProbeResult["stats"] {
  const successful = reps.filter((r) => r.error === null);
  const durations = successful.map((r) => r.durationMs).sort((a, b) => a - b);

  const inputTokens = successful
    .map((r) => r.inputTokens)
    .filter((t): t is number => t !== null);
  const outputTokens = successful
    .map((r) => r.outputTokens)
    .filter((t): t is number => t !== null);

  const throughputs = successful
    .filter((r) => r.outputTokens !== null)
    .map((r) => (r.outputTokens! / r.durationMs) * 1000);

  return {
    successCount: successful.length,
    failCount: reps.length - successful.length,
    meanMs: durations.length > 0 ? Math.round(mean(durations)) : null,
    medianMs: durations.length > 0 ? percentile(durations, 50) : null,
    p95Ms: durations.length > 0 ? percentile(durations, 95) : null,
    minMs: durations.length > 0 ? durations[0] : null,
    maxMs: durations.length > 0 ? durations[durations.length - 1] : null,
    meanInputTokens: inputTokens.length > 0 ? Math.round(mean(inputTokens)) : null,
    meanOutputTokens: outputTokens.length > 0 ? Math.round(mean(outputTokens)) : null,
    meanThroughputToksPerSec:
      throughputs.length > 0
        ? Math.round(mean(throughputs) * 10) / 10
        : null,
  };
}

// =============================================================================
// Single Gemini call
// =============================================================================

async function callGemini(
  model: string,
  contents: ProbeContents,
): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Timed out after ${TIMEOUT_MS}ms`)),
      TIMEOUT_MS,
    ),
  );

  const geminiPromise = genai.models.generateContent({
    model,
    contents,
    config: { responseMimeType: "application/json" },
  });

  const response = await Promise.race([geminiPromise, timeoutPromise]);

  const text = response.text?.trim() ?? "";
  if (!text) throw new Error("Empty response from model");

  // usageMetadata field names vary slightly across SDK versions.
  // Access defensively.
  const meta = (response as unknown as Record<string, unknown>).usageMetadata as
    | Record<string, number>
    | undefined;

  const inputTokens =
    meta?.promptTokenCount ?? meta?.inputTokenCount ?? null;
  const outputTokens =
    meta?.candidatesTokenCount ?? meta?.outputTokenCount ?? null;

  return {
    text,
    inputTokens: typeof inputTokens === "number" ? inputTokens : null,
    outputTokens: typeof outputTokens === "number" ? outputTokens : null,
  };
}

// =============================================================================
// Sleep helper
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Run a single probe × model
// =============================================================================

async function runProbe(
  model: string,
  probe: Probe,
  isFirstCall: boolean,
): Promise<ProbeResult> {
  const reps: RepResult[] = [];

  for (let rep = 1; rep <= REPS; rep++) {
    // Rate-limit delay before every call except the very first
    if (!(isFirstCall && rep === 1)) {
      process.stdout.write(`    [delay ${DELAY_MS}ms] `);
      await sleep(DELAY_MS);
    }

    process.stdout.write(`rep ${rep}/${REPS} … `);

    const start = Date.now();
    try {
      const result = await callGemini(model, probe.buildContents());
      const durationMs = Date.now() - start;

      reps.push({
        rep,
        durationMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        outputChars: result.text.length,
        error: null,
      });

      const tokenInfo =
        result.outputTokens !== null
          ? ` | ${result.inputTokens ?? "?"}→${result.outputTokens} tok`
          : ` | ${result.outputChars} chars`;

      process.stdout.write(`${durationMs}ms${tokenInfo}\n`);
    } catch (err) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);

      reps.push({
        rep,
        durationMs,
        inputTokens: null,
        outputTokens: null,
        outputChars: 0,
        error: message,
      });

      process.stdout.write(`ERROR: ${message.slice(0, 80)}\n`);
    }
  }

  return {
    probeId: probe.id,
    probeLabel: probe.label,
    reps,
    stats: computeStats(reps),
  };
}

// =============================================================================
// Human-readable report
// =============================================================================

function buildReport(output: BenchmarkOutput): string {
  const lines: string[] = [];

  lines.push("═".repeat(78));
  lines.push("  GEMINI MODEL BENCHMARK");
  lines.push(`  Run: ${output.runTimestamp}`);
  lines.push(
    `  Models: ${output.config.models.join(", ")}  |  Reps: ${output.config.reps}  |  Delay: ${output.config.delayMs}ms`,
  );
  lines.push("═".repeat(78));
  lines.push("");

  // ── Per-probe summary table ───────────────────────────────────────────────
  for (const probe of PROBES) {
    lines.push(`  ${probe.id}: ${probe.label}`);
    lines.push("  " + "─".repeat(76));

    const header = [
      "  Model".padEnd(26),
      "Mean".padStart(8),
      "Median".padStart(8),
      "p95".padStart(8),
      "Min".padStart(8),
      "Max".padStart(8),
      "Out tok".padStart(9),
      "Tok/s".padStart(7),
      "Ok/Tot".padStart(7),
    ].join("");
    lines.push(header);
    lines.push("  " + "─".repeat(76));

    for (const modelResult of output.results) {
      const pr = modelResult.probes.find((p) => p.probeId === probe.id);
      if (!pr) continue;
      const s = pr.stats;

      const fmt = (v: number | null, suffix = "ms") =>
        v !== null ? `${v}${suffix}` : "—";

      const row = [
        `  ${modelResult.model}`.padEnd(26),
        fmt(s.meanMs).padStart(8),
        fmt(s.medianMs).padStart(8),
        fmt(s.p95Ms).padStart(8),
        fmt(s.minMs).padStart(8),
        fmt(s.maxMs).padStart(8),
        (s.meanOutputTokens !== null ? String(s.meanOutputTokens) : "—").padStart(9),
        (s.meanThroughputToksPerSec !== null
          ? String(s.meanThroughputToksPerSec)
          : "—").padStart(7),
        `${s.successCount}/${s.successCount + s.failCount}`.padStart(7),
      ].join("");
      lines.push(row);
    }

    lines.push("");
  }

  // ── Speed ratio vs baseline (first model) ────────────────────────────────
  lines.push("─".repeat(78));
  lines.push("  SPEED RATIO vs baseline (first model listed)");
  lines.push("─".repeat(78));
  lines.push("");

  const baseline = output.results[0];
  if (baseline) {
    for (const probe of PROBES) {
      const baselineProbe = baseline.probes.find((p) => p.probeId === probe.id);
      const baseMean = baselineProbe?.stats.meanMs;
      if (baseMean == null) continue;

      lines.push(`  ${probe.id} (${probe.label.split(" — ")[0]}):`);
      for (const modelResult of output.results) {
        const pr = modelResult.probes.find((p) => p.probeId === probe.id);
        const modelMean = pr?.stats.meanMs;
        if (modelMean == null) {
          lines.push(`    ${modelResult.model.padEnd(24)}  —`);
          continue;
        }
        const ratio = modelMean / baseMean;
        const direction =
          ratio < 0.95 ? "faster ✓" : ratio > 1.05 ? "slower ✗" : "similar";
        lines.push(
          `    ${modelResult.model.padEnd(24)}  ${ratio.toFixed(2)}x  ${direction}`,
        );
      }
      lines.push("");
    }
  }

  // ── Recommendation ────────────────────────────────────────────────────────
  lines.push("─".repeat(78));
  lines.push("  RECOMMENDATION");
  lines.push("─".repeat(78));
  lines.push("");

  // Find the model with the lowest mean on P2 (the real workload) among
  // models that had no failures.
  const p2Results = output.results
    .map((mr) => ({
      model: mr.model,
      probe: mr.probes.find((p) => p.probeId === "P2"),
    }))
    .filter(
      (r) =>
        r.probe &&
        r.probe.stats.failCount === 0 &&
        r.probe.stats.meanMs !== null,
    )
    .sort((a, b) => a.probe!.stats.meanMs! - b.probe!.stats.meanMs!);

  if (p2Results.length > 0) {
    const winner = p2Results[0];
    const winnerP2 = winner.probe!.stats.meanMs!;
    const baselineP2 = output.results[0]?.probes.find((p) => p.probeId === "P2")?.stats.meanMs;

    if (baselineP2 != null && winner.model !== output.results[0]?.model) {
      const saving = Math.round(((baselineP2 - winnerP2) / baselineP2) * 100);
      lines.push(
        `  Fastest on P2 (real workload): ${winner.model}`,
      );
      lines.push(
        `  Mean P2 latency: ${winnerP2}ms vs ${baselineP2}ms baseline (${saving > 0 ? `${saving}% faster` : `${Math.abs(saving)}% slower`})`,
      );
      lines.push("");
      if (saving > 10) {
        lines.push(
          `  → Consider switching GEMINI_MODEL in config/models.ts to "${winner.model}".`,
        );
      } else {
        lines.push(
          `  → Difference is small (<10%). Consider other factors (quality, cost).`,
        );
      }
    } else {
      lines.push(
        `  Baseline model "${output.results[0]?.model}" is already the fastest on P2.`,
      );
    }
  } else {
    lines.push("  Not enough successful P2 results to make a recommendation.");
  }

  lines.push("");
  lines.push("═".repeat(78));

  return lines.join("\n");
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  const jsonFile = path.join(OUTPUT_DIR, `benchmark-${ts}.json`);
  const txtFile = path.join(OUTPUT_DIR, `benchmark-${ts}.txt`);

  const totalCalls = CANDIDATE_MODELS.length * PROBES.length * REPS;
  const estimatedMinutes = Math.ceil(
    (totalCalls * (DELAY_MS + 15_000)) / 60_000,
  );

  console.log("═".repeat(78));
  console.log("  GEMINI MODEL BENCHMARK");
  console.log("═".repeat(78));
  console.log(`  Models  : ${CANDIDATE_MODELS.join(", ")}`);
  console.log(`  Probes  : ${PROBES.map((p) => `${p.id} (${p.label})`).join("\n            ")}`);
  console.log(`  Reps    : ${REPS} per probe per model`);
  console.log(`  Delay   : ${DELAY_MS}ms between calls`);
  console.log(`  Timeout : ${TIMEOUT_MS}ms per call`);
  console.log(`  Total   : ${totalCalls} API calls, ~${estimatedMinutes} min estimated`);
  console.log(`  Output  : ${jsonFile}`);
  console.log("═".repeat(78));
  console.log();

  const allModelResults: ModelResult[] = [];
  let globalCallCount = 0;

  for (const model of CANDIDATE_MODELS) {
    console.log(`\n  ── Model: ${model} ──`);
    const modelProbeResults: ProbeResult[] = [];

    for (const probe of PROBES) {
      console.log(`\n  ${probe.id}: ${probe.label}`);
      const isFirstCall = globalCallCount === 0;
      const result = await runProbe(model, probe, isFirstCall);
      modelProbeResults.push(result);
      globalCallCount += REPS;

      // Print mini-summary per probe
      const s = result.stats;
      if (s.successCount > 0) {
        console.log(
          `    → mean ${s.meanMs}ms  median ${s.medianMs}ms  p95 ${s.p95Ms}ms` +
            (s.meanOutputTokens !== null
              ? `  |  out ~${s.meanOutputTokens} tok`
              : "") +
            (s.meanThroughputToksPerSec !== null
              ? `  @ ${s.meanThroughputToksPerSec} tok/s`
              : ""),
        );
      }
      if (s.failCount > 0) {
        console.log(`    ⚠ ${s.failCount}/${REPS} reps failed`);
      }
    }

    allModelResults.push({ model, probes: modelProbeResults });
  }

  // Build and write outputs
  const output: BenchmarkOutput = {
    runTimestamp: now.toISOString(),
    config: {
      models: CANDIDATE_MODELS,
      reps: REPS,
      delayMs: DELAY_MS,
      timeoutMs: TIMEOUT_MS,
      probes: PROBES.map((p) => `${p.id}: ${p.label}`),
    },
    results: allModelResults,
  };

  const report = buildReport(output);

  fs.writeFileSync(jsonFile, JSON.stringify(output, null, 2));
  fs.writeFileSync(txtFile, report);

  console.log("\n" + report);
  console.log(`\n  Full results : ${jsonFile}`);
  console.log(`  Report       : ${txtFile}\n`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
