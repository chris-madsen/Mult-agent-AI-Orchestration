#!/usr/bin/env bash
set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "error: jq is required but not found" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "error: curl is required but not found" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "error: python3 is required but not found" >&2; exit 1; }
command -v timeout >/dev/null 2>&1 || { echo "error: timeout is required but not found" >&2; exit 1; }

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
  prompt=$(cat)
fi
if [[ -z "$prompt" ]]; then
  echo "error: no prompt provided" >&2
  exit 1
fi

VERTEX_PROJECT="${VERTEX_PROJECT:-${GOOGLE_CLOUD_PROJECT:-}}"
VERTEX_LOCATION="${VERTEX_LOCATION:-${CONSILIUM_VERTEX_GEMINI_REGION:-${GOOGLE_CLOUD_LOCATION:-global}}}"
GEMINI_MODEL="${GEMINI_MODEL:-}"
VERTEX_HTTP_CONNECT_TIMEOUT_SEC="${VERTEX_HTTP_CONNECT_TIMEOUT_SEC:-10}"
VERTEX_HTTP_MAX_TIME_SEC="${VERTEX_HTTP_MAX_TIME_SEC:-120}"
VERTEX_TOKEN_TIMEOUT_SEC="${VERTEX_TOKEN_TIMEOUT_SEC:-45}"
VERTEX_TOKEN_CACHE_PATH="${VERTEX_TOKEN_CACHE_PATH:-${PROJECT_ROOT}/.consilium/tmp/vertex_access_token.json}"
CONSILIUM_PYTHON="${CONSILIUM_PYTHON:-}"
CONSILIUM_VERTEX_INTERNAL_CALL="${CONSILIUM_VERTEX_INTERNAL_CALL:-0}"
CONSILIUM_ARCHITECT_MODEL="${CONSILIUM_ARCHITECT_MODEL:-}"
CONSILIUM_VERTEX_CHAT_SHORTCUT="${CONSILIUM_VERTEX_CHAT_SHORTCUT:-1}"

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

resolve_role_model_from_policy() {
  local role="$1"
  CONSILIUM_ROLE_NAME="$role" "$CONSILIUM_PYTHON" - <<'PY' 2>/dev/null || true
import pathlib
import os

role = str(os.environ.get("CONSILIUM_ROLE_NAME") or "").strip().lower()
if not role:
    raise SystemExit(0)

root = pathlib.Path(os.environ.get("CONSILIUM_PROJECT_ROOT") or "").resolve()
if not str(root):
    root = pathlib.Path.cwd().resolve()
path = root / ".consilium" / "policies" / "model_config.yaml"
if not path.exists():
    raise SystemExit(0)

lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
in_roles = False
in_target_role = False
in_model = False

for raw in lines:
    line = raw.rstrip()
    stripped = line.strip()

    if not in_roles:
        if stripped == "roles:":
            in_roles = True
        continue

    if not stripped or stripped.startswith("#"):
        continue

    if not line.startswith("  "):
        break

    # role header: "  architect:"
    if line.startswith("  ") and not line.startswith("    "):
        in_model = False
        if stripped.endswith(":"):
            role_name = stripped[:-1].strip().lower()
            in_target_role = role_name == role
        else:
            in_target_role = False
        continue

    if not in_target_role:
        continue

    # role field header: "    model:" or "    model: gemini-x"
    if line.startswith("    ") and not line.startswith("      "):
        key, sep, value = stripped.partition(":")
        key = key.strip().lower()
        value = value.strip()
        if key == "model":
            if value:
                print(value)
                raise SystemExit(0)
            in_model = True
        else:
            in_model = False
        continue

    if in_model and line.startswith("      -"):
        value = line.split("-", 1)[1].strip()
        if value:
            print(value)
            raise SystemExit(0)
PY
}

if [[ -z "$GEMINI_MODEL" ]]; then
  GEMINI_MODEL="$(CONSILIUM_PROJECT_ROOT="$PROJECT_ROOT" resolve_role_model_from_policy implementer)"
fi
if [[ -z "$CONSILIUM_ARCHITECT_MODEL" ]]; then
  CONSILIUM_ARCHITECT_MODEL="$(CONSILIUM_PROJECT_ROOT="$PROJECT_ROOT" resolve_role_model_from_policy architect)"
fi
if [[ -z "$GEMINI_MODEL" ]]; then
  echo "error: GEMINI_MODEL is required (env or policy role implementer)" >&2
  exit 1
