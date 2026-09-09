#!/usr/bin/env bash
# =============================================================================
# start-mcp-clickhouse.sh
#
# Starts the official ClickHouse MCP server (github.com/ClickHouse/mcp-clickhouse)
# using HTTP transport so the TypeScript backend can connect to it via the
# Streamable HTTP MCP client in src/mcp/clickhouse/http-client.ts.
#
# Prerequisites:
#   pip install mcp-clickhouse
#   # or, with uv:
#   uv pip install mcp-clickhouse
#
# Usage:
#   # From the backend/ directory:
#   bash scripts/start-mcp-clickhouse.sh
#
#   # Or source your .env first then run:
#   set -a && source .env && set +a
#   bash scripts/start-mcp-clickhouse.sh
#
# The script reads ClickHouse credentials from environment variables.
# Copy these from your .env file or export them before running.
#
# The MCP server binds to 127.0.0.1:8000 by default. The TypeScript backend
# connects to http://localhost:8000/mcp (configurable via CLICKHOUSE_MCP_URL).
#
# Health check:
#   curl http://localhost:8000/health   # should return: OK
#
# Authentication:
#   For production, set CLICKHOUSE_MCP_AUTH_TOKEN to a random secret and
#   set the same value as CLICKHOUSE_MCP_AUTH_TOKEN in the backend's .env.
#   For local development, authentication is disabled by default here.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve .env — load it if it exists and no credentials are set yet
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"

if [[ -f "${ENV_FILE}" && -z "${CLICKHOUSE_HOST:-}" ]]; then
  echo "[mcp-clickhouse] Loading credentials from ${ENV_FILE}"
  # Export only CLICKHOUSE_* and CLICKHOUSE_MCP_* vars, skip comments and blanks
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(CLICKHOUSE_|CLICKHOUSE_MCP_)' "${ENV_FILE}" | grep -v '^#')
  set +a
fi

# ---------------------------------------------------------------------------
# Required: ClickHouse credentials
# ---------------------------------------------------------------------------

: "${CLICKHOUSE_HOST:?CLICKHOUSE_HOST is not set. Set it in .env or export it.}"
: "${CLICKHOUSE_PASSWORD:?CLICKHOUSE_PASSWORD is not set. Set it in .env or export it.}"

# mcp-clickhouse uses CLICKHOUSE_USER, not CLICKHOUSE_USERNAME
export CLICKHOUSE_USER="${CLICKHOUSE_USERNAME:-${CLICKHOUSE_USER:-default}}"
export CLICKHOUSE_HOST
export CLICKHOUSE_PORT="${CLICKHOUSE_PORT:-8443}"
export CLICKHOUSE_PASSWORD
export CLICKHOUSE_DATABASE="${CLICKHOUSE_DATABASE:-lmm}"
export CLICKHOUSE_SECURE="${CLICKHOUSE_SECURE:-true}"
export CLICKHOUSE_VERIFY="${CLICKHOUSE_VERIFY:-true}"

# ---------------------------------------------------------------------------
# MCP server transport — HTTP so the TypeScript client can connect
# ---------------------------------------------------------------------------

export CLICKHOUSE_MCP_SERVER_TRANSPORT="sse"
export CLICKHOUSE_MCP_BIND_HOST="${CLICKHOUSE_MCP_BIND_HOST:-127.0.0.1}"
export CLICKHOUSE_MCP_BIND_PORT="${CLICKHOUSE_MCP_BIND_PORT:-8000}"

# ---------------------------------------------------------------------------
# Authentication
# Set CLICKHOUSE_MCP_AUTH_TOKEN to a secret for production.
# Disabled here for local development convenience.
# ---------------------------------------------------------------------------

if [[ -n "${CLICKHOUSE_MCP_AUTH_TOKEN:-}" ]]; then
  echo "[mcp-clickhouse] Auth: bearer token"
else
  export CLICKHOUSE_MCP_AUTH_DISABLED="true"
  export CLICKHOUSE_MCP_ALLOWED_HOSTS="127.0.0.1:${CLICKHOUSE_MCP_BIND_PORT},localhost:${CLICKHOUSE_MCP_BIND_PORT}"
  echo "[mcp-clickhouse] Auth: disabled (local dev)"
fi

# ---------------------------------------------------------------------------
# Resolve Python — prefer the local venv, fall back to system python3
#
# To set up the venv (run once from backend/):
#   python3 -m venv .venv
#   .venv/bin/pip install mcp-clickhouse
# ---------------------------------------------------------------------------

VENV_PYTHON="${SCRIPT_DIR}/../.venv/bin/python3"

if [[ -x "${VENV_PYTHON}" ]]; then
  PYTHON="${VENV_PYTHON}"
  echo "[mcp-clickhouse] Using venv Python: ${PYTHON}"
else
  PYTHON="python3"
  echo "[mcp-clickhouse] Venv not found — using system Python (${PYTHON})"
fi

# ---------------------------------------------------------------------------
# Check that mcp-clickhouse is installed
# ---------------------------------------------------------------------------

if ! "${PYTHON}" -c "import mcp_clickhouse" 2>/dev/null; then
  echo ""
  echo "ERROR: mcp-clickhouse is not installed."
  echo "Set up the venv and install it:"
  echo ""
  echo "  cd backend"
  echo "  python3 -m venv .venv"
  echo "  .venv/bin/pip install mcp-clickhouse"
  echo ""
  exit 1
fi

# ---------------------------------------------------------------------------
# Start the server
# ---------------------------------------------------------------------------

MCP_ENDPOINT="http://${CLICKHOUSE_MCP_BIND_HOST}:${CLICKHOUSE_MCP_BIND_PORT}/mcp"
HEALTH_ENDPOINT="http://${CLICKHOUSE_MCP_BIND_HOST}:${CLICKHOUSE_MCP_BIND_PORT}/health"

echo ""
echo "==================================================================="
echo "  ClickHouse MCP Server"
echo "==================================================================="
echo "  Host     : ${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}"
echo "  Database : ${CLICKHOUSE_DATABASE}"
echo "  MCP      : ${MCP_ENDPOINT}"
echo "  Health   : ${HEALTH_ENDPOINT}"
echo "==================================================================="
echo ""

exec "${PYTHON}" -m mcp_clickhouse.main
