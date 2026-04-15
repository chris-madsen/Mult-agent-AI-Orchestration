#!/usr/bin/env bash
set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "error: jq is required but not found" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "error: curl is required but not found" >&2; exit 1; }
command -v gcloud >/dev/null 2>&1 || { echo "error: gcloud is required but not found" >&2; exit 1; }

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

VERTEX_PROJECT="${VERTEX_PROJECT:-${GOOGLE_CLOUD_PROJECT:-}}"
VERTEX_LOCATION="${VERTEX_LOCATION:-${GOOGLE_CLOUD_LOCATION:-global}}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-pro}"

if [[ -z "$VERTEX_PROJECT" ]]; then
  echo "error: VERTEX_PROJECT/GOOGLE_CLOUD_PROJECT is required" >&2
  exit 1
fi

token="$(gcloud auth application-default print-access-token 2>/dev/null || true)"
if [[ -z "$token" ]]; then
  echo "error: failed to obtain ADC access token (run: gcloud auth application-default login)" >&2
  exit 1
fi

endpoint="https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent"

payload="$(jq -cn --arg text "$prompt" '{
  contents: [{ role: "user", parts: [{ text: $text }] }]
}')"

response="$(curl -sS --connect-timeout 10 --max-time 600 \
  -H "Authorization: Bearer '"$token"'" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "$endpoint" || true)"

text="$(printf '%s' "$response" | jq -r '.candidates[0].content.parts[0].text // empty' 2>/dev/null || true)"
if [[ -z "$text" ]]; then
  err="$(printf '%s' "$response" | jq -c '.error // empty' 2>/dev/null || true)"
  if [[ -n "$err" ]]; then
    jq -cn --arg text "vertex error: $err" '{type:"content_block_delta",delta:{type:"text_delta",text:($text+"\n")}}'
    echo '{"type":"result","result":""}'
    exit 0
  fi
  jq -cn --arg text "vertex error: empty response" '{type:"content_block_delta",delta:{type:"text_delta",text:($text+"\n")}}'
  echo '{"type":"result","result":""}'
  exit 0
fi

jq -cn --arg text "$text" '{type:"content_block_delta",delta:{type:"text_delta",text:($text+"\n")}}'
echo '{"type":"result","result":""}'

