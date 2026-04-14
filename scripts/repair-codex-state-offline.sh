#!/usr/bin/env bash
set -euo pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
STATE_DB="${STATE_DB:-$CODEX_HOME/state_5.sqlite}"
KEEP_LOG_ROWS="${KEEP_LOG_ROWS:-180000}"
KEEP_LOG_DAYS="${KEEP_LOG_DAYS:-10}"
KEEP_THREADLESS_TRACE_ROWS="${KEEP_THREADLESS_TRACE_ROWS:-40000}"
KEEP_THREADLESS_TRACE_DAYS="${KEEP_THREADLESS_TRACE_DAYS:-2}"
STALE_THREAD_HOURS="${STALE_THREAD_HOURS:-6}"
CLOSE_OPEN_TURNS_MODE="${CLOSE_OPEN_TURNS_MODE:-all}"
VACUUM_MIN_MB="${VACUUM_MIN_MB:-128}"
MODE="dry-run"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-$CODEX_HOME/backups/state-offline-repair-$TIMESTAMP}"

log() {
  printf '[repair-codex-state-offline] %s\n' "$*"
}

usage() {
  cat <<'EOF'
Usage:
  repair-codex-state-offline.sh [--apply] [--stale-open-turns-only]

Defaults to dry-run (no writes). Use --apply to modify files.

Safety behavior:
  - Refuses to run if VSCodium/codex app-server is still running.
  - Never sends SIGTERM/SIGKILL to codex app-server.

Environment overrides:
  CODEX_HOME                   default: ~/.codex
  STATE_DB                     default: ~/.codex/state_5.sqlite
  KEEP_LOG_ROWS                default: 180000
  KEEP_LOG_DAYS                default: 10
  KEEP_THREADLESS_TRACE_ROWS   default: 40000
  KEEP_THREADLESS_TRACE_DAYS   default: 2
  STALE_THREAD_HOURS           default: 6
  CLOSE_OPEN_TURNS_MODE        default: all (all|stale)
  VACUUM_MIN_MB                default: 128
  BACKUP_ROOT                  default: ~/.codex/backups/state-offline-repair-<timestamp>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      MODE="apply"
      shift
      ;;
    --stale-open-turns-only)
      CLOSE_OPEN_TURNS_MODE="stale"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ ! -f "$STATE_DB" ]]; then
  echo "state db not found: $STATE_DB" >&2
  exit 1
fi

if pgrep -af 'codex app-server|VSCodium|/codium' >/dev/null; then
  echo "Refusing to run while VSCodium/codex app-server is active." >&2
  echo "Close VS-Codium completely and run again." >&2
  pgrep -af 'codex app-server|VSCodium|/codium' || true
  exit 1
fi

mkdir -p "$BACKUP_ROOT/metadata" "$BACKUP_ROOT/logs"
log "mode: $MODE"
log "backup root: $BACKUP_ROOT"

ps -eo pid,ppid,lstart,etime,stat,command > "$BACKUP_ROOT/metadata/ps.txt" || true
pgrep -af 'codex app-server|VSCodium|/codium' > "$BACKUP_ROOT/metadata/processes-before.txt" || true

for path in "$STATE_DB" "$STATE_DB-wal" "$STATE_DB-shm" "$CODEX_HOME/session_index.jsonl"; do
  if [[ -e "$path" ]]; then
    cp -a "$path" "$BACKUP_ROOT/"
  fi
done

if [[ -d "$HOME/.local/state/VSCodium" ]]; then
  find "$HOME/.local/state/VSCodium" -type f \
    \( -name 'Codex.log' -o -name 'exthost.log' \) \
    -exec cp -a --parents {} "$BACKUP_ROOT/logs" \; || true
fi

if [[ "$MODE" == "apply" ]]; then
  find "$CODEX_HOME/tmp" -type f -name '.lock' -print -delete > "$BACKUP_ROOT/metadata/deleted-lockfiles.txt" 2>/dev/null || true
