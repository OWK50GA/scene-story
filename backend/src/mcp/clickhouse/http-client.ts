/**
 * http-client.ts
 *
 * TypeScript MCP client for the official ClickHouse MCP server.
 *
 * Connects to a running instance of the official `mcp-clickhouse` Python
 * server via its Streamable HTTP transport. The Python server must be
 * started separately — see scripts/start-mcp-clickhouse.sh.
 *
 * This satisfies the ClickHouse hackathon track requirement:
 *   "actively use ClickHouse at runtime via the official ClickHouse MCP
 *    server (mcp-clickhouse), connecting to a ClickHouse Cloud or
 *    self-hosted cluster."
 *
 * Usage:
 *   import { runQuery } from "../../mcp/clickhouse/http-client.js";
 *
 *   const rows = await runQuery<{ scene_number: number }>(
 *     "SELECT scene_number FROM lmm.scenes WHERE story_unit_id = 'abc'"
 *   );
 *
 * Configuration:
 *   CLICKHOUSE_MCP_URL   Full URL to the MCP server endpoint, e.g.
 *                        http://localhost:8000/mcp
 *                        Defaults to http://localhost:8000/mcp.
 *
 *   CLICKHOUSE_MCP_AUTH_TOKEN  Bearer token for the MCP server when HTTP
 *                              transport authentication is enabled.
 *                              Optional — omit for local dev without auth.
 *
 * Lifecycle:
 *   The client is a lazy singleton. The connection is established on the
 *   first call to runQuery() and reused for the lifetime of the process.
 *   A failed connection attempt resets the singleton so the next call
 *   retries rather than using a broken client.
 *
 * Graceful degradation:
 *   If the MCP server is unreachable, runQuery() throws an McpClientError.
 *   Callers must handle this — the main ingestion pipeline is NOT affected
 *   because it uses operations.ts directly. Only monitoring.ts uses this
 *   client, and it already wraps all calls in .catch(() => []).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// =============================================================================
// Configuration
// =============================================================================

const MCP_URL = process.env.CLICKHOUSE_MCP_URL ?? "http://localhost:8000/sse";
const MCP_AUTH_TOKEN = process.env.CLICKHOUSE_MCP_AUTH_TOKEN;

// =============================================================================
// Error type
// =============================================================================

export class McpClientError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "McpClientError";
  }
}

// =============================================================================
// Lazy singleton client
// =============================================================================

let _client: Client | null = null;

/**
 * getClient
 *
 * Returns the connected MCP client, creating and connecting it on first call.
 * Resets the singleton on connection failure so the next invocation retries.
 */
async function getClient(): Promise<Client> {
  if (_client) return _client;

  const transport = new SSEClientTransport(new URL(MCP_URL));

  const client = new Client(
    { name: "agentic-cinema-backend", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
  } catch (err) {
    _client = null;
    throw new McpClientError(
      `Failed to connect to mcp-clickhouse at ${MCP_URL}. ` +
        `Ensure the Python MCP server is running (see scripts/start-mcp-clickhouse.sh). ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  _client = client;
  return client;
}

/**
 * resetClient
 *
 * Forces the next call to getClient() to create a fresh connection.
 * Called internally on tool-call failure to avoid reusing a broken client.
 */
function resetClient(): void {
  _client = null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * runQuery
 *
 * Executes a SQL SELECT query against ClickHouse through the official
 * mcp-clickhouse MCP server. Returns rows as an array of typed objects.
 *
 * The official server exposes a `run_query` tool that executes SQL and
 * returns JSON-encoded rows. It is read-only by default (readonly=1),
 * which is appropriate for all monitoring and health-check queries.
 *
 * @param sql  A SQL SELECT statement to execute.
 * @returns    Array of result rows, typed as T.
 * @throws     McpClientError if the MCP server is unreachable or the
 *             tool call fails.
 *
 * @example
 *   const rows = await runQuery<{ count: string }>(
 *     "SELECT count() AS count FROM lmm.scenes"
 *   );
 */
export async function runQuery<T = Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  let client: Client;

  try {
    client = await getClient();
  } catch (err) {
    // Re-throw as McpClientError (already is one from getClient)
    throw err instanceof McpClientError
      ? err
      : new McpClientError(String(err), err);
  }

  try {
    const result = await client.callTool({
      name: "run_query",
      arguments: { query: sql },
    });

    // The official server returns content as an array of text parts.
    // Each text part is a JSON string. Concatenate and parse.
    const parts = result.content as Array<{ type: string; text?: string }>;
    const text = parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");

    if (!text) {
      return [];
    }

    const parsed: unknown = JSON.parse(text);

    // The official mcp-clickhouse server returns a columnar format:
    // { "columns": ["col1", "col2", ...], "rows": [[val1, val2, ...], ...] }
    // Convert to an array of plain objects keyed by column name.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "columns" in parsed &&
      "rows" in parsed &&
      Array.isArray((parsed as Record<string, unknown>).columns) &&
      Array.isArray((parsed as Record<string, unknown>).rows)
    ) {
      const { columns, rows } = parsed as { columns: string[]; rows: unknown[][] };
      return rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
          obj[columns[i]!] = row[i];
        }
        return obj as T;
      });
    }

    // Flat array of objects (alternative format)
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }

    // { data: [...] } wrapper
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "data" in parsed &&
      Array.isArray((parsed as Record<string, unknown>).data)
    ) {
      return (parsed as { data: T[] }).data;
    }

    return [];
  } catch (err) {
    // Reset the singleton so the next call reconnects fresh.
    resetClient();

    if (err instanceof McpClientError) throw err;

    throw new McpClientError(
      `mcp-clickhouse run_query failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

/**
 * isMcpAvailable
 *
 * Performs a lightweight connectivity check by calling list_databases.
 * Returns true if the MCP server is reachable and responding, false otherwise.
 * Never throws. Useful for health endpoints and startup diagnostics.
 */
export async function isMcpAvailable(): Promise<boolean> {
  try {
    const client = await getClient();
    await client.callTool({ name: "list_databases", arguments: {} });
    return true;
  } catch {
    resetClient();
    return false;
  }
}