fi
if [[ -z "$CONSILIUM_ARCHITECT_MODEL" ]]; then
  CONSILIUM_ARCHITECT_MODEL="$GEMINI_MODEL"
fi

if [[ "${GEMINI_MODEL,,}" == gemini-3* ]]; then
  VERTEX_LOCATION="global"
fi

RALPHEX_PLAN_PATH=""
if [[ "$CONSILIUM_VERTEX_CHAT_SHORTCUT" == "1" ]]; then
  RALPHEX_PLAN_PATH="${CONSILIUM_PLAN_FILE:-}"
  if [[ -z "$RALPHEX_PLAN_PATH" || ! -f "$RALPHEX_PLAN_PATH" ]]; then
    RALPHEX_PLAN_PATH="$(
    RALPHEX_PROMPT="$prompt" "$CONSILIUM_PYTHON" - <<'PY' 2>/dev/null || true
import os
import re

prompt = str(os.environ.get("RALPHEX_PROMPT") or "")
match = re.search(
    r"Read the plan file at\s+([^\n]+?)\.\s+Find the FIRST Task section",
    prompt,
    flags=re.IGNORECASE,
)
if not match:
    match = re.search(r"Read the plan file at\s+([^\n]+?)\.", prompt, flags=re.IGNORECASE)
if match:
    print(match.group(1).strip())
PY
    )"
  fi
fi
RALPHEX_CHAT_MODE="0"
RALPHEX_CHAT_REQUEST=""
CHAT_FORCE_ANSWER=""
CHAT_FALLBACK_ANSWER=""
if [[ "$CONSILIUM_VERTEX_CHAT_SHORTCUT" == "1" && "$CONSILIUM_VERTEX_INTERNAL_CALL" != "1" && "${CONSILIUM_PLAN_MODE:-0}" != "1" && -n "$RALPHEX_PLAN_PATH" && -f "$RALPHEX_PLAN_PATH" ]]; then
  RALPHEX_CHAT_REQUEST="$(
    RALPHEX_PLAN_PATH="$RALPHEX_PLAN_PATH" "$CONSILIUM_PYTHON" - <<'PY' 2>/dev/null || true
import os
import pathlib
import re

path = pathlib.Path(str(os.environ.get("RALPHEX_PLAN_PATH") or "").strip())
if not path.exists():
    raise SystemExit(0)
text = path.read_text(encoding="utf-8", errors="replace")
if "# Consilium Gateway Chat Plan" not in text:
    raise SystemExit(0)
# Chat-shortcut is allowed only for pure Q&A mode where shell usage is forbidden.
if "### Task 1: Answer User Request In Chat Mode" not in text:
    raise SystemExit(0)
if "Do NOT run shell commands." not in text:
    raise SystemExit(0)
latest_match = re.search(
    r"Latest user request:\s*```text\s*(.*?)\s*```",
    text,
    flags=re.IGNORECASE | re.DOTALL,
)
if not latest_match:
    raise SystemExit(0)
latest = latest_match.group(1).strip()
if not latest:
    raise SystemExit(0)
context_block = ""
context_match = re.search(
    r"Recent compact context:\s*(.*?)(?:\n###\s+Task|\Z)",
    text,
    flags=re.IGNORECASE | re.DOTALL,
)
if context_match:
    raw_context = context_match.group(1)
    rows = []
    for line in raw_context.splitlines():
        line = line.strip()
        if not line.startswith("- "):
            continue
        rows.append(line[2:].strip())
    if rows:
        context_block = "\n".join(rows[-4:])

if context_block:
    print(
        "Ответь на запрос пользователя в том же языке. "
        "Используй контекст только если он релевантен.\n\n"
        f"Контекст:\n{context_block}\n\n"
        f"Запрос пользователя:\n{latest}"
    )
else:
    print(latest)
PY
  )"
  if [[ -n "$RALPHEX_CHAT_REQUEST" ]]; then
    RALPHEX_CHAT_MODE="1"
    if [[ "${GEMINI_MODEL,,}" == gemini-3* ]]; then
      VERTEX_LOCATION="global"
    fi
    CHAT_FALLBACK_ANSWER="Ошибка доступа к Vertex в chat-shortcut. Повтори запрос."
    prompt="$RALPHEX_CHAT_REQUEST"
  fi
fi

