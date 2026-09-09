/**
 * check-claims.ts — debug script, not part of the product.
 *
 * Queries ClickHouse directly (bypassing MCP) to inspect claim state.
 *
 * Usage:
 *   pnpm tsx scripts/check-claims.ts <story_unit_id>
 */

import { ch } from "../src/mcp/clickhouse/client.js";

const storyUnitId = process.argv[2];
if (!storyUnitId) {
  console.error("Usage: pnpm tsx scripts/check-claims.ts <story_unit_id>");
  process.exit(1);
}

async function main() {
  // All claims for this unit
  const r = await ch.query({
    query: `
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
    `,
    format: "JSONEachRow",
  });
  const rows = await r.json<Record<string, unknown>[]>();

  console.log(`\nAll claims for unit ${storyUnitId} (${rows.length} total):\n`);
  for (const row of rows) {
    const closed =
      row.valid_to_scene !== null
        ? ` → closed at scene ${row.valid_to_scene}`
        : "";
    const superseded =
      Number(row.superseded_by_canon) === 1 ? " [SUPERSEDED]" : "";
    console.log(
      `  [${row.canonical_name}] ${row.property} = "${row.value}"  (from scene ${row.valid_from_scene}${closed})${superseded}`,
    );
  }

  // Conflict candidates — same query as within-unit Guardian
  const r2 = await ch.query({
    query: `
      SELECT
        a.claim_id          AS claim_a_id,
        b.claim_id          AS claim_b_id,
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
    `,
    format: "JSONEachRow",
  });
  const conflicts = await r2.json<Record<string, unknown>[]>();

  console.log(
    `\nActive conflict candidates (Guardian input): ${conflicts.length}\n`,
  );
  for (const c of conflicts) {
    console.log(
      `  ${c.property}: "${c.value_a}" (scene ${c.scene_a}) vs "${c.value_b}" (scene ${c.scene_b})`,
    );
  }
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
