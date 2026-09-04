/**
 * iterate-prompt.ts
 *
 * Prompt iteration script for Task 7 — Story Analyst extraction.
 *
 * Runs extractScene against all 14 scenes of fixtures/film-a.txt and
 * produces two timestamped files in backend/scripts/output/:
 *
 *   film-a-extraction-<timestamp>.json   — full raw output, all scenes
 *   film-a-summary-<timestamp>.txt       — pass/fail report against spec criteria
 *
 * Run with:
 *   pnpm tsx scripts/iterate-prompt.ts
 *
 * Context summary is intentionally empty for all scenes in this loop.
 * There is no ClickHouse at this stage — that is Task 8. The purpose here
 * is to verify extraction quality, not context injection. Scenes therefore
 * see no prior state, which means the extractor must produce claims purely
 * from the scene text. That is the right condition for validating the prompt.
 *
 * Done criteria (from tasks.md Task 7):
 *   C1. Cipher Device location contradiction captured:
 *       scene 5 claims location = "Meinhardt's safe" (or equivalent)
 *       scene 8 claims location = "Clara's possession" (or equivalent)
 *       Both on entity "Cipher Device", same property, different values
 *   C2. Dr. Hartley knowledge contradiction captured:
 *       scene 6 claims Hartley does not know cipher location/existence
 *       scene 7 claims Hartley has deduced cipher configuration
 *       Both on entity "Dr. Hartley", knowledge property, different values
 *   C3. Signal Watch carry event captured in scene 3:
 *       An event with action referencing "Signal Watch" or "watch" exists in scene 3
 *   C4. Signal Watch possession claim in scene 3 or 4:
 *       Clara Voss has possession/location claim for Signal Watch
 *   C5. All 4 named objects tracked as entities across the full run:
 *       Cipher Device, Red Ledger, Signal Watch, Photograph
 *   C6. No scene produces zero claims
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseScreenplayText } from "../src/parser/text.js";
import { extractScene } from "../src/agents/story-analyst/extractor.js";
import { ExtractionError, type SceneExtraction } from "../src/types/index.js";
import type { Scene, StoryUnit } from "../src/types/index.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/film-a.txt");
const OUTPUT_DIR = path.resolve(__dirname, "output");

// ---------------------------------------------------------------------------
// Stub story unit — mirrors the fixture metadata exactly
// ---------------------------------------------------------------------------

const FILM_A_UNIT: StoryUnit = {
  storyUnitId: "iterate-prompt-stub",
  projectId: "iterate-prompt-stub",
  universeId: "iterate-prompt-stub",
  title: "The Voss Cipher",
  unitType: "film",
  seasonNumber: null,
  episodeNumber: null,
  inUniversePeriod: "World War II, 1943",
  inUniverseDateStart: 1943,
  inUniverseDateEnd: 1943,
  releaseOrder: 1,
  ingestionStatus: "pending",
  sceneCount: 0,
  claimCount: 0,
};

// ---------------------------------------------------------------------------
// Scene result shape — what we accumulate per scene
// ---------------------------------------------------------------------------

type SceneResult = {
  sceneNumber: number;
  heading: string;
  status: "ok" | "failed";
  extraction: SceneExtraction | null;
  error: string | null;
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Build timestamp string: YYYYMMDD-HHmmss
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

  const extractionFile = path.join(OUTPUT_DIR, `film-a-extraction-${ts}.json`);
  const summaryFile = path.join(OUTPUT_DIR, `film-a-summary-${ts}.txt`);

  console.log("─".repeat(60));
  console.log("  Story Analyst — Prompt Iteration Script");
  console.log("─".repeat(60));
  console.log(`  Fixture : ${FIXTURE_PATH}`);
  console.log(`  Output  : ${extractionFile}`);
  console.log(`  Summary : ${summaryFile}`);
  console.log("─".repeat(60));

  // Parse the fixture
  const rawText = fs.readFileSync(FIXTURE_PATH, "utf-8");
  const { scenes: parsedScenes, preamble } = parseScreenplayText(rawText);

  if (parsedScenes.length === 0) {
    console.error("ERROR: Parser produced zero scenes. Check the fixture.");
    process.exit(1);
  }

  console.log(
    `\n  Parsed ${parsedScenes.length} scenes (preamble: ${preamble.length > 0 ? "present" : "empty"})\n`,
  );

  const sceneTotal = parsedScenes.length;
  const results: SceneResult[] = [];

  // Build stub Scene objects from ParsedScene
  for (const ps of parsedScenes) {
    const scene: Scene = {
      sceneId: `stub-scene-${ps.sceneNumber}`,
      storyUnitId: FILM_A_UNIT.storyUnitId,
      projectId: FILM_A_UNIT.projectId,
      universeId: FILM_A_UNIT.universeId,
      sceneNumber: ps.sceneNumber,
      heading: ps.heading,
      rawText: ps.rawText,
      summary: "",
      ingestionStatus: "pending",
    };

    process.stdout.write(
      `  Scene ${String(ps.sceneNumber).padStart(2, " ")} / ${sceneTotal}  ${ps.heading.slice(0, 55).padEnd(55, " ")}  `,
    );

    const start = Date.now();

    try {
      // Empty context summary — no ClickHouse at this stage
      const extraction = await extractScene(scene, FILM_A_UNIT, "", sceneTotal);
      const durationMs = Date.now() - start;

      results.push({
        sceneNumber: ps.sceneNumber,
        heading: ps.heading,
        status: "ok",
        extraction,
        error: null,
        durationMs,
      });

      const claimCount = extraction.claims.length;
      const entityCount = extraction.entities.length;
      const eventCount = extraction.events.length;

      console.log(
        `✓  ${claimCount} claims  ${entityCount} entities  ${eventCount} events  (${durationMs}ms)`,
      );
    } catch (err) {
      const durationMs = Date.now() - start;
      const message =
        err instanceof ExtractionError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);

      results.push({
        sceneNumber: ps.sceneNumber,
        heading: ps.heading,
        status: "failed",
        extraction: null,
        error: message,
        durationMs,
      });

      console.log(`✗  FAILED (${durationMs}ms)`);
      console.log(`       ${message.slice(0, 120)}`);
    }
  }

  // Write full extraction JSON
  const extractionOutput = {
    runTimestamp: now.toISOString(),
    fixture: "film-a.txt",
    sceneTotal,
    scenes: results.map((r) => ({
      sceneNumber: r.sceneNumber,
      heading: r.heading,
      status: r.status,
      durationMs: r.durationMs,
      extraction: r.extraction,
      error: r.error,
    })),
  };

  fs.writeFileSync(extractionFile, JSON.stringify(extractionOutput, null, 2));

  // Run criteria checks and write summary
  const summary = buildSummary(results, ts);
  fs.writeFileSync(summaryFile, summary);

  // Print summary to terminal too
  console.log("\n" + summary);
  console.log(`\n  Full extraction: ${extractionFile}`);
  console.log(`  Summary       : ${summaryFile}\n`);
}

// ---------------------------------------------------------------------------
// Criteria checks
// ---------------------------------------------------------------------------

type CriterionResult = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

function buildSummary(results: SceneResult[], ts: string): string {
  const lines: string[] = [];

  lines.push("═".repeat(60));
  lines.push("  PROMPT ITERATION SUMMARY");
  lines.push(`  Run: ${ts}`);
  lines.push("═".repeat(60));
  lines.push("");

  const criteria = runCriteria(results);
  const passed = criteria.filter((c) => c.pass).length;
  const total = criteria.length;

  lines.push(`  ${passed} / ${total} criteria passing\n`);

  for (const c of criteria) {
    const mark = c.pass ? "PASS" : "FAIL";
    lines.push(`  [${mark}] ${c.id} — ${c.label}`);
    lines.push(`         ${c.detail}`);
    lines.push("");
  }

  lines.push("─".repeat(60));
  lines.push("  PER-SCENE OVERVIEW");
  lines.push("─".repeat(60));
  lines.push("");

  for (const r of results) {
    if (r.status === "failed") {
      lines.push(`  Scene ${String(r.sceneNumber).padStart(2, " ")}  FAILED`);
      lines.push(`         ${r.error?.slice(0, 100) ?? ""}`);
    } else if (r.extraction) {
      const e = r.extraction;
      const entityNames = e.entities.map((en) => en.canonicalName).join(", ");
      lines.push(
        `  Scene ${String(r.sceneNumber).padStart(2, " ")}  ` +
          `${e.claims.length} claims  ${e.entities.length} entities  ${e.events.length} events`,
      );
      lines.push(`         Entities: ${entityNames || "(none)"}`);

      // Print each claim concisely
      for (const cl of e.claims) {
        lines.push(
          `         Claim: [${cl.entityName}] ${cl.property} = "${cl.value}" ` +
            `(${cl.sourceType}, ${cl.confidence.toFixed(2)})`,
        );
      }

      // Print each event concisely
      for (const ev of e.events) {
        const obj = ev.object ? ` → ${ev.object}` : "";
        lines.push(`         Event: [${ev.subject}] ${ev.action}${obj}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function runCriteria(results: SceneResult[]): CriterionResult[] {
  const criteria: CriterionResult[] = [];

  // Helper: get extraction for a scene number, or null
  const getExtraction = (n: number) =>
    results.find((r) => r.sceneNumber === n)?.extraction ?? null;

  // Helper: find claims on a given entity name (case-insensitive partial match)
  const claimsFor = (extraction: SceneExtraction, entityFragment: string) =>
    extraction.claims.filter((c) =>
      c.entityName.toLowerCase().includes(entityFragment.toLowerCase()),
    );

  // ─── C1: Cipher Device location contradiction ────────────────────────────
  {
    const s5 = getExtraction(5);
    const s8 = getExtraction(8);

    const s5Claims = s5 ? claimsFor(s5, "cipher") : [];
    const s8Claims = s8 ? claimsFor(s8, "cipher") : [];

    const s5LocationClaims = s5Claims.filter(
      (c) =>
        c.property.toLowerCase().includes("location") ||
        c.property.toLowerCase().includes("possession"),
    );
    const s8LocationClaims = s8Claims.filter(
      (c) =>
        c.property.toLowerCase().includes("location") ||
        c.property.toLowerCase().includes("possession"),
    );

    // Check that scene 5 places it somewhere secure (safe/Meinhardt) and
    // scene 8 places it with Clara
    const s5HasSafe = s5LocationClaims.some(
      (c) =>
        c.value.toLowerCase().includes("safe") ||
        c.value.toLowerCase().includes("meinhardt"),
    );
    const s8HasClara = s8LocationClaims.some(
      (c) =>
        c.value.toLowerCase().includes("clara") ||
        c.value.toLowerCase().includes("satchel") ||
        c.value.toLowerCase().includes("possession") ||
        c.value.toLowerCase().includes("stairwell"),
    );

    const pass = s5HasSafe && s8HasClara;

    criteria.push({
      id: "C1",
      label: "Cipher Device location contradiction captured (scenes 5 and 8)",
      pass,
      detail: pass
        ? `Scene 5: "${s5LocationClaims[0]?.value ?? "?"}"  |  Scene 8: "${s8LocationClaims[0]?.value ?? "?"}"`
        : `Scene 5 safe claim: ${s5HasSafe} (${s5LocationClaims.map((c) => `${c.property}="${c.value}"`).join(", ") || "none"})` +
          `  |  Scene 8 Clara claim: ${s8HasClara} (${s8LocationClaims.map((c) => `${c.property}="${c.value}"`).join(", ") || "none"})`,
    });
  }

  // ─── C2: Dr. Hartley knowledge contradiction ─────────────────────────────
  {
    const s6 = getExtraction(6);
    const s7 = getExtraction(7);

    const s6Claims = s6 ? claimsFor(s6, "hartley") : [];
    const s7Claims = s7 ? claimsFor(s7, "hartley") : [];

    const s6KnowledgeClaims = s6Claims.filter(
      (c) =>
        c.property.toLowerCase().includes("knowledge") ||
        c.property.toLowerCase().includes("aware") ||
        c.property.toLowerCase().includes("know"),
    );
    const s7KnowledgeClaims = s7Claims.filter(
      (c) =>
        c.property.toLowerCase().includes("knowledge") ||
        c.property.toLowerCase().includes("aware") ||
        c.property.toLowerCase().includes("know") ||
        c.property.toLowerCase().includes("deduc") ||
        c.property.toLowerCase().includes("configuration") ||
        c.property.toLowerCase().includes("belief"),
    );

    const s6HasUnaware = s6KnowledgeClaims.some(
      (c) =>
        c.value.toLowerCase().includes("unaware") ||
        c.value.toLowerCase().includes("does not know") ||
        c.value.toLowerCase().includes("not know") ||
        c.value.toLowerCase().includes("no knowledge") ||
        c.value.toLowerCase().includes("blind"),
    );

    // Scene 7 must have a knowledge claim AND its value must differ from
    // scene 6's value. A model that returns "unaware" for both scenes would
    // not represent a genuine contradiction and should not pass C2.
    const s6FirstValue = s6KnowledgeClaims[0]?.value.toLowerCase() ?? "";
    const s7HasKnowledge =
      s7KnowledgeClaims.length > 0 &&
      s7KnowledgeClaims.some((c) => c.value.toLowerCase() !== s6FirstValue);

    const pass = s6HasUnaware && s7HasKnowledge;

    criteria.push({
      id: "C2",
      label: "Dr. Hartley knowledge state captured (scenes 6 and 7)",
      pass,
      detail: pass
        ? `Scene 6: "${s6KnowledgeClaims[0]?.value ?? "?"}"  |  Scene 7: "${s7KnowledgeClaims[0]?.value ?? "?"}"`
        : `Scene 6 unaware: ${s6HasUnaware} (${s6KnowledgeClaims.map((c) => `${c.property}="${c.value}"`).join(", ") || "none"})` +
          `  |  Scene 7 knowledge: ${s7HasKnowledge} (${s7KnowledgeClaims.map((c) => `${c.property}="${c.value}"`).join(", ") || "none"})`,
    });
  }

  // ─── C3: Signal Watch carry event in scene 3 ─────────────────────────────
  {
    const s3 = getExtraction(3);
    const events = s3?.events ?? [];

    const watchEvent = events.find(
      (ev) =>
        (ev.subject.toLowerCase().includes("clara") ||
          ev.object?.toLowerCase().includes("clara")) &&
        (ev.action.toLowerCase().includes("watch") ||
          ev.object?.toLowerCase().includes("watch") ||
          ev.subject.toLowerCase().includes("watch") ||
          ev.description.toLowerCase().includes("watch")),
    );

    // Also accept: carry event where object is signal watch
    const carryEvent = events.find(
      (ev) =>
        ev.object?.toLowerCase().includes("watch") ||
        ev.action.toLowerCase().includes("watch"),
    );

    const pass = !!(watchEvent || carryEvent);

    criteria.push({
      id: "C3",
      label: "Signal Watch carry event extracted in scene 3",
      pass,
      detail: pass
        ? `Event: [${(watchEvent ?? carryEvent)?.subject}] ${(watchEvent ?? carryEvent)?.action} → ${(watchEvent ?? carryEvent)?.object ?? "—"}`
        : `No watch-related event found in scene 3. Events: ${events.map((e) => e.action).join(", ") || "(none)"}`,
    });
  }

  // ─── C4: Signal Watch possession claim on Clara ───────────────────────────
  {
    const s3 = getExtraction(3);
    const s4 = getExtraction(4);

    const allClaims = [...(s3?.claims ?? []), ...(s4?.claims ?? [])];

    const watchClaim = allClaims.find(
      (c) =>
        (c.entityName.toLowerCase().includes("clara") ||
          c.entityName.toLowerCase().includes("voss")) &&
        (c.property.toLowerCase().includes("possession") ||
          c.property.toLowerCase().includes("wear") ||
          c.property.toLowerCase().includes("carry") ||
          c.property.toLowerCase().includes("watch")),
    );

    // Also accept: watch entity with possession claim pointing to Clara
    const watchEntityClaim = allClaims.find(
      (c) =>
        c.entityName.toLowerCase().includes("watch") &&
        (c.property.toLowerCase().includes("possession") ||
          c.property.toLowerCase().includes("location") ||
          c.property.toLowerCase().includes("owner")) &&
        c.value.toLowerCase().includes("clara"),
    );

    const pass = !!(watchClaim || watchEntityClaim);

    criteria.push({
      id: "C4",
      label: "Signal Watch possession claim on Clara extracted (scene 3 or 4)",
      pass,
      detail: pass
        ? `Claim: [${(watchClaim ?? watchEntityClaim)?.entityName}] ${(watchClaim ?? watchEntityClaim)?.property} = "${(watchClaim ?? watchEntityClaim)?.value}"`
        : `No Signal Watch possession claim found in scenes 3–4`,
    });
  }

  // ─── C5: All 4 named objects tracked ─────────────────────────────────────
  {
    const allEntityNames = results
      .flatMap((r) => r.extraction?.entities ?? [])
      .map((e) => e.canonicalName.toLowerCase());

    const targets = [
      { label: "Cipher Device", fragments: ["cipher device", "cipher"] },
      { label: "Red Ledger", fragments: ["red ledger", "ledger"] },
      { label: "Signal Watch", fragments: ["signal watch", "watch"] },
      { label: "Photograph", fragments: ["photograph", "photo"] },
    ];

    const found = targets.map((t) => ({
      label: t.label,
      found: t.fragments.some((f) => allEntityNames.some((n) => n.includes(f))),
    }));

    const pass = found.every((f) => f.found);
    const detail = found
      .map((f) => `${f.label}: ${f.found ? "✓" : "✗"}`)
      .join("  ");

    criteria.push({
      id: "C5",
      label: "All 4 named objects tracked as entities across all scenes",
      pass,
      detail,
    });
  }

  // ─── C6: No scene with zero claims ───────────────────────────────────────
  {
    const zeroClaims = results.filter(
      (r) => r.status === "ok" && (r.extraction?.claims.length ?? 0) === 0,
    );
    const failed = results.filter((r) => r.status === "failed");

    const pass = zeroClaims.length === 0 && failed.length === 0;

    const detail = pass
      ? "All scenes produced at least one claim"
      : [
          zeroClaims.length > 0
            ? `Zero-claim scenes: ${zeroClaims.map((r) => r.sceneNumber).join(", ")}`
            : "",
          failed.length > 0
            ? `Failed scenes: ${failed.map((r) => r.sceneNumber).join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("  |  ");

    criteria.push({
      id: "C6",
      label: "No scene produces zero claims and no scene fails",
      pass,
      detail,
    });
  }

  return criteria;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
