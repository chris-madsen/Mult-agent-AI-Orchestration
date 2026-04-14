#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
VSCODE_USER_DIR="${VSCODE_USER_DIR:-$HOME/.config/VSCodium/User}"
EXT_DIR_ROOT="${EXT_DIR_ROOT:-$HOME/.vscode-oss/extensions}"
CODEX_BIN_OVERRIDE="${CODEX_BIN_OVERRIDE:-}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-$CODEX_HOME/backups/fix-codex-stuck-workers-safe-$TIMESTAMP}"

usage() {
  cat <<'EOF'
Usage:
  fix-codex-stuck-workers-safe.sh [--apply] [--codex-bin /path/to/codex]

Defaults to dry-run. Use --apply to execute.

Safe mode:
  - does NOT install/uninstall/update Codex extension
  - does NOT remove extension folders

What it does:
  1) backup Codex/VSCodium state
  2) remove runtime sqlite files (state_5.sqlite*, logs_2.sqlite*)
  3) clear Codex webview cache keys in VSCodium state DBs
  4) run currently installed codex app-server and send turn/interrupt to inProgress turns
  5) write summary JSON
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      MODE="apply"
      shift
      ;;
    --codex-bin)
      if [[ $# -lt 2 ]]; then
        echo "--codex-bin requires a path argument" >&2
        exit 2
      fi
      CODEX_BIN_OVERRIDE="$2"
      shift 2
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

CODEx_BIN=""

if [[ -n "$CODEX_BIN_OVERRIDE" ]]; then
  if [[ ! -x "$CODEX_BIN_OVERRIDE" ]]; then
    echo "codex binary is not executable: $CODEX_BIN_OVERRIDE" >&2
    exit 1
  fi
  CODEx_BIN="$CODEX_BIN_OVERRIDE"
fi

if [[ -z "$CODEx_BIN" ]]; then
while IFS= read -r p; do
  if [[ -x "$p/bin/linux-x86_64/codex" ]]; then
    CODEx_BIN="$p/bin/linux-x86_64/codex"
    break
  fi
done < <(find "$EXT_DIR_ROOT" -maxdepth 1 -type d -name 'openai.chatgpt-*' -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
fi

if [[ -z "$CODEx_BIN" ]]; then
  echo "No installed Codex binary found under $EXT_DIR_ROOT/openai.chatgpt-*/bin/linux-x86_64/codex" >&2
  exit 1
fi

mkdir -p "$BACKUP_ROOT/metadata" "$BACKUP_ROOT/files"
echo "mode=$MODE"
echo "backup_root=$BACKUP_ROOT"
echo "codex_bin=$CODEx_BIN"
echo "codex_version=$("$CODEx_BIN" --version 2>/dev/null || echo unknown)"

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

export CODEX_HOME VSCODE_USER_DIR BACKUP_ROOT CODEx_BIN
python3 - <<'PY'
import json
import os
import select
import sqlite3
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

codex_home = Path(os.environ["CODEX_HOME"]).expanduser()
vscode_user = Path(os.environ["VSCODE_USER_DIR"]).expanduser()
backup_root = Path(os.environ["BACKUP_ROOT"]).expanduser()
codex_bin = Path(os.environ["CODEx_BIN"]).expanduser()

summary = {
    "codex_bin": str(codex_bin),
    "codex_version": subprocess.check_output([str(codex_bin), "--version"], text=True).strip(),
    "global_keys_deleted": 0,
    "workspace_keys_deleted": 0,
    "threads_scanned": 0,
    "inprogress_turns_found": 0,
    "interrupts_sent": 0,
    "offline_aborts_appended": 0,
    "offline_abort_failures": [],
    "interrupt_failures": [],
    "stderr_migration_mismatch_lines": [],
}

def find_rollout_file(thread_id: str) -> Path | None:
    candidates = []
    for root in (codex_home / "sessions", codex_home / "archived_sessions"):
        if not root.exists():
            continue
        for p in root.rglob(f"rollout-*-{thread_id}.jsonl"):
            if p.is_file():
                candidates.append(p)
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]

def has_terminal_event(path: Path, turn_id: str) -> bool:
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except Exception:
                    continue
                if msg.get("type") != "event_msg":
                    continue
                payload = msg.get("payload") or {}
                if payload.get("turn_id") != turn_id:
                    continue
                if payload.get("type") in ("task_complete", "turn_aborted"):
                    return True
    except Exception:
        return False
    return False

def append_offline_turn_aborted(path: Path, turn_id: str) -> None:
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "type": "event_msg",
        "payload": {
            "type": "turn_aborted",
            "turn_id": turn_id,
            "reason": "offline_repair_open_turn",
        },
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=True) + "\n")

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
           OR key='memento/webviewViews.origins'
           OR key='memento/mainThreadWebviewPanel.origins'
           OR key='views.customizations'
           OR key='editorOverrideService.cache'
           OR key LIKE 'workbench.view.extension.codex%'
           OR key LIKE 'workbench.views.service.sidebar.%'
           OR key LIKE 'memento/webviewView.chatgpt.%'
           OR key LIKE 'chatgpt.sidebar%'
           OR key LIKE 'workbench.auxiliarybar.%'
           OR lower(value) LIKE '%openai-codex:%'
           OR lower(value) LIKE '%chatgpt.sidebarview%'
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
               OR key LIKE 'workbench.views.service.sidebar.%'
               OR key LIKE 'memento/webviewView.chatgpt.%'
               OR key LIKE 'chatgpt.sidebar%'
               OR key='memento/workbench.parts.editor'
               OR key='history.entries'
               OR key='memento/customEditors'
               OR lower(value) LIKE '%openai-codex:%'
               OR lower(value) LIKE '%chatgpt.conversationeditor%'
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
    rpc("initialize", {"clientInfo": {"name": "stuck-workers-safe-recover", "version": "1.0.0"}})
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
                error_text = str(exc)
                summary["interrupt_failures"].append(
                    {"threadId": tid, "turnId": turn_id, "error": error_text}
                )
                if "thread not found" in error_text:
                    rollout = find_rollout_file(tid)
                    if rollout is None:
                        summary["offline_abort_failures"].append(
                            {
                                "threadId": tid,
                                "turnId": turn_id,
                                "error": "rollout file not found",
                            }
                        )
                        continue
                    if has_terminal_event(rollout, turn_id):
                        continue
                    try:
                        append_offline_turn_aborted(rollout, turn_id)
                        summary["offline_aborts_appended"] += 1
                    except Exception as e:
                        summary["offline_abort_failures"].append(
                            {
                                "threadId": tid,
                                "turnId": turn_id,
                                "error": f"append failed: {e}",
                                "rollout": str(rollout),
                            }
                        )
finally:
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except Exception:
        proc.kill()

out = backup_root / "metadata" / "safe-fix-summary.json"
out.write_text(json.dumps(summary, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, ensure_ascii=True, indent=2))
PY

echo "summary=$BACKUP_ROOT/metadata/safe-fix-summary.json"