mark_plan_complete() {
  local plan_path="$1"
  if [[ -z "$plan_path" || ! -f "$plan_path" ]]; then
    return
  fi
  RALPHEX_PLAN_PATH="$plan_path" "$CONSILIUM_PYTHON" - <<'PY' 2>/dev/null || true
import os
import pathlib

path = pathlib.Path(str(os.environ.get("RALPHEX_PLAN_PATH") or "").strip())
if not path.exists():
    raise SystemExit(0)
text = path.read_text(encoding="utf-8", errors="replace")
updated = text.replace("- [ ]", "- [x]")
if updated != text:
    path.write_text(updated, encoding="utf-8")
PY
}

emit_chat_result() {
  local answer="$1"
  local normalized
  normalized="$(printf '%s' "$answer" | tr '\r\n' ' ' | sed -E 's/[[:space:]]+/ /g' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  if [[ -z "$normalized" ]]; then
    normalized="Не удалось подготовить ответ."
  fi
  mark_plan_complete "$RALPHEX_PLAN_PATH"
  jq -cn --arg text "Final answer: ${normalized}" '{type:"content_block_delta",delta:{type:"text_delta",text:($text+"\n")}}'
  jq -cn --arg text "<<<RALPHEX:ALL_TASKS_DONE>>>" '{type:"content_block_delta",delta:{type:"text_delta",text:($text+"\n")}}'
  echo '{"type":"result","result":""}'
}

mkdir -p "$(dirname "$VERTEX_TOKEN_CACHE_PATH")" 2>/dev/null || true

token=""

# Fast path: refresh ADC user token directly via OAuth endpoint.
ADC_FILE="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/gcloud/application_default_credentials.json}"
if [[ -f "$ADC_FILE" ]]; then
  adc_client_id="$(jq -r '.client_id // empty' "$ADC_FILE" 2>/dev/null || true)"
  adc_client_secret="$(jq -r '.client_secret // empty' "$ADC_FILE" 2>/dev/null || true)"
  adc_refresh_token="$(jq -r '.refresh_token // empty' "$ADC_FILE" 2>/dev/null || true)"
  if [[ -n "$adc_client_id" && -n "$adc_client_secret" && -n "$adc_refresh_token" ]]; then
    oauth_response="$(
      timeout "${VERTEX_TOKEN_TIMEOUT_SEC}" curl -sS -X POST https://oauth2.googleapis.com/token \
        -H "Content-Type: application/x-www-form-urlencoded" \
        --data-urlencode grant_type=refresh_token \
        --data-urlencode client_id="$adc_client_id" \
        --data-urlencode client_secret="$adc_client_secret" \
        --data-urlencode refresh_token="$adc_refresh_token" \
        || true
    )"
    token="$(printf '%s' "$oauth_response" | jq -r '.access_token // empty' 2>/dev/null || true)"
  fi
fi

if [[ -z "$token" ]] && command -v gcloud >/dev/null 2>&1; then
  token="$(timeout "${VERTEX_TOKEN_TIMEOUT_SEC}" gcloud auth application-default print-access-token 2>/dev/null || true)"
  if [[ -z "$token" ]]; then
    token="$(timeout "${VERTEX_TOKEN_TIMEOUT_SEC}" gcloud auth print-access-token 2>/dev/null || true)"
  fi
fi

if [[ -n "$token" ]]; then
  VERTEX_TOKEN="$token" VERTEX_TOKEN_CACHE_PATH="$VERTEX_TOKEN_CACHE_PATH" "$CONSILIUM_PYTHON" - <<'PY' 2>/dev/null || true
import json
import os
import pathlib
import time

cache_path = pathlib.Path(os.environ.get("VERTEX_TOKEN_CACHE_PATH", ".consilium/tmp/vertex_access_token.json"))
token = str(os.environ.get("VERTEX_TOKEN") or "").strip()
if not token:
    raise SystemExit(0)

expiry = int(time.time()) + 1800
try:
    cache_path.write_text(
        json.dumps({"access_token": token, "expiry_epoch": expiry}, ensure_ascii=False),
        encoding="utf-8",
    )
except Exception:
    pass
PY
fi

if [[ -z "$token" ]]; then
  token="$(
  timeout "${VERTEX_TOKEN_TIMEOUT_SEC}" "$CONSILIUM_PYTHON" - <<'PY' 2>/dev/null
import json
import os
import pathlib
import time

cache_path = pathlib.Path(os.environ.get("VERTEX_TOKEN_CACHE_PATH", ".consilium/tmp/vertex_access_token.json"))
now = int(time.time())

def read_cached_token() -> str:
    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return ""
    token = str(data.get("access_token") or "").strip()
    expiry = int(data.get("expiry_epoch") or 0)
    if token and expiry - now > 120:
        return token
    return ""

cached = read_cached_token()
if cached:
    print(cached)
    raise SystemExit(0)

