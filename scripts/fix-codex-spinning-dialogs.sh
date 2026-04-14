#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
EXT_ID="openai.chatgpt"
PINNED_VERSION="${PINNED_VERSION:-26.5409.20454}"
PINNED_VSIX_URL="${PINNED_VSIX_URL:-https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.5409.20454/1775869840451/Microsoft.VisualStudio.Services.VSIXPackage}"
EXT_DIR_ROOT="${EXT_DIR_ROOT:-$HOME/.vscode-oss/extensions}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-$CODEX_HOME/backups/fix-spinning-dialogs-$TIMESTAMP}"

usage() {
  cat <<'EOF'
Usage:
  fix-codex-spinning-dialogs.sh [--apply]

Defaults to dry-run. Use --apply to make changes.

What it does:
  1) installs pinned Codex extension VSIX (known-good with state migration support)
  2) removes conflicting openai.chatgpt extension folders with other versions
  3) runs codex app-server (offline) and sends turn/interrupt to every inProgress turn
  4) writes JSON summary with interrupted turns

Safety:
  - refuses to run while VSCodium/codex app-server is active
  - creates backups before any write
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      MODE="apply"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if ! command -v codium >/dev/null 2>&1; then
  echo "codium binary not found in PATH" >&2
  exit 1
fi

if pgrep -af 'codex app-server|VSCodium|/codium' >/dev/null; then
  echo "Refusing to run while VSCodium/codex app-server is active." >&2
  pgrep -af 'codex app-server|VSCodium|/codium' || true
  exit 1
fi

mkdir -p "$BACKUP_ROOT/metadata" "$BACKUP_ROOT/files"
echo "mode=$MODE"
echo "backup_root=$BACKUP_ROOT"

for f in \
  "$HOME/.vscode-oss/extensions/extensions.json" \
  "$HOME/.config/VSCodium/User/globalStorage/state.vscdb" \
  "$HOME/.config/VSCodium/User/globalStorage/state.vscdb.backup" \
  "$CODEX_HOME/state_5.sqlite" \
  "$CODEX_HOME/state_5.sqlite-wal" \
  "$CODEX_HOME/state_5.sqlite-shm" \
  "$CODEX_HOME/logs_2.sqlite" \
  "$CODEX_HOME/logs_2.sqlite-wal" \
  "$CODEX_HOME/logs_2.sqlite-shm" \
  "$CODEX_HOME/session_index.jsonl"
do
  if [[ -f "$f" ]]; then
    cp -a "$f" "$BACKUP_ROOT/files/"
  fi
done

find "$EXT_DIR_ROOT" -maxdepth 1 -type d -name 'openai.chatgpt-*' -exec cp -a {} "$BACKUP_ROOT/files/" \; 2>/dev/null || true

if [[ "$MODE" != "apply" ]]; then
  echo "Dry-run only. Re-run with --apply to execute fixes."
  exit 0
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
VSIX_PATH="$TMPDIR/openai.chatgpt-${PINNED_VERSION}.vsix"

echo "Downloading pinned VSIX..."
curl -fL "$PINNED_VSIX_URL" -o "$VSIX_PATH"

echo "Installing pinned extension..."
codium --install-extension "$VSIX_PATH" --force

# Remove conflicting versions to avoid loading older binaries.
echo "Removing conflicting extension folders..."
while IFS= read -r d; do
  bn="$(basename "$d")"
  case "$bn" in
    "openai.chatgpt-${PINNED_VERSION}"* )
      ;;
    *)
      rm -rf "$d"
      ;;
  esac
done < <(find "$EXT_DIR_ROOT" -maxdepth 1 -type d -name 'openai.chatgpt-*' | sort)

echo "Extension versions after install:"
codium --list-extensions --show-versions | grep -E '^openai\.chatgpt@' || true

export PINNED_VERSION EXT_DIR_ROOT BACKUP_ROOT

python3 - <<'PY'
import glob
import json
import os
import select
import subprocess
import sys
import time
from pathlib import Path

pinned = os.environ["PINNED_VERSION"]
ext_root = Path(os.environ["EXT_DIR_ROOT"]).expanduser()
backup_root = Path(os.environ["BACKUP_ROOT"]).expanduser()

matches = sorted(ext_root.glob(f"openai.chatgpt-{pinned}*"))
if not matches:
    raise SystemExit(f"Installed extension folder not found for version {pinned}")

ext_dir = matches[0]
codex_bin = ext_dir / "bin" / "linux-x86_64" / "codex"
if not codex_bin.exists():
    raise SystemExit(f"codex binary not found: {codex_bin}")

summary = {
    "extension_dir": str(ext_dir),
    "codex_bin": str(codex_bin),
    "codex_version": None,
    "threads_scanned": 0,
    "inprogress_turns_found": 0,
    "interrupts_sent": 0,
    "interrupt_failures": [],
    "inprogress_turns": [],
}

summary["codex_version"] = subprocess.check_output([str(codex_bin), "--version"], text=True).strip()

proc = subprocess.Popen(
    [str(codex_bin), "app-server"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    bufsize=1,
)

next_id = 1

def rpc(method, params, timeout=8):
    global next_id
    req_id = str(next_id)
    next_id += 1
    req = {"id": req_id, "method": method, "params": params}
    proc.stdin.write(json.dumps(req, ensure_ascii=True) + "\n")
    proc.stdin.flush()

    deadline = time.time() + timeout
    stderr_lines = []
    while time.time() < deadline:
        ready, _, _ = select.select([proc.stdout, proc.stderr], [], [], 0.2)
        for s in ready:
            line = s.readline()
            if not line:
                continue
            line = line.rstrip("\n")
            if s is proc.stderr:
                stderr_lines.append(line)
                continue
            try:
                msg = json.loads(line)
            except Exception:
                continue
            if msg.get("id") != req_id:
                continue
            if "error" in msg:
                raise RuntimeError(f"{method} error: {msg['error']}")
            return msg.get("result", {}), stderr_lines
    raise TimeoutError(f"{method} timed out")

try:
    rpc("initialize", {"clientInfo": {"name": "offline-turn-interrupt", "version": "1.0.0"}})

    # Page through threads.
    cursor = None
    threads = []
    while True:
        params = {"limit": 100, "archived": False}
        if cursor is not None:
            params["cursor"] = cursor
        result, _ = rpc("thread/list", params)
        data = result.get("data") or []
        threads.extend(data)
        cursor = result.get("nextCursor")
        if not cursor:
            break

    for t in threads:
        tid = t.get("id")
        if not tid:
            continue
        summary["threads_scanned"] += 1
        read_result, _ = rpc("thread/read", {"threadId": tid, "includeTurns": True})
        thread = read_result.get("thread") or {}
        turns = thread.get("turns") or []
        for turn in turns:
            if turn.get("status") == "inProgress":
                turn_id = turn.get("id")
                if not turn_id:
                    continue
                summary["inprogress_turns_found"] += 1
                summary["inprogress_turns"].append({"threadId": tid, "turnId": turn_id})
                try:
                    rpc("turn/interrupt", {"threadId": tid, "turnId": turn_id})
                    summary["interrupts_sent"] += 1
                except Exception as exc:
                    summary["interrupt_failures"].append(
                        {"threadId": tid, "turnId": turn_id, "error": str(exc)}
                    )
finally:
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except Exception:
        proc.kill()

out = backup_root / "metadata" / "interrupt-summary.json"
out.write_text(json.dumps(summary, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, ensure_ascii=True, indent=2))
PY

echo "summary=$BACKUP_ROOT/metadata/interrupt-summary.json"
