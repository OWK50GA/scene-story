/**
 * ingest-film-e.ts
 *
 * End-to-end ingestion and verification script for Film E — "The Last Signal".
 *
 * Key continuity traps designed into this fixture:
 *
 *   TRAP 1 — Blue Signal Case: archive cabinet (scene 1)
 *            → stolen by Marcus, footage confirms (scene 5)
 *            → on train station bench (scenes 6–7)
 *            → gone from station (scene 9, no recorded transfer)
 *            → in David's office (scene 11, unexplained)
 *            Guardian should flag scene 7→9 and scene 9→11 as ambiguous.
 *
 *   TRAP 2 — Silver Key: created scene 6 (Marcus pockets it)
 *            → Marcus holds it in scene 10
 *            → Elena inserts it in scene 13
 *            → gone in scene 15 (no transfer recorded)
 *            Guardian should flag the scene 13→15 disappearance.
 *
 *   TRAP 3 — Direct contradiction in scene 10: both Elena and Marcus
 *            claim the other took the Blue Signal Case.
 *            Guardian should classify this as confirmed or ambiguous
 *            since both claims cannot be true simultaneously.
 *
 * Steps:
 *   1.  Create universe, project, story unit
 *   2.  Upload film-e.txt, start ingestion
 *   3.  Poll until complete
 *   4.  Verify every scene has ≥2 claims
 *   5.  Verify Blue Signal Case tracked in scene 1 (archive)
 *   6.  Verify Blue Signal Case missing in scene 4
 *   7.  Verify Silver Key possession established in scene 6
 *   8.  Verify Blue Signal Case contradiction in scene 10
 *   9.  Run within-unit Guardian pass
 *   10. Verify Guardian produced findings (expect ≥1)
 *   11. Verify case disappearance finding exists (scene 7→9)
 *   12. Verify scene 10 contradiction finding exists
 *   13. Companion: where is the case at scene 3? (should be archive)
 *   14. Companion: where is the case at scene 8? (inside the station)
 *   15. Companion: where is the case at scene 10? (should be unknown/partial)
 *   16. Companion: who has the Silver Key at scene 10? (Marcus)
 *   17. Companion: what happened to the Silver Key? (up to scene 15)
 *
 * Run from backend/:
 *   pnpm tsx scripts/ingest-film-e.ts
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
const FIXTURE = path.resolve(__dirname, "../../fixtures/film-e.txt");
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
  console.log("  Film E — The Last Signal — Verification Script");
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
    { name: "The Last Signal", description: "An intelligence archivist uncovers a hidden transmitter and a conspiracy." },
  );
  const universeId = universe.universe_id;
  pass(`Universe: ${universeId}`);

  const project = await post<{ data: { project_id: string } }>(
    `${BASE}/universes/${universeId}/projects`,
    { name: "The Last Signal", type: "film", canonTier: 1 },
  );
  const projectId = project.data.project_id;
  pass(`Project: ${projectId}`);

  const unit = await post<{ status: string; story_unit: { story_unit_id: string } }>(
    `${BASE}/projects/${projectId}/units`,
    {
      projectId,
      universeId,
      title: "The Last Signal",
      unitType: "film",
      inUniversePeriod: "Present Day, 2026",
      inUniverseDateStart: 2026,
      inUniverseDateEnd: 2026,
      releaseOrder: 1,
    },
  );
  const unitId = unit.story_unit.story_unit_id;
  pass(`Story unit: ${unitId}`);

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
  banner("Step 4 — Every scene has ≥2 claims");
  const claimsResp = await get<{
    data: { claims: Array<Record<string, unknown>> };
  }>(`${BASE}/units/${unitId}/claims`);
  const claims = claimsResp.data.claims;

  const byScene = new Map<number, number>();
  for (const c of claims) {
    const n = c.source_scene_number as number;
    byScene.set(n, (byScene.get(n) ?? 0) + 1);
  }
  let underfilled = 0;
  for (const [sceneNum, count] of byScene) {
    if (count < 2) {
      fail(`Scene ${sceneNum} has only ${count} claim(s)`);
      underfilled++;
      failed_count++;
    }
  }
  if (underfilled === 0) { pass(`All ${byScene.size} scenes have ≥2 claims`); passed++; }

  // ── 5. Blue Signal Case in archive at scene 1 ─────────────────────────────
  banner("Step 5 — Blue Signal Case in archive cabinet at scene 1");
  const caseScene1 = (claims as Array<Record<string, unknown>>).filter(
    (c) =>
      c.source_scene_number === 1 &&
      (c.entity_name as string)?.toLowerCase().includes("signal") &&
      (
        (c.property as string)?.toLowerCase().includes("location") ||
        (c.property as string)?.toLowerCase().includes("possession")
      ),
  );
  const caseInArchive = caseScene1.find((c) =>
    ["archive", "cabinet", "storage"].some((w) =>
      (c.value as string)?.toLowerCase().includes(w),
    ),
  );
  check(
    caseInArchive !== undefined,
    "Blue Signal Case located in archive/cabinet in scene 1",
    caseInArchive
      ? `  "${caseInArchive.property}" = "${caseInArchive.value}"`
      : `  Scene 1 case claims: ${caseScene1.map((c) => `${String(c.property)}=${String(c.value)}`).join("; ") || "none"}`,
  );

  // ── 6. Blue Signal Case missing in scene 4 ───────────────────────────────
  banner("Step 6 — Blue Signal Case missing/gone in scene 4");
  const caseScene4 = (claims as Array<Record<string, unknown>>).filter(
    (c) =>
      c.source_scene_number === 4 &&
      (c.entity_name as string)?.toLowerCase().includes("signal"),
  );
  const caseMissing = caseScene4.find((c) =>
    ["gone", "missing", "absent", "empty"].some((w) =>
      (c.value as string)?.toLowerCase().includes(w) ||
      (c.property as string)?.toLowerCase().includes(w),
    ),
  );
  check(
    caseMissing !== undefined,
    "Blue Signal Case flagged as missing/gone in scene 4",
    caseMissing
      ? `  "${caseMissing.property}" = "${caseMissing.value}"`
      : `  Scene 4 case claims: ${caseScene4.map((c) => `${String(c.property)}=${String(c.value)}`).join("; ") || "none"}`,
  );

  // ── 7. Silver Key possession in scene 6 ──────────────────────────────────
  banner("Step 7 — Silver Key possession established in scene 6");
  const keyScene6 = (claims as Array<Record<string, unknown>>).filter(
    (c) =>
      c.source_scene_number === 6 &&
      (c.entity_name as string)?.toLowerCase().includes("key"),
  );
  const keyWithMarcus = keyScene6.find((c) =>
    ["marcus", "pocket", "possession"].some((w) =>
      (c.value as string)?.toLowerCase().includes(w),
    ),
  );
  check(
    keyWithMarcus !== undefined,
    "Silver Key claimed by Marcus in scene 6",
    keyWithMarcus
      ? `  "${keyWithMarcus.property}" = "${keyWithMarcus.value}"`
      : `  Scene 6 key claims: ${keyScene6.map((c) => `${String(c.property)}=${String(c.value)}`).join("; ") || "none"}`,
  );

  // ── 8. Scene 10 contradiction — both Elena and Marcus deny taking the case ─
  banner("Step 8 — Scene 10 Blue Signal Case contradiction captured");
  const scene10Claims = (claims as Array<Record<string, unknown>>).filter(
    (c) => c.source_scene_number === 10,
  );
  // Both characters claim the other took it — look for contradictory possession claims
  const contradictionClaims = scene10Claims.filter((c) =>
    (c.entity_name as string)?.toLowerCase().includes("signal") ||
    (c.entity_name as string)?.toLowerCase().includes("elena") ||
    (c.entity_name as string)?.toLowerCase().includes("marcus"),
  );
  check(
    contradictionClaims.length > 0,
    `Scene 10 has claims about case possession (${contradictionClaims.length} claim(s))`,
    contradictionClaims.slice(0, 3).map((c) => `  [${c.entity_name}] ${c.property}="${c.value}"`).join("\n"),
  );

  // ── 9. Guardian within-unit pass ─────────────────────────────────────────
  banner("Step 9 — Guardian within-unit pass (via MCP)");
  const guardianResp = await post<{
    status: string;
    data: {
      findings_count: number;
      findings: Array<{
        conflict_type: string;
        severity: string;
        explanation: string;
        claim_a?: Record<string, unknown>;
        claim_b?: Record<string, unknown>;
      }>;
    };
  }>(`${BASE}/units/${unitId}/analyze`, {});
  check(guardianResp.status === "success", "Guardian pass succeeded");
  check(guardianResp.data.findings_count > 0, `Guardian found ${guardianResp.data.findings_count} finding(s)`);

  const findings = guardianResp.data.findings;
  for (const f of findings) {
    info(`[${f.conflict_type.toUpperCase()}/${f.severity}] ${f.explanation.slice(0, 120)}`);
  }

  // ── 10. Case disappearance finding (scene 7→9) ────────────────────────────
  banner("Step 10 — Case disappearance finding (bench → gone)");
  const caseFinding = findings.find((f) =>
    f.explanation.toLowerCase().includes("signal") ||
    f.explanation.toLowerCase().includes("case") ||
    f.explanation.toLowerCase().includes("bench") ||
    (f.claim_a as Record<string, unknown> | undefined)?.entity_name?.toString().toLowerCase().includes("signal") ||
    (f.claim_b as Record<string, unknown> | undefined)?.entity_name?.toString().toLowerCase().includes("signal"),
  );
  check(
    caseFinding !== undefined,
    "Blue Signal Case transition flagged by Guardian",
    caseFinding
      ? `  conflict_type=${caseFinding.conflict_type} severity=${caseFinding.severity}`
      : "  No case-related finding found",
  );

  // ── 11. Silver Key disappearance finding ──────────────────────────────────
  banner("Step 11 — Silver Key disappearance finding (scene 13→15)");
  const keyFinding = findings.find((f) =>
    f.explanation.toLowerCase().includes("key") ||
    (f.claim_a as Record<string, unknown> | undefined)?.entity_name?.toString().toLowerCase().includes("key") ||
    (f.claim_b as Record<string, unknown> | undefined)?.entity_name?.toString().toLowerCase().includes("key"),
  );
  check(
    keyFinding !== undefined,
    "Silver Key transition flagged by Guardian",
    keyFinding
      ? `  conflict_type=${keyFinding.conflict_type} severity=${keyFinding.severity}`
      : "  No key-related finding found",
  );

  // ── 12–17. Companion questions ────────────────────────────────────────────
  banner("Step 12 — Companion: where is the Blue Signal Case at scene 3?");
  const q12 = await post<{ data: { answer: string; epistemic_state: string } }>(
    `${BASE}/units/${unitId}/ask`,
    { question: "Where is the Blue Signal Case?", up_to_scene: 3 },
  );
  check(q12.data?.epistemic_state === "known", `Epistemic state: ${q12.data?.epistemic_state} (expect known)`);
  const q12mentionsArchive = q12.data?.answer?.toLowerCase().includes("archive") ||
    q12.data?.answer?.toLowerCase().includes("cabinet");
  check(q12mentionsArchive, "Answer places case in archive/cabinet");
  info(`Answer: ${q12.data?.answer?.slice(0, 120)}`);

  banner("Step 13 — Companion: where is the Blue Signal Case at scene 8?");
  const q13 = await post<{ data: { answer: string; epistemic_state: string } }>(
    `${BASE}/units/${unitId}/ask`,
    { question: "Where is the Blue Signal Case?", up_to_scene: 8 },
  );
  check(
    q13.data?.epistemic_state === "known" || q13.data?.epistemic_state === "partial",
    `Epistemic state: ${q13.data?.epistemic_state} (expect known or partial)`,
  );
  const q13mentionsStation = q13.data?.answer?.toLowerCase().includes("station") ||
    q13.data?.answer?.toLowerCase().includes("bench") ||
    q13.data?.answer?.toLowerCase().includes("inside");
  check(q13mentionsStation, "Answer places case inside the station");
  info(`Answer: ${q13.data?.answer?.slice(0, 120)}`);

  banner("Step 14 — Companion: where is the Blue Signal Case at scene 10? (should be unknown)");
  const q14 = await post<{ data: { answer: string; epistemic_state: string } }>(
    `${BASE}/units/${unitId}/ask`,
    { question: "Where is the Blue Signal Case?", up_to_scene: 10 },
  );
  check(
    q14.data?.epistemic_state === "unknown" || q14.data?.epistemic_state === "partial",
    `Epistemic state reflects uncertainty: ${q14.data?.epistemic_state}`,
  );
  info(`Answer: ${q14.data?.answer?.slice(0, 120)}`);

  banner("Step 15 — Companion: who has the Silver Key at scene 10?");
  const q15 = await post<{ data: { answer: string; epistemic_state: string } }>(
    `${BASE}/units/${unitId}/ask`,
    { question: "Who has the Silver Key?", up_to_scene: 10 },
  );
  check(q15.data?.epistemic_state === "known", `Epistemic state: ${q15.data?.epistemic_state}`);
  const q15mentionsMarcus = q15.data?.answer?.toLowerCase().includes("marcus");
  check(q15mentionsMarcus, "Answer identifies Marcus as key holder");
  info(`Answer: ${q15.data?.answer?.slice(0, 120)}`);

  banner("Step 16 — Companion: what happened to the Silver Key? (up to scene 15)");
  const q16 = await post<{ data: { answer: string; epistemic_state: string } }>(
    `${BASE}/units/${unitId}/ask`,
    { question: "What happened to the Silver Key?", up_to_scene: 15 },
  );
  check(q16.data?.epistemic_state === "partial" || q16.data?.epistemic_state === "unknown",
    `Epistemic state reflects gap: ${q16.data?.epistemic_state}`);
  info(`Answer: ${q16.data?.answer?.slice(0, 200)}`);

  banner("Step 17 — Companion: who took the Blue Signal Case? (up to scene 11)");
  const q17 = await post<{ data: { answer: string; epistemic_state: string } }>(
    `${BASE}/units/${unitId}/ask`,
    { question: "Who took the Blue Signal Case from the archive?", up_to_scene: 11 },
  );
  check(q17.data?.epistemic_state !== "unknown", `Epistemic state: ${q17.data?.epistemic_state}`);
  const q17mentionsMarcus = q17.data?.answer?.toLowerCase().includes("marcus");
  check(q17mentionsMarcus, "Answer identifies Marcus (confirmed by security footage)");
  info(`Answer: ${q17.data?.answer?.slice(0, 200)}`);

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  SUMMARY — Film E");
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
