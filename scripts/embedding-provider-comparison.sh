#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_command="${ACE_BENCHMARK_PYTHON:-${root}/.venv-system/bin/python}"
if [[ ! -x "$python_command" ]]; then python_command="python3"; fi
exec "$python_command" "$root/scripts/embedding-provider-comparison.py"