else
  find "$CODEX_HOME/tmp" -type f -name '.lock' -print > "$BACKUP_ROOT/metadata/deleted-lockfiles.txt" 2>/dev/null || true
fi

export CODEX_HOME STATE_DB BACKUP_ROOT KEEP_LOG_ROWS KEEP_LOG_DAYS
export KEEP_THREADLESS_TRACE_ROWS KEEP_THREADLESS_TRACE_DAYS STALE_THREAD_HOURS
export CLOSE_OPEN_TURNS_MODE VACUUM_MIN_MB MODE

python3 - <<'PY'
import json
import os
import re
import shutil
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

code_home = Path(os.environ["CODEX_HOME"]).expanduser()
state_db = Path(os.environ["STATE_DB"]).expanduser()
backup_root = Path(os.environ["BACKUP_ROOT"]).expanduser()
keep_log_rows = int(os.environ["KEEP_LOG_ROWS"])
keep_log_days = int(os.environ["KEEP_LOG_DAYS"])
keep_threadless_trace_rows = int(os.environ["KEEP_THREADLESS_TRACE_ROWS"])
keep_threadless_trace_days = int(os.environ["KEEP_THREADLESS_TRACE_DAYS"])
stale_thread_hours = int(os.environ["STALE_THREAD_HOURS"])
close_open_turns_mode = os.environ.get("CLOSE_OPEN_TURNS_MODE", "all").strip().lower()
vacuum_min_mb = int(os.environ["VACUUM_MIN_MB"])
apply_changes = os.environ["MODE"] == "apply"
now = int(time.time())

if close_open_turns_mode not in {"all", "stale"}:
    raise SystemExit("CLOSE_OPEN_TURNS_MODE must be one of: all, stale")

summary = {
    "mode": "apply" if apply_changes else "dry-run",
    "state_db": str(state_db),
    "backup_root": str(backup_root),
    "keep_log_rows": keep_log_rows,
    "keep_log_days": keep_log_days,
    "keep_threadless_trace_rows": keep_threadless_trace_rows,
    "keep_threadless_trace_days": keep_threadless_trace_days,
    "stale_thread_hours": stale_thread_hours,
    "close_open_turns_mode": close_open_turns_mode,
}

conn = sqlite3.connect(str(state_db), timeout=60)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute("PRAGMA busy_timeout = 60000")
cur.execute("PRAGMA foreign_keys = ON")

summary["quick_check_before"] = cur.execute("PRAGMA quick_check").fetchone()[0]

def codex_log_paths() -> list[Path]:
    root = Path.home() / ".local" / "state" / "VSCodium"
    if not root.is_dir():
        return []
    out: list[Path] = []
    for p in sorted(root.glob("*/window*/exthost/openai.chatgpt/Codex.log")):
        out.append(p)
    return out

def stale_thread_ids_from_logs() -> set[str]:
    ids: set[str] = set()
    p_running = re.compile(r"thread/resume overrides ignored for running thread ([0-9a-f-]+)")
    p_resume = re.compile(r"maybe_resume_success conversationId=([0-9a-f-]+).*latestTurnStatus=inProgress")
    p_rollout = re.compile(r"rollout-[0-9T-]+-([0-9a-f-]{36})\.jsonl")
    for path in codex_log_paths():
        with path.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                m = p_running.search(line)
                if m:
                    ids.add(m.group(1))
                m = p_resume.search(line)
                if m:
                    ids.add(m.group(1))
                if "database is locked" in line:
                    m = p_rollout.search(line)
                    if m:
                        ids.add(m.group(1))
    return ids

