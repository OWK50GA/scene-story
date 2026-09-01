import { createClient } from "@clickhouse/client";
import { config } from "../../config";

// ---------------------------------------------------------------------------
// Config — read once at module load from environment variables.
//
// CLICKHOUSE_URL        full HTTPS URL to your ClickHouse Cloud instance,
//                       e.g. https://abc123.us-east-1.aws.clickhouse.cloud:8443
// CLICKHOUSE_USERNAME   usually "default" on ClickHouse Cloud
// CLICKHOUSE_PASSWORD   the password for that user
// CLICKHOUSE_DATABASE   the database name, e.g. "lmm"
//
// The client is a singleton — one instance shared across the entire process.
// ClickHouse Cloud uses HTTP(S) under the hood; the client manages connection
// pooling internally so there is nothing to close manually in normal operation.
// ---------------------------------------------------------------------------

const url = `https://${config.CLICKHOUSE_HOST}:${config.CLICKHOUSE_PORT}`;
const username = config.CLICKHOUSE_USERNAME;
const password = config.CLICKHOUSE_PASSWORD;
const database = config.CLICKHOUSE_DATABASE;

if (!url) {
  throw new Error(
    "CLICKHOUSE_URL is not set. " +
      "Add it to your .env file before starting the server."
  );
}

if (!password) {
  throw new Error(
    "CLICKHOUSE_PASSWORD is not set. " +
      "Add it to your .env file before starting the server."
  );
}

export const ch = createClient({
  url,
  username,
  password,
  database,

  // Keep-alive keeps the underlying HTTP connection open between queries,
  // which meaningfully reduces latency on the first query after idle periods.
  // Important for Cloud Run where the process may be warm but idle.
  keep_alive: {
    enabled: true,
  },

  // ClickHouse responses come back as JSON by default.
  // JSONEachRow is the most convenient format for row-by-row processing —
  // each row is a plain JS object rather than a columnar array.
  clickhouse_settings: {
    output_format_json_quote_64bit_integers: 0,
  },
});
