/**
 * Migration script — creates all 9 lmm tables in ClickHouse Cloud.
 *
 * Run once after provisioning ClickHouse:
 *   pnpm tsx scripts/migrate.ts
 *
 * Safe to re-run — every statement uses CREATE TABLE IF NOT EXISTS.
 * Existing tables and data are never dropped or modified.
 */

import { config } from "../src/config/index.js";
import { createClient } from "@clickhouse/client";
import { DDL_TABLES_IN_ORDER } from "../src/mcp/clickhouse/queries.js";

const client = createClient({
  url: `https://${config.CLICKHOUSE_HOST}:${config.CLICKHOUSE_PORT}`,
  username: config.CLICKHOUSE_USERNAME,
  password: config.CLICKHOUSE_PASSWORD,
  // Connect without a database first so we can create it if it doesn't exist.
  database: "default",
});

async function run() {
  console.log(`Connecting to ${config.CLICKHOUSE_HOST}:${config.CLICKHOUSE_PORT}...`);

  // 1. Create the database if it doesn't already exist.
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS lmm`,
  });
  console.log("✓ Database 'lmm' ready");

  // 2. Run each table DDL in dependency order.
  for (const ddl of DDL_TABLES_IN_ORDER) {
    // Extract the table name from the DDL string for the log line.
    const match = ddl.match(/CREATE TABLE IF NOT EXISTS (\S+)/);
    const tableName = match?.[1] ?? "unknown";

    await client.command({ query: ddl });
    console.log(`✓ Table ${tableName} ready`);
  }

  console.log("\nMigration complete. All tables are ready.");
  await client.close();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
