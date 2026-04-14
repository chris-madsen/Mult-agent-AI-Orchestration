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

codex_args=(exec --json --dangerously-bypass-approvals-and-sandbox -s "$CODEX_SANDBOX")
if [[ -n "$CODEX_MODEL" ]]; then
  codex_args+=(-m "$CODEX_MODEL")
fi

printf '%s' "$prompt" | codex "${codex_args[@]}" 2>/dev/null | while IFS= read -r line; do
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
done || true

echo '{"type":"result","result":""}'
