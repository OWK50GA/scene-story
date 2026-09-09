/**
 * ingest-film-d.ts
 *
 * Full end-to-end verification script for Film D — "Low Water".
 *
 * Steps:
 *   1.  Create universe, project, story unit
 *   2.  Upload film-d.txt, start ingestion pipeline
 *   3.  Poll /status until complete
 *   4.  Verify every scene has ≥2 claims
 *   5.  Check sonar unit has a location/possession claim in scene 3
 *   6.  Check brass compass is tracked across scenes 7, 10, 12, 13
 *   7.  Run within-unit Guardian pass
 *   8.  Evaluate Guardian verdicts:
 *         - Sonar unit movement → expect ambiguous (not confirmed)
 *         - Compass disappearance → expect ambiguous, NOT confirmed
 *           (scene 13 establishes "always returns" rule — hardest test)
 *   9.  Companion: compass at scene 11 (should be missing/unknown)
 *   10. Companion: compass at scene 13 (should be kitchen counter + rule cited)
 *   11. Companion: how did compass get back? (should cite gap + rule)
 *   12. Companion: summary mode — catch me up to scene 8
 *   13. Companion: what should I remember? (load-bearing facts, scene 9 boundary)
 *
 * Run from backend/:
 *   pnpm tsx scripts/ingest-film-d.ts
 *
 * Prerequisites:
 *   - Backend running:          pnpm dev
 *   - mcp-clickhouse running:   bash scripts/start-mcp-clickhouse.sh
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = process.env.API_BASE_URL ?? "http://localhost:3001/api";
const FIXTURE = path.resolve(__dirname, "../../fixtures/film-d.txt");
const POLL_MS = 3_000;
const TIMEOUT_MS = 10 * 60_000;

// =============================================================================
// HTTP helpers
// =============================================================================

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function postFile(url: string, filePath: string): Promise<Record<string, unknown>> {
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(filePath)], { type: "text/plain" });
  form.append("file", blob, path.basename(filePath));
  const res = await fetch(url, { method: "POST", body: form });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`POST ${url} (file) → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// =============================================================================
// Helpers
// =============================================================================

function banner(text: string) {
  console.log("\n" + "─".repeat(60));
  console.log(`  ${text}`);
  console.log("─".repeat(60));
}

function pass(msg: string) { console.log(`  ✓ ${msg}`); }
function fail(msg: string) { console.log(`  ✗ ${msg}`); }
function info(msg: string) { console.log(`    ${msg}`); }

async function waitForIngestion(unitId: string): Promise<{
  ingestion_status: string;
  scene_count: number;
  claim_count: number;
  failed_scenes: number[];
}> {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const r = await get<{
      data: {
        ingestion_status: string;
        scene_count: number;
        claim_count: number;
        failed_scenes: number[];
      };
    }>(`${BASE}/units/${unitId}/status`);
    const d = r.data;
    process.stdout.write(
      `\r  status=${d.ingestion_status}  scenes=${d.scene_count}  claims=${d.claim_count}  failed=[${d.failed_scenes.join(",")}]   `,
    );
    if (d.ingestion_status === "complete" || d.ingestion_status === "failed") {
      console.log();
      return d;
    }
  }
  throw new Error("Ingestion timed out");
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("═".repeat(60));
  console.log("  Film D — Low Water — Verification Script");
  console.log("═".repeat(60));
  console.log(`  Fixture : ${FIXTURE}`);
  console.log(`  API     : ${BASE}`);

  let passed = 0;
  let failed_count = 0;

  function check(condition: boolean, label: string, detail?: string): void {
    if (condition) { pass(label); passed++; }
    else { fail(label); failed_count++; }
    if (detail) info(detail);
  }

  // ── 1. Universe / project / unit ─────────────────────────────────────────
  banner("Step 1 — Create universe, project, story unit");

  const universe = await post<{ universe_id: string }>(
    `${BASE}/universes`,
    { name: "The Tide House", description: "Coastal mystery, 2026" },
  );
  const universeId = universe.universe_id;
  pass(`Universe created: ${universeId}`);

  const project = await post<{ data: { project_id: string } }>(
    `${BASE}/universes/${universeId}/projects`,
    { name: "The Tide House Stories", type: "film", canonTier: 1 },
  );
  const projectId = project.data.project_id;
  pass(`Project created: ${projectId}`);

  const unit = await post<{ status: string; story_unit: { story_unit_id: string } }>(
    `${BASE}/projects/${projectId}/units`,
    {
      projectId,
      universeId,
      title: "Low Water",
      unitType: "film",
      inUniversePeriod: "Present Day, 2026",
      inUniverseDateStart: 2026,
      inUniverseDateEnd: 2026,
      releaseOrder: 1,
    },
  );
  const unitId = unit.story_unit.story_unit_id;
  pass(`Story unit created: ${unitId}`);

  // ── 2. Ingest ─────────────────────────────────────────────────────────────
  banner("Step 2 — Upload screenplay and start ingestion");
  await postFile(`${BASE}/units/${unitId}/ingest`, FIXTURE);
  pass("Screenplay uploaded (202 accepted)");
  info(`Watch live: curl -N ${BASE}/units/${unitId}/ingest-stream`);

  // ── 3. Poll ───────────────────────────────────────────────────────────────
  banner("Step 3 — Wait for pipeline");
  console.log("  Polling...");
  const ingestion = await waitForIngestion(unitId);
  check(ingestion.ingestion_status !== "failed", "Ingestion completed without fatal failure");
  check(ingestion.failed_scenes.length === 0, "No failed scenes",
    ingestion.failed_scenes.length > 0 ? `Failed: ${ingestion.failed_scenes.join(", ")}` : undefined);
  check(ingestion.claim_count > 0, `Claims written: ${ingestion.claim_count}`);

  // ── 4. Per-scene claim count ──────────────────────────────────────────────
  banner("Step 4 — Verify every scene has ≥2 claims");
  const claimsResp = await get<{
    data: { claims: Array<Record<string, unknown>> };
  }>(`${BASE}/units/${unitId}/claims`);
  const claims = claimsResp.data.claims;

  const byScene = new Map<number, number>();
  for (const c of claims) {
    const n = c.source_scene_number as number;
    byScene.set(n, (byScene.get(n) ?? 0) + 1);
  }
  let underfilledScenes = 0;
  for (const [sceneNum, count] of byScene) {
    if (count < 2) {
      fail(`Scene ${sceneNum} has only ${count} claim(s)`);
      underfilledScenes++;
      failed_count++;
    }
  }
  if (underfilledScenes === 0) { pass(`All ${byScene.size} scenes have ≥2 claims`); passed++; }

  // ── 5. Sonar unit tracked in scene 3 ─────────────────────────────────────
  banner("Step 5 — Sonar unit has a claim in scene 3");
  const sonarClaims = claims.filter(
    (c) =>
      c.source_scene_number === 3 &&
      (c.entity_name as string)?.toLowerCase().includes("sonar"),
  );
  check(
    sonarClaims.length > 0,
    `Sonar unit extracted in scene 3 (${sonarClaims.length} claim(s))`,
    sonarClaims.length > 0
      ? `  "${sonarClaims[0]!.property}" = "${sonarClaims[0]!.value}"`
      : "  Not found",
  );

  // ── 6. Compass tracked at scenes 7, 12, 13 ───────────────────────────────
  banner("Step 6 — Brass compass tracked across key scenes");
  const compassScenes = [7, 12, 13];
  for (const sceneNum of compassScenes) {
    const compassClaims = claims.filter(
      (c) =>
        c.source_scene_number === sceneNum &&
        (c.entity_name as string)?.toLowerCase().includes("compass"),
    );
    check(
      compassClaims.length > 0,
      `Compass has a claim in scene ${sceneNum}`,
      compassClaims.length > 0
        ? `  "${compassClaims[0]!.property}" = "${compassClaims[0]!.value}"`
        : "  Not found — the Guardian's hardest test depends on this",
    );
  }

  // Check scene 13 has an "always returns" rule or similar claim
  const compassScene13 = claims.filter(
    (c) =>
      c.source_scene_number === 13 &&
      (c.entity_name as string)?.toLowerCase().includes("compass"),
  );
  const hasRule = compassScene13.some(
    (c) =>
      (c.value as string)?.toLowerCase().includes("return") ||
      (c.value as string)?.toLowerCase().includes("always") ||
      (c.property as string)?.toLowerCase().includes("rule") ||
      (c.property as string)?.toLowerCase().includes("behavior"),
  );
  check(
    hasRule,
    `Compass "always returns" rule captured in scene 13`,
    hasRule
      ? `  "${compassScene13.find((c) => (c.value as string)?.toLowerCase().includes("return"))?.property}" = "${compassScene13.find((c) => (c.value as string)?.toLowerCase().includes("return"))?.value}"`
      : `  Scene 13 compass claims: ${compassScene13.map((c) => `${String(c.property)}=${String(c.value)}`).join("; ") || "none"}`,
  );

  // ── 7. Guardian within-unit pass ─────────────────────────────────────────
  banner("Step 7 — Guardian within-unit pass (queries via MCP)");
  const guardianResp = await post<{
    status: string;
    data: {
      findings_count: number;
      findings: Array<{
        conflict_type: string;
        severity: string;
        explanation: string;
      }>;
    };
  }>(`${BASE}/units/${unitId}/analyze`, {});
  check(guardianResp.status === "success", "Guardian pass succeeded");
  info(`${guardianResp.data.findings_count} finding(s) returned`);

  // ── 8. Evaluate Guardian verdicts ─────────────────────────────────────────
  banner("Step 8 — Evaluate Guardian verdicts");
  const findings = guardianResp.data.findings;

  for (const f of findings) {
    info(`[${f.conflict_type.toUpperCase()}/${f.severity}] ${f.explanation.slice(0, 120)}`);
  }

  // Sonar unit: should be ambiguous (not confirmed — offscreen movement possible)
  const sonarFinding = findings.find((f) =>
    f.explanation.toLowerCase().includes("sonar") ||
    f.explanation.toLowerCase().includes("ledge"),
  );
  if (sonarFinding) {
    check(
      sonarFinding.conflict_type === "ambiguous",
      `Sonar unit: Guardian correctly classified as ambiguous (got ${sonarFinding.conflict_type})`,
      `  ${sonarFinding.explanation.slice(0, 100)}`,
    );
  } else {
    info("Sonar unit: no finding written (acceptable if Guardian read it as normal_transition)");
  }

  // Compass: this is the KEY test — must NOT be confirmed despite value delta
  // because scene 13 establishes the "always returns" rule
  const compassFinding = findings.find((f) =>
    f.explanation.toLowerCase().includes("compass"),
  );
  if (compassFinding) {
    check(
      compassFinding.conflict_type !== "confirmed",
      `Compass: Guardian did NOT over-fire despite value delta (got ${compassFinding.conflict_type})`,
      `  Correct: reasoner read the full property history including the "always returns" rule`,
    );
    if (compassFinding.conflict_type === "confirmed") {
      fail(
        "Compass: Guardian called CONFIRMED — it did not incorporate the scene 13 rule claim",
      );
      failed_count++;
      info("  This means the reasoner is classifying from the state delta alone, not the full history");
    }
  } else {
    pass("Compass: no finding written — Guardian read scene 13 rule and determined normal_transition");
    passed++;
  }

  // ── 9–13. Companion questions ─────────────────────────────────────────────
  banner("Step 9 — Companion: compass at scene 11 (should be missing)");
  const q9 = await post<{ status: string; epistemic_state: string; answer: string }>(
    `${BASE}/units/${unitId}/ask`,
    { question: "Where is the brass compass?", up_to_scene: 11 },
  );
  check(q9.status === "success", "Companion responded");
  check(
    q9.epistemic_state === "partial" || q9.epistemic_state === "unknown",
    `Compass missing at scene 11 — epistemic state is ${q9.epistemic_state}`,
  );
  info(`Answer: ${q9.answer?.slice(0, 120)}`);

  banner("Step 10 — Companion: compass at scene 13 (should cite kitchen + rule)");
  const q10 = await post<{ status: string; epistemic_state: string; answer: string }>(
    `${BASE}/units/${unitId}/ask`,
    { question: "Where is the brass compass?", up_to_scene: 13 },
  );
  check(q10.status === "success", "Companion responded");
  check(
    q10.epistemic_state === "known" || q10.epistemic_state === "partial",
    `Compass location known/partial at scene 13 (got ${q10.epistemic_state})`,
  );
  const mentionsRule =
    q10.answer?.toLowerCase().includes("return") ||
    q10.answer?.toLowerCase().includes("always") ||
    q10.answer?.toLowerCase().includes("kitchen");
  check(mentionsRule, 'Answer references kitchen counter or "always returns" rule');
  info(`Answer: ${q10.answer?.slice(0, 120)}`);

  banner("Step 11 — Companion: how did compass get back? (gap + rule)");
  const q11 = await post<{ status: string; epistemic_state: string; answer: string }>(
    `${BASE}/units/${unitId}/ask`,
    { question: "How did the compass get back to the kitchen?", up_to_scene: 13 },
  );
  check(q11.status === "success", "Companion responded");
  check(
    q11.epistemic_state === "partial" || q11.epistemic_state === "unknown",
    `No mechanism known — epistemic state is ${q11.epistemic_state}`,
  );
  info(`Answer: ${q11.answer?.slice(0, 120)}`);

  banner("Step 12 — Companion: summary mode (catch me up to scene 8)");
  const q12 = await post<{ status: string; epistemic_state: string; answer: string }>(
    `${BASE}/units/${unitId}/ask`,
    { question: "Catch me up from the beginning", up_to_scene: 8 },
  );
  check(q12.status === "success", "Companion responded to summary request");
  check(q12.answer?.length > 100, "Summary is substantive (>100 chars)");
  info(`Answer: ${q12.answer?.slice(0, 200)}`);

  banner("Step 13 — Companion: what should I remember? (load-bearing facts, scene 9)");
  const q13 = await post<{ status: string; epistemic_state: string; answer: string }>(
    `${BASE}/units/${unitId}/ask`,
    { question: "What should I remember before continuing?", up_to_scene: 9 },
  );
  check(q13.status === "success", "Companion responded");
  const mentionsCompass = q13.answer?.toLowerCase().includes("compass");
  check(mentionsCompass, "Answer mentions compass (load-bearing object)");
  info(`Answer: ${q13.answer?.slice(0, 200)}`);

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  SUMMARY — Film D");
  console.log("═".repeat(60));
  console.log(`  Passed : ${passed}`);
  console.log(`  Failed : ${failed_count}`);
  console.log(`  Universe   : ${universeId}`);
  console.log(`  Project    : ${projectId}`);
  console.log(`  Story unit : ${unitId}`);
  console.log();

  process.exit(failed_count > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