def open_turns_in_rollout(path: Path) -> list[dict]:
    open_turns: dict[str, dict] = {}
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        for line_no, line in enumerate(f, start=1):
            s = line.strip()
            if not s:
                continue
            try:
                rec = json.loads(s)
            except Exception:
                continue
            payload = rec.get("payload") if isinstance(rec, dict) else None
            et = None
            tid = None
            if isinstance(payload, dict) and rec.get("type") == "event_msg":
                et = payload.get("type")
                tid = payload.get("turn_id")
            else:
                et = rec.get("type")
                turn = rec.get("turn")
                if isinstance(turn, dict):
                    tid = turn.get("id")
                tid = tid or rec.get("turn_id")
            if not tid or not et:
                continue
            if et in {"task_started", "turn_started"}:
                open_turns[tid] = {"turn_id": tid, "line": line_no, "timestamp": rec.get("timestamp")}
            elif et in {
                "task_complete",
                "turn_aborted",
                "turn_completed_successfully",
                "turn_errored",
                "turn_cancelled",
            }:
                open_turns.pop(tid, None)
    return [open_turns[k] for k in sorted(open_turns)]

def append_turn_aborted(path: Path, turn_id: str) -> None:
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "type": "event_msg",
        "payload": {
            "type": "turn_aborted",
            "turn_id": turn_id,
            "reason": "offline_repair_open_turn",
        },
    }
    need_nl = False
    if path.exists() and path.stat().st_size > 0:
        with path.open("rb") as f:
            f.seek(-1, os.SEEK_END)
            need_nl = f.read(1) != b"\n"
    with path.open("a", encoding="utf-8") as f:
        if need_nl:
            f.write("\n")
        f.write(json.dumps(payload, ensure_ascii=True) + "\n")

def delete_by_boundary(where_sql: str, boundary_sql: str, boundary_args: tuple, count_sql: str):
    boundary = cur.execute(boundary_sql, boundary_args).fetchone()
    if not boundary:
        return 0, None
    args = (
        boundary["ts"],
        boundary["ts"],
        boundary["ts_nanos"],
        boundary["ts"],
        boundary["ts_nanos"],
        boundary["id"],
    )
    if apply_changes:
        n = cur.execute(where_sql, args).rowcount
    else:
        n = cur.execute(count_sql, args).fetchone()[0]
    return n, dict(boundary)

summary["counts_before"] = {
    "logs_total": cur.execute("SELECT COUNT(*) FROM logs").fetchone()[0],
    "logs_trace": cur.execute("SELECT COUNT(*) FROM logs WHERE level='TRACE'").fetchone()[0],
    "logs_null_thread": cur.execute("SELECT COUNT(*) FROM logs WHERE thread_id IS NULL").fetchone()[0],
    "logs_threadless_trace": cur.execute("SELECT COUNT(*) FROM logs WHERE thread_id IS NULL AND level='TRACE'").fetchone()[0],
}

stale_ids = sorted(stale_thread_ids_from_logs())
summary["stale_thread_ids_from_logs"] = stale_ids
stale_cutoff = now - stale_thread_hours * 3600
summary["stale_cutoff_epoch"] = stale_cutoff

summary["rollout_repairs"] = []
summary["runtime_repairs"] = []
summary["rollout_failures"] = []
summary["runtime_failures"] = []
summary["open_turns_before_total"] = 0
summary["open_turns_after_total"] = None

thread_rows = cur.execute(
    "SELECT id, rollout_path, updated_at FROM threads ORDER BY updated_at DESC"
).fetchall()

