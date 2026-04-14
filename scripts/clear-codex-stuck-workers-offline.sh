#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
VSCODE_USER_DIR="${VSCODE_USER_DIR:-$HOME/.config/VSCodium/User}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-$CODEX_HOME/backups/codex-worker-reset-$TIMESTAMP}"

usage() {
  cat <<'EOF'
Usage:
  clear-codex-stuck-workers-offline.sh [--apply]

Defaults to dry-run. Use --apply to modify files.

What it does:
  1) closes all unfinished turns in rollout jsonl files (appends turn_aborted)
  2) resets Codex/ChatGPT webview state keys in VSCodium workspaceStorage DBs
  3) writes a summary json in backup metadata

Safety:
  - refuses to run if VSCodium/codex app-server is active
  - creates backups before modifications
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
  "$CODEX_HOME/session_index.jsonl"
do
  if [[ -f "$f" ]]; then
    cp -a "$f" "$BACKUP_ROOT/files/"
  fi
done

if [[ -d "$VSCODE_USER_DIR/workspaceStorage" ]]; then
  find "$VSCODE_USER_DIR/workspaceStorage" -maxdepth 2 -type f -name 'state.vscdb*' \
    -exec cp -a --parents {} "$BACKUP_ROOT/files" \; || true
fi

export MODE CODEX_HOME VSCODE_USER_DIR BACKUP_ROOT

python3 - <<'PY'
import glob
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

mode = os.environ["MODE"]
apply_changes = mode == "apply"
codex_home = Path(os.environ["CODEX_HOME"]).expanduser()
vscode_user = Path(os.environ["VSCODE_USER_DIR"]).expanduser()
backup_root = Path(os.environ["BACKUP_ROOT"]).expanduser()

summary = {
    "mode": mode,
    "open_turns_before": 0,
    "open_turns_closed": 0,
    "open_turns_after": 0,
    "rollouts_touched": [],
    "workspace_db_touched": [],
    "workspace_keys_deleted": 0,
    "errors": [],
}

def iter_rollouts():
    for root in [codex_home / "sessions", codex_home / "archived_sessions"]:
        if not root.exists():
            continue
        for p in glob.glob(str(root / "**" / "rollout-*.jsonl"), recursive=True):
            yield Path(p)

def get_event_and_turn(rec):
    et = None
    tid = None
    if rec.get("type") == "event_msg" and isinstance(rec.get("payload"), dict):
        pl = rec["payload"]
        et = pl.get("type")
        tid = pl.get("turn_id")
    else:
        et = rec.get("type")
        turn = rec.get("turn")
        if isinstance(turn, dict):
            tid = turn.get("id")
        tid = tid or rec.get("turn_id")
    return et, tid

def open_turns(path: Path):
    started = {}
    ended = set()
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        for line_no, line in enumerate(f, start=1):
            s = line.strip()
            if not s:
                continue
            try:
                rec = json.loads(s)
            except Exception:
                continue
            et, tid = get_event_and_turn(rec)
            if not et or not tid:
                continue
            if et in {"task_started", "turn_started"}:
                started[tid] = line_no
            elif et in {
                "task_complete",
                "turn_aborted",
                "turn_completed_successfully",
                "turn_errored",
                "turn_cancelled",
            }:
                ended.add(tid)
    return [t for t in started if t not in ended]

def append_turn_aborted(path: Path, turn_id: str):
    ev = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "type": "event_msg",
        "payload": {
            "type": "turn_aborted",
            "turn_id": turn_id,
            "reason": "offline_worker_reset",
        },
    }
    with path.open("ab+") as f:
        f.seek(0, os.SEEK_END)
        if f.tell() > 0:
            f.seek(-1, os.SEEK_END)
            if f.read(1) != b"\n":
                f.write(b"\n")
        f.write((json.dumps(ev, ensure_ascii=True) + "\n").encode("utf-8"))

for rp in iter_rollouts():
    try:
        ot = open_turns(rp)
    except Exception as e:
        summary["errors"].append(f"rollout_read_failed {rp}: {e}")
        continue
    if not ot:
        continue
    summary["open_turns_before"] += len(ot)
    if apply_changes:
        try:
            for tid in ot:
                append_turn_aborted(rp, tid)
            summary["open_turns_closed"] += len(ot)
            summary["rollouts_touched"].append(str(rp))
        except Exception as e:
            summary["errors"].append(f"rollout_write_failed {rp}: {e}")

# Recount after
for rp in iter_rollouts():
    try:
        summary["open_turns_after"] += len(open_turns(rp))
    except Exception:
        pass

workspace_dbs = list((vscode_user / "workspaceStorage").glob("*/state.vscdb"))
for db in workspace_dbs:
    try:
        con = sqlite3.connect(str(db))
        cur = con.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ItemTable'")
        if cur.fetchone() is None:
            con.close()
            continue
        # Reset only Codex/ChatGPT UI cache keys.
        keys = cur.execute(
            """
            SELECT key FROM ItemTable
            WHERE key LIKE 'memento/webviewView.chatgpt.%'
               OR key LIKE 'workbench.view.extension.codex%'
               OR key LIKE 'chatgpt.sidebar%'
            """
        ).fetchall()
        if not keys:
            con.close()
            continue
        if apply_changes:
            n = cur.execute(
                """
                DELETE FROM ItemTable
                WHERE key LIKE 'memento/webviewView.chatgpt.%'
                   OR key LIKE 'workbench.view.extension.codex%'
                   OR key LIKE 'chatgpt.sidebar%'
                """
            ).rowcount
            con.commit()
            summary["workspace_keys_deleted"] += int(n)
            summary["workspace_db_touched"].append(str(db))
        else:
            summary["workspace_keys_deleted"] += len(keys)
            summary["workspace_db_touched"].append(str(db))
        con.close()
    except Exception as e:
        summary["errors"].append(f"workspace_db_failed {db}: {e}")

out = backup_root / "metadata" / "clear-workers-summary.json"
out.write_text(json.dumps(summary, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, ensure_ascii=True, indent=2))
PY

echo "summary=$BACKUP_ROOT/metadata/clear-workers-summary.json"
