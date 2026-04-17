#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ ! -f ".env" ]]; then
  echo "[fail] missing .env in $PROJECT_ROOT" >&2
  exit 1
fi

set -a
source .env
set +a

echo "timestamp=$(date -Is)"
echo "project_root=$PROJECT_ROOT"
echo "git_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
echo "git_head=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "git_dirty_count=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

codex_bin="$(command -v codex || true)"
ralphex_bin="$(command -v ralphex || true)"
python_bin="${PROJECT_ROOT}/.venv/bin/python"

echo "codex_bin=${codex_bin:-missing}"
if [[ -n "$codex_bin" ]]; then
  echo "codex_version=$("$codex_bin" --version 2>/dev/null || echo unknown)"
fi
echo "ralphex_bin=${ralphex_bin:-missing}"
if [[ -n "$ralphex_bin" ]]; then
  echo "ralphex_version=$("$ralphex_bin" --version 2>/dev/null | head -n 1 || echo unknown)"
fi
echo "venv_python_bin=$python_bin"
if [[ -x "$python_bin" ]]; then
  echo "venv_python_version=$("$python_bin" --version 2>&1)"
fi

echo "gateway_host=${GATEWAY_HOST:-127.0.0.1}"
echo "gateway_port=${GATEWAY_PORT:-8000}"
echo "consilium_ralphex_mode=${CONSILIUM_RALPHEX_MODE:-}"
echo "consilium_ralphex_timeout_sec=${CONSILIUM_RALPHEX_TIMEOUT_SEC:-}"
echo "consilium_ralphex_idle_timeout_sec=${CONSILIUM_RALPHEX_IDLE_TIMEOUT_SEC:-}"
echo "consilium_ralphex_execute_idle_timeout_sec=${CONSILIUM_RALPHEX_EXECUTE_IDLE_TIMEOUT_SEC:-}"
echo "consilium_ralphex_chat_session_timeout_sec=${CONSILIUM_RALPHEX_CHAT_SESSION_TIMEOUT_SEC:-}"
echo "consilium_ralphex_chat_idle_timeout_sec=${CONSILIUM_RALPHEX_CHAT_IDLE_TIMEOUT_SEC:-}"
echo "consilium_ralphex_chat_max_iterations=${CONSILIUM_RALPHEX_CHAT_MAX_ITERATIONS:-}"
echo "consilium_public_model=${CONSILIUM_PUBLIC_MODEL:-}"
echo "consilium_public_model_aliases=${CONSILIUM_PUBLIC_MODEL_ALIASES:-}"
echo "consilium_gateway_expose_progress_trace=${CONSILIUM_GATEWAY_EXPOSE_PROGRESS_TRACE:-}"
echo "consilium_gateway_expose_progress_trace_success=${CONSILIUM_GATEWAY_EXPOSE_PROGRESS_TRACE_SUCCESS:-0}"
echo "consilium_gateway_block_git_commits=${CONSILIUM_GATEWAY_BLOCK_GIT_COMMITS:-}"
echo "consilium_gateway_enable_direct_codex_fallback=${CONSILIUM_GATEWAY_ENABLE_DIRECT_CODEX_FALLBACK:-0}"
echo "consilium_gateway_enable_limit_fallback_to_gemini=${CONSILIUM_GATEWAY_ENABLE_LIMIT_FALLBACK_TO_GEMINI:-0}"
echo "consilium_gateway_limit_fallback_model=${CONSILIUM_GATEWAY_LIMIT_FALLBACK_MODEL:-gemini-2.5-pro}"
echo "consilium_codex_command=${CONSILIUM_CODEX_COMMAND:-}"

if [[ -n "${CONSILIUM_API_KEY:-}" ]]; then
  api_key_hash="$(printf '%s' "$CONSILIUM_API_KEY" | sha256sum | awk '{print $1}')"
  echo "consilium_api_key_sha256=${api_key_hash}"
fi

if ss -ltn "( sport = :${GATEWAY_PORT:-8000} )" 2>/dev/null | grep -q LISTEN; then
  listener_pid="$("${PROJECT_ROOT}/.venv/bin/python" "${PROJECT_ROOT}/scripts/tcp_listener_pid.py" "${GATEWAY_HOST:-127.0.0.1}" "${GATEWAY_PORT:-8000}" 2>/dev/null || true)"
  echo "gateway_listener_pid=${listener_pid:-unknown}"
fi

echo "[run] ensure-gateway"
make --no-print-directory ensure-gateway-managed

echo "[run] smoke-chat-runtime"
"${PROJECT_ROOT}/scripts/smoke-chat-runtime.sh" "${1:-}"
