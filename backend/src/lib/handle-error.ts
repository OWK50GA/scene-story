import type { Response } from "express";
import { MCPOperationError } from "../types/index.js";

/**
 * Maps an MCPOperationError code to the appropriate HTTP status code.
 *
 * - not_found              → 404
 * - clickhouse.*_failed    → 500  (infrastructure failure, not a client error)
 * - everything else        → 400  (validation / domain constraint)
 */
function mcpStatusCode(code: string): number {
  if (code.endsWith("not_found")) return 404;
  if (code.startsWith("clickhouse.")) return 500;
  return 400;
}

export function handleError(err: unknown, res: Response) {
  if (err instanceof MCPOperationError) {
    return res.status(mcpStatusCode(err.code)).json({
      status: "error",
      message: err.message,
      code: err.code,
    });
  }
  return res.status(500).json({
    status: "error",
    message: "Internal Server Error",
  });
}