import google.auth
from google.auth.transport.requests import Request

creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
creds.refresh(Request())
token = str(creds.token or "").strip()
if not token:
    raise SystemExit(2)

expiry = int(time.time()) + 1800
if getattr(creds, "expiry", None):
    try:
        expiry = int(creds.expiry.timestamp())
    except Exception:
        pass

try:
    cache_path.write_text(
        json.dumps({"access_token": token, "expiry_epoch": expiry}, ensure_ascii=False),
        encoding="utf-8",
    )
except Exception:
    pass

print(token)
PY
)" || true
fi
if [[ -z "$token" ]]; then
  if [[ "$RALPHEX_CHAT_MODE" == "1" ]]; then
    emit_chat_result "${CHAT_FALLBACK_ANSWER:-Связь через Ralph активна, но временно не удалось получить ответ от Vertex.}"
    exit 0
  fi
  echo "error: failed to obtain ADC access token via google-auth" >&2
  exit 1
fi

payload="$(jq -cn --arg text "$prompt" '{
  contents: [{ role: "user", parts: [{ text: $text }] }]
}')"
endpoint_for_location() {
  local location="$1"
  if [[ "$location" == "global" ]]; then
    printf 'https://aiplatform.googleapis.com/v1/projects/%s/locations/global/publishers/google/models/%s:generateContent' \
      "$VERTEX_PROJECT" "$GEMINI_MODEL"
    return
  fi
  printf 'https://%s-aiplatform.googleapis.com/v1/projects/%s/locations/%s/publishers/google/models/%s:generateContent' \
    "$location" "$VERTEX_PROJECT" "$location" "$GEMINI_MODEL"
}

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
add_candidate_location "${CONSILIUM_VERTEX_GEMINI_REGION:-}"
if [[ "${VERTEX_ENABLE_LOCATION_FALLBACK:-0}" == "1" ]]; then
  add_candidate_location "global"
  add_candidate_location "us-central1"
fi

last_error=""
last_http_code=""
last_location=""

for location in "${candidate_locations[@]}"; do
  endpoint="$(endpoint_for_location "$location")"
  tmp_body="$(mktemp)"
  tmp_hdr="$(mktemp)"
  if http_code="$(
    curl -sS --connect-timeout "$VERTEX_HTTP_CONNECT_TIMEOUT_SEC" --max-time "$VERTEX_HTTP_MAX_TIME_SEC" \
      -D "$tmp_hdr" \
      -o "$tmp_body" \
      -w "%{http_code}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$endpoint"
  )"; then
    :
  else
    curl_rc="$?"
    http_code="curl_failed:${curl_rc}"
  fi

  response="$(cat "$tmp_body" 2>/dev/null || true)"
  rm -f "$tmp_body" "$tmp_hdr" 2>/dev/null || true

  text="$(printf '%s' "$response" | jq -r '.candidates[0].content.parts[0].text // empty' 2>/dev/null || true)"
  if [[ -n "$text" ]]; then
    if [[ "$RALPHEX_CHAT_MODE" == "1" ]]; then
      emit_chat_result "$text"
      exit 0
    fi
    jq -cn --arg text "$text" '{type:"content_block_delta",delta:{type:"text_delta",text:($text+"\n")}}'
    echo '{"type":"result","result":""}'
    exit 0
  fi

  err="$(printf '%s' "$response" | jq -c '.error // empty' 2>/dev/null || true)"
  last_http_code="$http_code"
  last_location="$location"
  if [[ -n "$err" ]]; then
    last_error="$err"
  else
    snippet="$(printf '%s' "$response" | head -c 400 | tr '\n' ' ' | tr '\r' ' ')"
    last_error="empty_or_unparsed_response: ${snippet}"
  fi
done

if [[ "$last_http_code" == curl_failed:* ]]; then
  if [[ "$RALPHEX_CHAT_MODE" == "1" ]]; then
    emit_chat_result "${CHAT_FALLBACK_ANSWER:-Связь через Ralph активна, но временно не удалось получить ответ от Vertex.}"
    exit 0
  fi
  echo "vertex transport error (${last_location}): ${last_http_code}" >&2
  exit 1
fi

if [[ "$RALPHEX_CHAT_MODE" == "1" ]]; then
  emit_chat_result "${CHAT_FALLBACK_ANSWER:-Связь через Ralph активна, но временно не удалось получить ответ от Vertex.}"
  exit 0
fi

echo "vertex error (${last_location}, http ${last_http_code}): ${last_error}" >&2
exit 1
