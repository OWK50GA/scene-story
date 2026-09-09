/**
 * debug-guardian.ts
 *
 * Runs the exact conflict detection SQL directly against ClickHouse
 * (bypassing MCP entirely) and also via MCP, so we can compare results.
 *
 * Usage:
 *   pnpm tsx scripts/debug-guardian.ts <story_unit_id> <universe_id>
 */

import { ch } from "../src/mcp/clickhouse/client.js";
import { runQuery } from "../src/mcp/clickhouse/http-client.js";

const storyUnitId = process.argv[2];
const universeId = process.argv[3];

if (!storyUnitId || !universeId) {
  console.error("Usage: pnpm tsx scripts/debug-guardian.ts <story_unit_id> <universe_id>");
  process.exit(1);
}

const CONFLICT_SQL = `
  SELECT
    a.claim_id          AS claim_a_id,
    b.claim_id          AS claim_b_id,
    a.universe_entity_id,
    a.property,
    a.value             AS value_a,
    b.value             AS value_b,
    a.valid_from_scene  AS scene_a,
    b.valid_from_scene  AS scene_b
  FROM lmm.claims a
  JOIN lmm.claims b
    ON  a.universe_entity_id = b.universe_entity_id
    AND a.property           = b.property
    AND a.story_unit_id      = b.story_unit_id
    AND a.claim_id           < b.claim_id
    AND a.value              != b.value
  WHERE a.story_unit_id       = '${storyUnitId}'
    AND a.valid_to_scene      IS NULL
    AND b.valid_to_scene      IS NULL
    AND a.superseded_by_canon = 0
    AND b.superseded_by_canon = 0
  ORDER BY a.valid_from_scene
`;

const ALL_CLAIMS_SQL = `
  SELECT
    e.canonical_name,
    c.property,
    c.value,
    c.valid_from_scene,
    c.valid_to_scene,
    c.superseded_by_canon
  FROM lmm.claims c
  JOIN lmm.universe_entities e ON c.universe_entity_id = e.entity_id
  WHERE c.story_unit_id = '${storyUnitId}'
  ORDER BY e.canonical_name, c.property, c.valid_from_scene
`;

async function main() {
  console.log(`\nUnit    : ${storyUnitId}`);
  console.log(`Universe: ${universeId}\n`);

  // ── 1. Direct ClickHouse — all claims ────────────────────────────────────
  console.log("═".repeat(60));
  console.log("1. ALL CLAIMS (direct ClickHouse)");
  console.log("═".repeat(60));
  const claimsResult = await ch.query({ query: ALL_CLAIMS_SQL, format: "JSONEachRow" });
  const claims = await claimsResult.json<Record<string, unknown>[]>();
  console.log(`Total claims: ${claims.length}`);
  for (const c of claims) {
    const closed = c.valid_to_scene !== null ? ` → CLOSED at scene ${c.valid_to_scene}` : "";
    const sup = Number(c.superseded_by_canon) === 1 ? " [SUPERSEDED]" : "";
    console.log(`  [${c.canonical_name}] ${c.property} = "${c.value}" (from scene ${c.valid_from_scene})${closed}${sup}`);
  }

  // ── 2. Direct ClickHouse — conflict candidates ────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("2. CONFLICT CANDIDATES (direct ClickHouse)");
  console.log("═".repeat(60));
  const conflictResult = await ch.query({ query: CONFLICT_SQL, format: "JSONEachRow" });
  const conflicts = await conflictResult.json<Record<string, unknown>[]>();
  console.log(`Candidates found: ${conflicts.length}`);
  for (const c of conflicts) {
    console.log(`  [${c.property}] scene ${c.scene_a}: "${c.value_a}" vs scene ${c.scene_b}: "${c.value_b}"`);
  }

  // ── 3. Via MCP — raw response ────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("3. CONFLICT CANDIDATES (via MCP — raw)");
  console.log("═".repeat(60));
  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");

    const mcpUrl = process.env.CLICKHOUSE_MCP_URL ?? "http://localhost:8000/sse";
    const transport = new SSEClientTransport(new URL(mcpUrl));
    const client = new Client({ name: "debug", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    console.log("MCP connected");

    const result = await client.callTool({
      name: "run_query",
      arguments: { query: CONFLICT_SQL },
    });

    console.log("Raw MCP result:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`MCP error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
