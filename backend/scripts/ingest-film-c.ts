/**
 * ingest-film-c.ts
 *
 * Full end-to-end verification script for Film C — "The Glasshouse".
 *
 * Steps:
 *   1.  Create universe, project, story unit
 *   2.  Upload film-c.txt, start ingestion pipeline
 *   3.  Poll /status until complete
 *   4.  Verify every scene produced ≥2 claims
 *   5.  Check scene 3 establishes Silver Crown in display case
 *   6.  Check scene 6/7 establishes Silver Crown as missing/gone
 *   7.  Run within-unit Guardian pass
 *   8.  Report findings — expect Silver Crown transition (confirmed/ambiguous)
 *       and Theater Key transition (expect ambiguous, not confirmed)
 *   9.  Audience Companion: Silver Crown up to scene 3 (should be "known")
 *   10. Audience Companion: Silver Crown up to scene 6 (should be "partial"/"unknown")
 *   11. Audience Companion: Mrs. Vale up to scene 5 (should be "unknown" — she's scene 9)
 *   12. Audience Companion: How did crown end up in basement? up to scene 10
 *
 * Run from backend/:
 *   pnpm tsx scripts/ingest-film-c.ts
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
const FIXTURE = path.resolve(__dirname, "../../fixtures/film-c.txt");
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
  console.log("  Film C — The Glasshouse — Verification Script");
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
    { name: "The Glasshouse", description: "Community theater mystery, 2026" },
  );
  const universeId = universe.universe_id;
  pass(`Universe created: ${universeId}`);

  const project = await post<{ data: { project_id: string } }>(
    `${BASE}/universes/${universeId}/projects`,
    { name: "The Glasshouse Stories", type: "film", canonTier: 1 },
  );
  const projectId = project.data.project_id;
  pass(`Project created: ${projectId}`);

  const unit = await post<{ status: string; story_unit: { story_unit_id: string } }>(
    `${BASE}/projects/${projectId}/units`,
    {
      projectId,
      universeId,
      title: "The Glasshouse",
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
  check(ingestion.ingestion_status !== "failed" as unknown as boolean,
    "Ingestion completed without fatal failure");
  check(ingestion.failed_scenes.length === 0,
    "No failed scenes",
    ingestion.failed_scenes.length > 0 ? `Failed: ${ingestion.failed_scenes.join(", ")}` : undefined);
  check(ingestion.claim_count > 0, `Claims written: ${ingestion.claim_count}`);

  // ── 4. Per-scene claim count ──────────────────────────────────────────────
  banner("Step 4 — Verify every scene has ≥2 claims");
  const claimsResp = await get<{
    data: { claims: Array<{ source_scene_number: number }> };
  }>(`${BASE}/units/${unitId}/claims`);
  const claims = claimsResp.data.claims;

  const byScene = new Map<number, number>();
  for (const c of claims) {
    byScene.set(c.source_scene_number, (byScene.get(c.source_scene_number) ?? 0) + 1);
  }
  let zeroClaimScenes = 0;
  for (const [sceneNum, count] of byScene) {
    if (count < 2) {
      fail(`Scene ${sceneNum} has only ${count} claim(s)`);
      zeroClaimScenes++;
      failed_count++;
    }
  }
  if (zeroClaimScenes === 0) {
    pass(`All ${byScene.size} scenes have ≥2 claims`);
    passed++;
  }

  // ── 5. Silver Crown location in scene 3 ──────────────────────────────────
  banner("Step 5 — Silver Crown location established in scene 3");
  const scene3Claims = claims.filter(
    (c) =>
      c.source_scene_number === 3 &&
      (c as Record<string, unknown>).entity_name?.toString().toLowerCase().includes("crown"),
  );
  const crownScene3Location = (scene3Claims as Array<Record<string, unknown>>).find(
    (c) =>
      (c.property as string).toLowerCase().includes("location") ||
      (c.property as string).toLowerCase().includes("possession"),
  );
  check(
    crownScene3Location !== undefined,
    "Silver Crown has a location/possession claim in scene 3",
    crownScene3Location
      ? `  "${crownScene3Location.property}" = "${crownScene3Location.value}"`
      : "  No matching claim found",
  );

  // ── 6. Silver Crown missing in scene 6 or 7 ──────────────────────────────
  banner("Step 6 — Silver Crown gone/missing after scene 5");
  const crownLaterClaims = (claims as Array<Record<string, unknown>>).filter(
    (c) =>
      (c.source_scene_number as number) >= 6 &&
      c.entity_name?.toString().toLowerCase().includes("crown") &&
      (
        (c.property as string).toLowerCase().includes("location") ||
        (c.property as string).toLowerCase().includes("possession")
      ),
  );
  const crownGone = crownLaterClaims.find((c) =>
    ["missing", "gone", "unknown", "absent", "basement", "disappeared"].some((w) =>
      (c.value as string).toLowerCase().includes(w),
    ),
  );
  check(
    crownGone !== undefined,
    "Silver Crown location shifts after scene 5",
    crownGone
      ? `  scene ${crownGone.source_scene_number}: "${crownGone.property}" = "${crownGone.value}"`
      : `  Latest location claims: ${crownLaterClaims.map((c) => `scene ${c.source_scene_number}: ${String(c.value)}`).join(", ") || "none found"}`,
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
        claim_a?: Record<string, unknown>;
        claim_b?: Record<string, unknown>;
      }>;
    };
  }>(`${BASE}/units/${unitId}/analyze`, {});
  check(guardianResp.status === "success", "Guardian pass succeeded");
  info(`${guardianResp.data.findings_count} finding(s) returned`);

  // ── 8. Evaluate Guardian verdicts ─────────────────────────────────────────
  banner("Step 8 — Evaluate Guardian verdicts");
  const findings = guardianResp.data.findings;

  if (findings.length === 0) {
    fail("No findings — expected at least one for Silver Crown transition");
    failed_count++;
  } else {
    for (const f of findings) {
      info(`[${f.conflict_type.toUpperCase()}/${f.severity}] ${f.explanation.slice(0, 120)}`);
    }

    // Silver Crown: should be flagged (confirmed or ambiguous — either is acceptable)
    const crownFinding = findings.find((f) =>
      f.explanation.toLowerCase().includes("crown") ||
      f.explanation.toLowerCase().includes("display") ||
      f.explanation.toLowerCase().includes("basement"),
    );
    check(
      crownFinding !== undefined,
      "Silver Crown transition flagged by Guardian",
      crownFinding ? `  conflict_type=${crownFinding.conflict_type}` : "  Not found in findings",
    );

    // Theater Key: should NOT be confirmed (ambiguous is fine, normal_transition is fine,
    // confirmed would be over-firing)
    const keyFinding = findings.find((f) =>
      f.explanation.toLowerCase().includes("key") ||
      f.explanation.toLowerCase().includes("hook"),
    );
    if (keyFinding) {
      check(
        keyFinding.conflict_type !== "confirmed",
        `Theater Key: Guardian did not over-fire (got ${keyFinding.conflict_type}, expected ambiguous)`,
        `  explanation: ${keyFinding.explanation.slice(0, 100)}`,
      );
    } else {
      pass("Theater Key: no finding written (acceptable — ambiguous or normal_transition)");
      passed++;
    }
  }

  // ── 9–12. Companion questions ─────────────────────────────────────────────
  banner("Step 9 — Companion: Silver Crown at scene 3 boundary");
  const q9 = await post<{
    status: string;
    epistemic_state: string;
    answer: string;
  }>(`${BASE}/units/${unitId}/ask`, {
    question: "Where is the Silver Crown?",
    up_to_scene: 3,
  });
  check(q9.status === "success", "Companion responded");
  check(
    q9.epistemic_state === "known",
    `Epistemic state is "known" (got "${q9.epistemic_state}")`,
  );
  info(`Answer: ${q9.answer?.slice(0, 120)}`);

  banner("Step 10 — Companion: Silver Crown at scene 6 boundary");
  const q10 = await post<{
    status: string;
    epistemic_state: string;
    answer: string;
  }>(`${BASE}/units/${unitId}/ask`, {
    question: "Where is the Silver Crown?",
    up_to_scene: 6,
  });
  check(q10.status === "success", "Companion responded");
  check(
    q10.epistemic_state === "partial" || q10.epistemic_state === "unknown",
    `Epistemic state reflects uncertainty (got "${q10.epistemic_state}")`,
  );
  info(`Answer: ${q10.answer?.slice(0, 120)}`);

  banner("Step 11 — Companion: Mrs. Vale at scene 5 boundary (should be unknown)");
  const q11 = await post<{
    status: string;
    epistemic_state: string;
    answer: string;
  }>(`${BASE}/units/${unitId}/ask`, {
    question: "Who is Mrs. Vale?",
    up_to_scene: 5,
  });
  check(q11.status === "success", "Companion responded");
  check(
    q11.epistemic_state === "unknown",
    `Epistemic state is "unknown" — spoiler boundary enforced (got "${q11.epistemic_state}")`,
  );
  info(`Answer: ${q11.answer?.slice(0, 120)}`);

  banner("Step 12 — Companion: How did the crown end up in the basement? (up to scene 10)");
  const q12 = await post<{
    status: string;
    epistemic_state: string;
    answer: string;
  }>(`${BASE}/units/${unitId}/ask`, {
    question: "How did the crown end up in the basement?",
    up_to_scene: 10,
  });
  check(q12.status === "success", "Companion responded");
  check(
    q12.epistemic_state === "partial" || q12.epistemic_state === "unknown",
    `Epistemic state is partial/unknown — gap correctly identified (got "${q12.epistemic_state}")`,
  );
  info(`Answer: ${q12.answer?.slice(0, 120)}`);

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  SUMMARY — Film C");
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