for row in thread_rows:
    thread_id = row["id"]
    updated_at = row["updated_at"]
    rollout_path = Path(row["rollout_path"]) if row["rollout_path"] else None
    flagged = thread_id in stale_ids

    open_turns = []
    if rollout_path and rollout_path.exists():
        try:
            open_turns = open_turns_in_rollout(rollout_path)
        except Exception as exc:
            summary["rollout_failures"].append(
                {"thread_id": thread_id, "rollout_path": str(rollout_path), "error": str(exc)}
            )
            open_turns = []

    summary["open_turns_before_total"] += len(open_turns)

    stale_should_touch = updated_at < stale_cutoff and (flagged or bool(open_turns))
    if close_open_turns_mode == "all":
        should_touch_rollout = bool(open_turns)
    else:
        should_touch_rollout = stale_should_touch

    if should_touch_rollout and rollout_path and rollout_path.exists() and open_turns:
        record = {
            "thread_id": thread_id,
            "rollout_path": str(rollout_path),
            "open_turns_before": open_turns,
            "action": "planned_close_open_turns",
        }
        if apply_changes:
            try:
                backup_dir = backup_root / "rollouts_before_edit"
                backup_dir.mkdir(parents=True, exist_ok=True)
                backup_path = backup_dir / f"{thread_id}.jsonl"
                shutil.copy2(rollout_path, backup_path)
                for turn in open_turns:
                    append_turn_aborted(rollout_path, turn["turn_id"])
                record["action"] = "closed_open_turns"
                record["backup_path"] = str(backup_path)
                record["open_turns_after"] = open_turns_in_rollout(rollout_path)
            except Exception as exc:
                summary["rollout_failures"].append(
                    {"thread_id": thread_id, "rollout_path": str(rollout_path), "error": str(exc)}
                )
        summary["rollout_repairs"].append(record)

    shell_dir = code_home / "shell_snapshots"
    candidates = []
    main_snapshot = shell_dir / f"{thread_id}.sh"
    if main_snapshot.exists():
        candidates.append(main_snapshot)
    candidates.extend(sorted(shell_dir.glob(f"{thread_id}.tmp-*")))
    if stale_should_touch and candidates:
        rep = {
            "thread_id": thread_id,
            "updated_at": updated_at,
            "flagged_in_logs": flagged,
            "paths": [str(p) for p in candidates],
            "action": "planned_reset_shell_snapshot",
        }
        if apply_changes:
            try:
                backup_dir = backup_root / "runtime_before_edit" / "shell_snapshots"
                backup_dir.mkdir(parents=True, exist_ok=True)
                copied = []
                for p in candidates:
                    bp = backup_dir / p.name
                    shutil.copy2(p, bp)
                    p.unlink()
                    copied.append({"path": str(p), "backup_path": str(bp)})
                rep["action"] = "reset_shell_snapshot"
                rep["copied"] = copied
            except Exception as exc:
                summary["runtime_failures"].append({"thread_id": thread_id, "error": str(exc)})
        summary["runtime_repairs"].append(rep)

if apply_changes:
    post_total = 0
    for row in thread_rows:
        rollout_path = Path(row["rollout_path"]) if row["rollout_path"] else None
        if not rollout_path or not rollout_path.exists():
            continue
        try:
            post_total += len(open_turns_in_rollout(rollout_path))
        except Exception:
            continue
    summary["open_turns_after_total"] = post_total

deleted = {}

trace_cutoff = now - keep_threadless_trace_days * 86400
if apply_changes:
    n = cur.execute(
        "DELETE FROM logs WHERE thread_id IS NULL AND level='TRACE' AND ts < ?",
        (trace_cutoff,),
    ).rowcount
else:
    n = cur.execute(
        "SELECT COUNT(*) FROM logs WHERE thread_id IS NULL AND level='TRACE' AND ts < ?",
        (trace_cutoff,),
    ).fetchone()[0]
deleted["threadless_trace_older_than_days"] = n

