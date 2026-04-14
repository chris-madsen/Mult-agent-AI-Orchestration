#!/usr/bin/env python3
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time


def _matches(project_root: str, cmd: str) -> bool:
    wrapper = f"{project_root}/.consilium/ralphex/scripts/codex-as-claude.sh"
    plans = f"{project_root}/.consilium/gateway/plans/"
    if cmd.startswith(f"bash {wrapper} "):
        return True
    if "ralphex" in cmd and plans in cmd:
        return True
    return False


def _kill(pid: int) -> None:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except PermissionError:
        return
    time.sleep(0.1)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    except PermissionError:
        return


def main() -> int:
    project_root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
    try:
        raw = subprocess.check_output(["ps", "-eo", "pid=,ppid=,args="], text=True)
    except Exception as exc:
        print(f"[warn] orphan cleanup skipped: {exc}")
        return 0

    killed: list[int] = []
    for line in raw.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 3:
            continue
        pid_s, ppid_s, cmd = parts
        try:
            pid = int(pid_s)
            ppid = int(ppid_s)
        except ValueError:
            continue
        if ppid != 1:
            continue
        if not _matches(project_root, cmd):
            continue
        _kill(pid)
        killed.append(pid)

    if killed:
        print("[run] stopped orphan transport pids:", " ".join(str(pid) for pid in killed))
    else:
        print("[ok] no orphan transport processes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
