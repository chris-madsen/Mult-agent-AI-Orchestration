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

: "${CONSILIUM_API_KEY:?CONSILIUM_API_KEY must be set in .env}"

HOST="${CONSILIUM_SMOKE_HOST:-127.0.0.1}"
PORT="${CONSILIUM_SMOKE_PORT:-8000}"
MODEL="${CONSILIUM_PUBLIC_MODEL:-consilium-auto}"
PROMPT="${1:-Name the current working directory and 3 project files. Keep it short.}"

curl -fsS "http://${HOST}:${PORT}/healthz" >/dev/null

payload="$(
  python3 - "$MODEL" "$PROMPT" <<'PY'
import json
import sys

model = sys.argv[1]
prompt = sys.argv[2]
print(json.dumps({"model": model, "input": prompt}, ensure_ascii=False))
PY
)"

resp_file="$(mktemp)"
trap 'rm -f "$resp_file"' EXIT

curl -fsS \
  -H "Authorization: Bearer ${CONSILIUM_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "http://${HOST}:${PORT}/v1/responses" >"$resp_file"

python3 - "$resp_file" <<'PY'
import json
import sys

resp_path = sys.argv[1]
with open(resp_path, "r", encoding="utf-8") as f:
    data = json.load(f)

text = (data.get("output_text") or "").strip()
if not text:
    print("[fail] gateway returned empty output_text", file=sys.stderr)
    sys.exit(2)

bad_markers = (
    "ralphex stalled:",
    "не вернул `final answer`",
    "did not return `final answer`",
    "вернул только технический лог",
    "вернул технический лог без пользовательского ответа",
    "ошибка выполнения через ralphex:",
    "ralphex command failed:",
    "context canceled",
)

normalized = text.lower()
if any(marker in normalized for marker in bad_markers):
    print("[fail] unstable gateway response marker detected", file=sys.stderr)
    print(text, file=sys.stderr)
    sys.exit(3)

print("[ok] gateway chat runtime smoke passed")
print(text)
PY