remaining_threadless_trace = cur.execute(
    "SELECT COUNT(*) FROM logs WHERE thread_id IS NULL AND level='TRACE'"
).fetchone()[0]
deleted["threadless_trace_over_cap"] = 0
if remaining_threadless_trace > keep_threadless_trace_rows:
    n, boundary = delete_by_boundary(
        where_sql="""
            DELETE FROM logs
            WHERE thread_id IS NULL AND level='TRACE' AND (
                ts < ? OR (ts = ? AND ts_nanos < ?) OR (ts = ? AND ts_nanos = ? AND id < ?)
            )
        """,
        boundary_sql="""
            SELECT ts, ts_nanos, id
            FROM logs
            WHERE thread_id IS NULL AND level='TRACE'
            ORDER BY ts DESC, ts_nanos DESC, id DESC
            LIMIT 1 OFFSET ?
        """,
        boundary_args=(keep_threadless_trace_rows - 1,),
        count_sql="""
            SELECT COUNT(*) FROM logs
            WHERE thread_id IS NULL AND level='TRACE' AND (
                ts < ? OR (ts = ? AND ts_nanos < ?) OR (ts = ? AND ts_nanos = ? AND id < ?)
            )
        """,
    )
    deleted["threadless_trace_over_cap"] = n
    deleted["threadless_trace_boundary"] = boundary

log_cutoff = now - keep_log_days * 86400
if apply_changes:
    n = cur.execute("DELETE FROM logs WHERE ts < ?", (log_cutoff,)).rowcount
else:
    n = cur.execute("SELECT COUNT(*) FROM logs WHERE ts < ?", (log_cutoff,)).fetchone()[0]
deleted["logs_older_than_days"] = n

remaining_logs = cur.execute("SELECT COUNT(*) FROM logs").fetchone()[0]
deleted["logs_over_cap"] = 0
if remaining_logs > keep_log_rows:
    n, boundary = delete_by_boundary(
        where_sql="""
            DELETE FROM logs
            WHERE ts < ?
               OR (ts = ? AND ts_nanos < ?)
               OR (ts = ? AND ts_nanos = ? AND id < ?)
        """,
        boundary_sql="""
            SELECT ts, ts_nanos, id
            FROM logs
            ORDER BY ts DESC, ts_nanos DESC, id DESC
            LIMIT 1 OFFSET ?
        """,
        boundary_args=(keep_log_rows - 1,),
        count_sql="""
            SELECT COUNT(*) FROM logs
            WHERE ts < ?
               OR (ts = ? AND ts_nanos < ?)
               OR (ts = ? AND ts_nanos = ? AND id < ?)
        """,
    )
    deleted["logs_over_cap"] = n
    deleted["logs_cap_boundary"] = boundary

summary["deleted_or_planned"] = deleted

if apply_changes:
    conn.commit()
    summary["wal_checkpoint_truncate"] = list(cur.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone())
    if state_db.stat().st_size >= vacuum_min_mb * 1024 * 1024:
        cur.execute("VACUUM")
        summary["vacuum"] = "ran"
    else:
        summary["vacuum"] = "skipped_small_db"
    cur.execute("PRAGMA optimize")
    conn.commit()
else:
    summary["wal_checkpoint_truncate"] = "skipped_dry_run"
    summary["vacuum"] = "skipped_dry_run"

summary["counts_after"] = {
    "logs_total": cur.execute("SELECT COUNT(*) FROM logs").fetchone()[0],
    "logs_trace": cur.execute("SELECT COUNT(*) FROM logs WHERE level='TRACE'").fetchone()[0],
    "logs_null_thread": cur.execute("SELECT COUNT(*) FROM logs WHERE thread_id IS NULL").fetchone()[0],
    "logs_threadless_trace": cur.execute("SELECT COUNT(*) FROM logs WHERE thread_id IS NULL AND level='TRACE'").fetchone()[0],
}
summary["quick_check_after"] = cur.execute("PRAGMA quick_check").fetchone()[0]
summary["db_size_mb_after"] = round(state_db.stat().st_size / (1024 * 1024), 2)

out = backup_root / "metadata" / "repair-summary.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(summary, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, ensure_ascii=True, indent=2))
PY

log "done"
log "summary: $BACKUP_ROOT/metadata/repair-summary.json"
if [[ "$MODE" == "dry-run" ]]; then
  log "no changes were applied; rerun with --apply when ready"
else
  log "repair applied; now start VS-Codium manually"
fi
