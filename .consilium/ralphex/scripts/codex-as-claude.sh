#!/usr/bin/env bash
set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "error: jq is required but not found" >&2; exit 1; }

prompt=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p)
      prompt="${2:-}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$prompt" && ! -t 0 ]]; then
  prompt=$(cat)
fi
if [[ -z "$prompt" ]]; then
  echo "error: no prompt provided" >&2
  exit 1
fi

CODEX_MODEL="${CODEX_MODEL:-}"
CODEX_SANDBOX="${CODEX_SANDBOX:-danger-full-access}"
CODEX_VERBOSE="${CODEX_VERBOSE:-0}"
CODEX_PROVIDER="${CONSILIUM_CODEX_MODEL_PROVIDER:-openai}"
CODEX_REASONING_EFFORT="${CONSILIUM_CODEX_REASONING_EFFORT:-high}"
if [[ -z "$CODEX_PROVIDER" || "${CODEX_PROVIDER,,}" == "consilium" ]]; then
  CODEX_PROVIDER="openai"
fi
CODEX_BIN_CANDIDATE="${CONSILIUM_CODEX_COMMAND:-${CODEX_COMMAND:-codex}}"
CODEX_BIN=""
if [[ -x "$CODEX_BIN_CANDIDATE" ]]; then
  CODEX_BIN="$CODEX_BIN_CANDIDATE"
else
  CODEX_BIN="$(command -v "$CODEX_BIN_CANDIDATE" 2>/dev/null || true)"
fi
if [[ -z "$CODEX_BIN" ]]; then
  echo "error: codex binary not found (set CONSILIUM_CODEX_COMMAND or add codex to PATH)" >&2
  exit 127
fi

codex_args=(
  exec
  --json
  --ephemeral
  --dangerously-bypass-approvals-and-sandbox
  -s "$CODEX_SANDBOX"
  -c "model_provider='$CODEX_PROVIDER'"
)
if [[ -n "$CODEX_REASONING_EFFORT" ]]; then
  codex_args+=(-c "model_reasoning_effort='$CODEX_REASONING_EFFORT'")
fi
if [[ -n "$CODEX_MODEL" ]]; then
  codex_args+=(-m "$CODEX_MODEL")
fi

tmp_out="$(mktemp)"
tmp_err="$(mktemp)"
cleanup() {
  rm -f "$tmp_out" "$tmp_err"
}
trap cleanup EXIT

set +e
printf '%s' "$prompt" | "$CODEX_BIN" "${codex_args[@]}" >"$tmp_out" 2>"$tmp_err"
codex_status=$?
set -e

while IFS= read -r line; do
  echo "$line" | jq -c --argjson verbose "$CODEX_VERBOSE" '
    if .type == "item.completed" then
      if .item.type == "agent_message" then
        {type: "content_block_delta", delta: {type: "text_delta", text: (.item.text + "\n")}}
      elif .item.type == "command_execution" and $verbose == 1 then
        {type: "content_block_delta", delta: {type: "text_delta", text: ("$ " + .item.command + "\n" + (.item.aggregated_output // "") + "\n")}}
      else
        empty
      end
    elif .type == "turn.completed" then
      {type: "result", result: ""}
    else
      empty
    end
  ' 2>/dev/null || true
done <"$tmp_out"

if [[ "$codex_status" -ne 0 ]]; then
  codex_error_msg="$(jq -r 'select(.type == "error" and (.message | type == "string")) | .message' "$tmp_out" | tail -n 1)"
  if [[ -n "$codex_error_msg" ]]; then
    echo "error: codex exec failed: $codex_error_msg" >&2
  elif [[ -s "$tmp_err" ]]; then
    tail -n 50 "$tmp_err" >&2
  else
    echo "error: codex exec failed with status $codex_status" >&2
  fi
  exit "$codex_status"
fi

echo '{"type":"result","result":""}'
