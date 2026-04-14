#!/usr/bin/env python3
from __future__ import annotations

import re
import shutil
import subprocess
import sys


def _parse_ss_line_users_field(line: str) -> str | None:
    # Example tail: users:(("python",pid=12345,fd=6))
    m = re.search(r"users:\(\(\"[^\"]+\",pid=(\d+),", line)
    return m.group(1) if m else None


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: tcp_listener_pid.py <host> <port>", file=sys.stderr)
        return 2

    host = sys.argv[1]
    port = sys.argv[2]

    ss_bin = shutil.which("ss")
    if not ss_bin:
        return 1

    proc = subprocess.run(
        [ss_bin, "-ltnp"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return 1

    needle = f"{host}:{port}"
    for raw in (proc.stdout or "").splitlines():
        line = raw.strip()
        if not line or not line.startswith("LISTEN"):
            continue
        if needle not in line:
            continue
        pid = _parse_ss_line_users_field(line)
        if pid:
            print(pid)
            return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
