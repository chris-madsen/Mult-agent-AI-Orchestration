#!/usr/bin/env bash
set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "error: jq is required but not found" >&2; exit 1; }
command -v timeout >/dev/null 2>&1 || { echo "error: timeout is required but not found" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "error: python3 is required but not found" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"

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
  prompt="$(cat)"
fi

if [[ -z "$prompt" ]]; then
  echo "error: no prompt provided" >&2
  exit 1
fi

CONSILIUM_PYTHON="${CONSILIUM_PYTHON:-}"
VERTEX_PROJECT="${VERTEX_PROJECT:-${GOOGLE_CLOUD_PROJECT:-}}"
VERTEX_LOCATION="${VERTEX_LOCATION:-${CONSILIUM_VERTEX_ANTHROPIC_REGION:-${GOOGLE_CLOUD_LOCATION:-global}}}"
ANTHROPIC_VERTEX_MODEL="${ANTHROPIC_VERTEX_MODEL:-}"
VERTEX_HTTP_MAX_TIME_SEC="${VERTEX_HTTP_MAX_TIME_SEC:-120}"

if [[ -z "$VERTEX_PROJECT" ]]; then
  echo "error: VERTEX_PROJECT/GOOGLE_CLOUD_PROJECT is required" >&2
  exit 1
fi

if [[ -z "$CONSILIUM_PYTHON" ]]; then
  if [[ -x "${PROJECT_ROOT}/.venv/bin/python" ]]; then
    if timeout 3 "${PROJECT_ROOT}/.venv/bin/python" -c 'pass' >/dev/null 2>&1; then
      CONSILIUM_PYTHON="${PROJECT_ROOT}/.venv/bin/python"
    else
      CONSILIUM_PYTHON="$(command -v python3)"
    fi
  else
    CONSILIUM_PYTHON="$(command -v python3)"
  fi
fi

if [[ -z "$ANTHROPIC_VERTEX_MODEL" ]]; then
  echo "error: ANTHROPIC_VERTEX_MODEL is required" >&2
  exit 1
fi

add_candidate_location() {
  local candidate="$1"
  local current
  if [[ -z "$candidate" ]]; then
    return
  fi
  for current in "${candidate_locations[@]}"; do
    if [[ "$current" == "$candidate" ]]; then
      return
    fi
  done
  candidate_locations+=("$candidate")
}

candidate_locations=()
add_candidate_location "$VERTEX_LOCATION"
add_candidate_location "${CONSILIUM_VERTEX_ANTHROPIC_REGION:-}"
add_candidate_location "global"
add_candidate_location "us-east5"
add_candidate_location "us-central1"

response_json=""
text=""
last_error=""

for location in "${candidate_locations[@]}"; do
  tmp_err="$(mktemp)"
  if response_json="$(PROMPT="$prompt" VERTEX_PROJECT="$VERTEX_PROJECT" VERTEX_LOCATION="$location" ANTHROPIC_VERTEX_MODEL="$ANTHROPIC_VERTEX_MODEL" \
    timeout "$VERTEX_HTTP_MAX_TIME_SEC" "$CONSILIUM_PYTHON" - <<'PY' 2>"$tmp_err"
import json
import os
import sys

from anthropic import AnthropicVertex

prompt = os.environ.get("PROMPT", "")
project = os.environ.get("VERTEX_PROJECT", "")
location = os.environ.get("VERTEX_LOCATION", "us-east5")
model = os.environ.get("ANTHROPIC_VERTEX_MODEL", "")

if not prompt:
    print("error: prompt is empty", file=sys.stderr)
    raise SystemExit(1)
if not project:
    print("error: VERTEX_PROJECT is required", file=sys.stderr)
    raise SystemExit(1)
if not model:
    print("error: ANTHROPIC_VERTEX_MODEL is required", file=sys.stderr)
    raise SystemExit(1)

try:
    client = AnthropicVertex(project_id=project, region=location, timeout=20, max_retries=0)
    resp = client.messages.create(
        model=model,
        max_tokens=2048,
        temperature=0.2,
        messages=[{"role": "user", "content": prompt}],
    )
except Exception as exc:
    print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
    raise SystemExit(1)

chunks = []
for block in getattr(resp, "content", []):
    if getattr(block, "type", "") == "text":
        chunks.append(getattr(block, "text", ""))
text = "".join(chunks).strip()
print(json.dumps({"text": text}, ensure_ascii=False))
PY
  )"; then
    text="$(echo "$response_json" | jq -r '.text // empty')"
    if [[ -n "$text" ]]; then
      rm -f "$tmp_err" 2>/dev/null || true
      break
    fi
    last_error="error: empty response from Vertex Anthropic (location=${location})"
  else
    err_text="$(tr '\n' ' ' <"$tmp_err" | sed 's/[[:space:]]\+/ /g' | sed 's/[[:space:]]*$//')"
    if [[ -z "$err_text" ]]; then
      err_text="unknown error"
    fi
    last_error="error: ${err_text} (location=${location})"
    err_norm="$(printf '%s' "$err_text" | tr '[:upper:]' '[:lower:]')"
    # Quota/auth errors should surface immediately; retrying other regions masks the root cause.
    if [[ "$err_norm" == *"ratelimiterror"* || "$err_norm" == *"resource_exhausted"* || "$err_norm" == *"error code: 429"* || "$err_norm" == *"permissiondenied"* || "$err_norm" == *"error code: 403"* || "$err_norm" == *"unauthenticated"* || "$err_norm" == *"error code: 401"* ]]; then
      rm -f "$tmp_err" 2>/dev/null || true
      break
    fi
  fi
  rm -f "$tmp_err" 2>/dev/null || true
done

if [[ -z "$text" ]]; then
  echo "${last_error:-error: failed to call Vertex Anthropic}" >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  jq -cn --arg text "$line" '{type:"content_block_delta",delta:{type:"text_delta",text:($text+"\n")}}'
done <<< "$text"

jq -cn '{type:"result","result":""}'
