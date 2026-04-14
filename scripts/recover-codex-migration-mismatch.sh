#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
VSCODE_USER_DIR="${VSCODE_USER_DIR:-$HOME/.config/VSCodium/User}"
EXT_DIR_ROOT="${EXT_DIR_ROOT:-$HOME/.vscode-oss/extensions}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-$CODEX_HOME/backups/recover-migration-mismatch-$TIMESTAMP}"

usage() {
  cat <<'EOF'
Usage:
  recover-codex-migration-mismatch.sh [--apply]

Defaults to dry-run. Use --apply to modify state.

What it does:
  1) backs up Codex/VSCodium state files
  2) removes local sqlite runtime state (state_5.sqlite*, logs_2.sqlite*)
  3) clears Codex webview cache keys in VSCodium state DBs
  4) starts codex app-server offline and sends turn/interrupt for all inProgress turns
  5) writes summary JSON

Safety:
  - refuses to run while VSCodium/codex app-server is active
  - never kills any process
  - never deletes extension directories
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

if pgrep -af 'codex app-server|VSCodium|/codium' >/dev/null; then
  echo "Refusing to run while VSCodium/codex app-server is active." >&2
  pgrep -af 'codex app-server|VSCodium|/codium' || true
  exit 1
fi

mkdir -p "$BACKUP_ROOT/metadata" "$BACKUP_ROOT/files"
echo "mode=$MODE"
echo "backup_root=$BACKUP_ROOT"

for f in \
  "$CODEX_HOME/state_5.sqlite" \
  "$CODEX_HOME/state_5.sqlite-wal" \
  "$CODEX_HOME/state_5.sqlite-shm" \
  "$CODEX_HOME/logs_2.sqlite" \
  "$CODEX_HOME/logs_2.sqlite-wal" \
  "$CODEX_HOME/logs_2.sqlite-shm" \
  "$CODEX_HOME/session_index.jsonl" \
  "$VSCODE_USER_DIR/globalStorage/state.vscdb" \
  "$VSCODE_USER_DIR/globalStorage/state.vscdb.backup"
do
  if [[ -f "$f" ]]; then
    cp -a "$f" "$BACKUP_ROOT/files/"
  fi
done

if [[ -d "$VSCODE_USER_DIR/workspaceStorage" ]]; then
  find "$VSCODE_USER_DIR/workspaceStorage" -maxdepth 2 -type f -name 'state.vscdb' \
    -exec cp -a --parents {} "$BACKUP_ROOT/files/" \; || true
fi

if [[ "$MODE" != "apply" ]]; then
  echo "Dry-run only. Re-run with --apply to execute recovery."
  exit 0
fi

rm -f \
  "$CODEX_HOME/state_5.sqlite" \
  "$CODEX_HOME/state_5.sqlite-wal" \
  "$CODEX_HOME/state_5.sqlite-shm" \
  "$CODEX_HOME/logs_2.sqlite" \
  "$CODEX_HOME/logs_2.sqlite-wal" \
  "$CODEX_HOME/logs_2.sqlite-shm"

find "$CODEX_HOME/tmp" -type f -name '.lock' -delete 2>/dev/null || true

export CODEX_HOME VSCODE_USER_DIR EXT_DIR_ROOT BACKUP_ROOT

python3 - <<'PY'
import glob
import json
import os
import select
import sqlite3
import subprocess
import time
from pathlib import Path

codex_home = Path(os.environ["CODEX_HOME"]).expanduser()
vscode_user = Path(os.environ["VSCODE_USER_DIR"]).expanduser()
ext_root = Path(os.environ["EXT_DIR_ROOT"]).expanduser()
backup_root = Path(os.environ["BACKUP_ROOT"]).expanduser()

summary = {
    "codex_bin": None,
    "codex_version": None,
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

def find_codex_bin():
    bins = sorted(ext_root.glob("openai.chatgpt-*/bin/linux-x86_64/codex"))
    if not bins:
        raise SystemExit("No installed openai.chatgpt codex binary found")
    # newest by mtime of binary
    bins.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return bins[0]

summary["global_keys_deleted"] = reset_global_storage()
summary["workspace_keys_deleted"] = reset_workspace_storage()

codex_bin = find_codex_bin()
summary["codex_bin"] = str(codex_bin)
summary["codex_version"] = subprocess.check_output([str(codex_bin), "--version"], text=True).strip()

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
stderr_ring = []

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
                stderr_ring.append(line)
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
    rpc("initialize", {"clientInfo": {"name": "migration-recover", "version": "1.0.0"}})
    cursor = None
    threads = []
    while True:
        params = {"limit": 100, "archived": False}
        if cursor:
            params["cursor"] = cursor
        result = rpc("thread/list", params)
        chunk = result.get("data") or []
        threads.extend(chunk)
        cursor = result.get("nextCursor")
        if not cursor:
            break

    for t in threads:
        tid = t.get("id")
        if not tid:
            continue
        summary["threads_scanned"] += 1
        result = rpc("thread/read", {"threadId": tid, "includeTurns": True})
        thread = result.get("thread") or {}
        turns = thread.get("turns") or []
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

out = backup_root / "metadata" / "recover-summary.json"
out.write_text(json.dumps(summary, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, ensure_ascii=True, indent=2))
PY

echo "summary=$BACKUP_ROOT/metadata/recover-summary.json"
