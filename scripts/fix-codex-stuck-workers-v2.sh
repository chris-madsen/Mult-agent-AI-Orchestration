#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
EXT_ID="openai.chatgpt"
PINNED_VERSION="${PINNED_VERSION:-26.5409.20454}"
PINNED_VSIX_URL="${PINNED_VSIX_URL:-https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.5409.20454/1775869840451/Microsoft.VisualStudio.Services.VSIXPackage}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
EXT_DIR_ROOT="${EXT_DIR_ROOT:-$HOME/.vscode-oss/extensions}"
VSCODE_USER_DIR="${VSCODE_USER_DIR:-$HOME/.config/VSCodium/User}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-$CODEX_HOME/backups/fix-codex-stuck-workers-v2-$TIMESTAMP}"

usage() {
  cat <<'EOF'
Usage:
  fix-codex-stuck-workers-v2.sh [--apply]

Defaults to dry-run. Use --apply to perform changes.

What it does:
  1) backup Codex + VSCodium state
  2) hard-reset openai.chatgpt extension registration and reinstall pinned VSIX
  3) remove local Codex runtime sqlite state (state_5.sqlite*, logs_2.sqlite*)
  4) clear Codex webview cache keys in VSCodium state DBs
  5) run codex app-server offline and send turn/interrupt to all inProgress turns
  6) write recovery summary JSON

Safety:
  - refuses to run while VSCodium/codex app-server is active
  - never kills any process
  - backups are created before any write
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
echo "pinned_version=$PINNED_VERSION"

for f in \
  "$CODEX_HOME/state_5.sqlite" \
  "$CODEX_HOME/state_5.sqlite-wal" \
  "$CODEX_HOME/state_5.sqlite-shm" \
  "$CODEX_HOME/logs_2.sqlite" \
  "$CODEX_HOME/logs_2.sqlite-wal" \
  "$CODEX_HOME/logs_2.sqlite-shm" \
  "$CODEX_HOME/session_index.jsonl" \
  "$EXT_DIR_ROOT/extensions.json" \
  "$EXT_DIR_ROOT/.obsolete" \
  "$VSCODE_USER_DIR/globalStorage/state.vscdb" \
  "$VSCODE_USER_DIR/globalStorage/state.vscdb.backup"
do
  if [[ -f "$f" ]]; then
    cp -a "$f" "$BACKUP_ROOT/files/"
  fi
done

find "$EXT_DIR_ROOT" -maxdepth 1 -type d -name 'openai.chatgpt-*' \
  -exec cp -a {} "$BACKUP_ROOT/files/" \; 2>/dev/null || true

if [[ -d "$VSCODE_USER_DIR/workspaceStorage" ]]; then
  find "$VSCODE_USER_DIR/workspaceStorage" -maxdepth 2 -type f -name 'state.vscdb' \
    -exec cp -a --parents {} "$BACKUP_ROOT/files/" \; || true
fi

if [[ "$MODE" != "apply" ]]; then
  echo "Dry-run only. Re-run with --apply to execute recovery."
  exit 0
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
VSIX_PATH="$TMPDIR/openai.chatgpt-${PINNED_VERSION}.vsix"

echo "Downloading pinned VSIX..."
curl -fL "$PINNED_VSIX_URL" -o "$VSIX_PATH"

echo "Uninstalling extension entry (if present)..."
codium --uninstall-extension "$EXT_ID" >/dev/null 2>&1 || true

echo "Cleaning extension registration files for $EXT_ID..."
export EXT_DIR_ROOT EXT_ID
python3 - <<'PY'
import json
import os
from pathlib import Path

ext_id = os.environ["EXT_ID"]
ext_dir_root = Path(os.environ["EXT_DIR_ROOT"]).expanduser()

extensions_json = ext_dir_root / "extensions.json"
if extensions_json.exists():
    data = json.loads(extensions_json.read_text(encoding="utf-8"))
    if isinstance(data, list):
        filtered = []
        for item in data:
            ident = ((item or {}).get("identifier") or {}).get("id", "")
            if ident.lower() == ext_id:
                continue
            filtered.append(item)
        data = filtered
    extensions_json.write_text(
        json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
    )

obsolete = ext_dir_root / ".obsolete"
if obsolete.exists():
    data = json.loads(obsolete.read_text(encoding="utf-8") or "{}")
    if isinstance(data, dict):
        cleaned = {}
        for k, v in data.items():
            if str(k).lower().startswith(ext_id):
                continue
            cleaned[k] = v
        data = cleaned
    obsolete.write_text(json.dumps(data, ensure_ascii=True) + "\n", encoding="utf-8")
PY

echo "Removing extension folders..."
find "$EXT_DIR_ROOT" -maxdepth 1 -type d -name 'openai.chatgpt-*' -exec rm -rf {} +

echo "Installing pinned VSIX..."
codium --install-extension "$VSIX_PATH" --force

echo "Installed extension versions:"
codium --list-extensions --show-versions | grep -E '^openai\.chatgpt@' || true
if ! codium --list-extensions --show-versions | grep -Eq "^${EXT_ID}@${PINNED_VERSION}$"; then
  echo "Pinned version was not installed as active extension: expected ${EXT_ID}@${PINNED_VERSION}" >&2
  exit 1
fi

