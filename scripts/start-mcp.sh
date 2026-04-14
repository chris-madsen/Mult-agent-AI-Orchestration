#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${ROOT_DIR}/.venv/bin/python"
SERVER_FILE="${ROOT_DIR}/mcp_server.py"
ENV_FILE="${ROOT_DIR}/.env"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "[fail] Missing ${PYTHON_BIN}. Run: make check-runtime-deep" >&2
  exit 1
fi

if [[ ! -f "${SERVER_FILE}" ]]; then
  echo "[fail] Missing ${SERVER_FILE}" >&2
  exit 1
fi

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ "${1:-}" == "--check" ]]; then
  "${PYTHON_BIN}" - <<'PY'
import importlib.util
for mod in ("mcp", "autogen", "yaml"):
    if importlib.util.find_spec(mod) is None:
        raise SystemExit(f"missing module: {mod}")
print("mcp_runtime_ok")
PY
  exit 0
fi

exec "${PYTHON_BIN}" "${SERVER_FILE}"