echo "Resetting runtime sqlite state..."
rm -f \
  "$CODEX_HOME/state_5.sqlite" \
  "$CODEX_HOME/state_5.sqlite-wal" \
  "$CODEX_HOME/state_5.sqlite-shm" \
  "$CODEX_HOME/logs_2.sqlite" \
  "$CODEX_HOME/logs_2.sqlite-wal" \
  "$CODEX_HOME/logs_2.sqlite-shm"

find "$CODEX_HOME/tmp" -type f -name '.lock' -delete 2>/dev/null || true

export CODEX_HOME VSCODE_USER_DIR PINNED_VERSION BACKUP_ROOT EXT_DIR_ROOT
python3 - <<'PY'
import json
import os
import select
import sqlite3
import subprocess
import time
from pathlib import Path

codex_home = Path(os.environ["CODEX_HOME"]).expanduser()
vscode_user = Path(os.environ["VSCODE_USER_DIR"]).expanduser()
backup_root = Path(os.environ["BACKUP_ROOT"]).expanduser()
pinned_version = os.environ["PINNED_VERSION"]
ext_dir_root = Path(os.environ["EXT_DIR_ROOT"]).expanduser()

ext_dir = None
for p in sorted(ext_dir_root.glob("openai.chatgpt-*")):
    name = p.name
    if pinned_version in name:
        ext_dir = p
        break
if ext_dir is None:
    raise SystemExit(f"pinned extension directory not found for version {pinned_version}")

codex_bin = ext_dir / "bin" / "linux-x86_64" / "codex"
if not codex_bin.exists():
    raise SystemExit(f"codex binary not found: {codex_bin}")

summary = {
    "extension_dir": str(ext_dir),
    "codex_bin": str(codex_bin),
    "codex_version": subprocess.check_output([str(codex_bin), "--version"], text=True).strip(),
    "global_keys_deleted": 0,
    "workspace_keys_deleted": 0,
    "threads_scanned": 0,
    "inprogress_turns_found": 0,
    "interrupts_sent": 0,
    "interrupt_failures": [],
    "stderr_migration_mismatch_lines": [],
}

def reset_global_storage():
    db = vscode_user / "globalStorage" / "state.vscdb"
    if not db.exists():
        return 0
    con = sqlite3.connect(str(db))
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ItemTable'")
    if cur.fetchone() is None:
        con.close()
        return 0
    deleted = cur.execute(
        """
        DELETE FROM ItemTable
        WHERE key='openai.chatgpt'
           OR key LIKE 'workbench.view.extension.codex%'
           OR key LIKE 'memento/webviewView.chatgpt.%'
           OR key LIKE 'chatgpt.sidebar%'
        """
    ).rowcount
    con.commit()
    con.close()
    return int(deleted)

def reset_workspace_storage():
    deleted = 0
    for db in (vscode_user / "workspaceStorage").glob("*/state.vscdb"):
        con = sqlite3.connect(str(db))
        cur = con.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ItemTable'")
        if cur.fetchone() is None:
            con.close()
            continue
        deleted += cur.execute(
            """
            DELETE FROM ItemTable
            WHERE key LIKE 'workbench.view.extension.codex%'
               OR key LIKE 'memento/webviewView.chatgpt.%'
               OR key LIKE 'chatgpt.sidebar%'
               OR key LIKE 'workbench.views.service.sidebar.%'
            """
        ).rowcount
        con.commit()
        con.close()
    return int(deleted)

summary["global_keys_deleted"] = reset_global_storage()
summary["workspace_keys_deleted"] = reset_workspace_storage()

proc = subprocess.Popen(
    [str(codex_bin), "app-server"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    bufsize=1,
    env={**os.environ, "CODEX_HOME": str(codex_home)},
)

next_id = 1

def rpc(method, params, timeout=10):
    global next_id
    req_id = str(next_id)
    next_id += 1
    req = {"id": req_id, "method": method, "params": params}
    proc.stdin.write(json.dumps(req, ensure_ascii=True) + "\n")
    proc.stdin.flush()

    deadline = time.time() + timeout
    while time.time() < deadline:
        ready, _, _ = select.select([proc.stdout, proc.stderr], [], [], 0.2)
        for s in ready:
            line = s.readline()
            if not line:
                continue
            line = line.rstrip("\n")
            if s is proc.stderr:
                if "migration" in line and "state db" in line:
                    summary["stderr_migration_mismatch_lines"].append(line)
                continue
            try:
                msg = json.loads(line)
            except Exception:
                continue
            if msg.get("id") != req_id:
                continue
            if "error" in msg:
                raise RuntimeError(f"{method} error: {msg['error']}")
            return msg.get("result", {})
    raise TimeoutError(f"{method} timed out")

try:
    rpc("initialize", {"clientInfo": {"name": "stuck-workers-recovery", "version": "2.0.0"}})
    cursor = None
    threads = []
    while True:
        params = {"limit": 100, "archived": False}
        if cursor:
            params["cursor"] = cursor
        result = rpc("thread/list", params)
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
        result = rpc("thread/read", {"threadId": tid, "includeTurns": True})
        turns = ((result.get("thread") or {}).get("turns") or [])
        for turn in turns:
            if turn.get("status") != "inProgress":
                continue
            turn_id = turn.get("id")
            if not turn_id:
                continue
            summary["inprogress_turns_found"] += 1
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

out = backup_root / "metadata" / "fix-summary.json"
out.write_text(json.dumps(summary, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, ensure_ascii=True, indent=2))
PY

echo "summary=$BACKUP_ROOT/metadata/fix-summary.json"
