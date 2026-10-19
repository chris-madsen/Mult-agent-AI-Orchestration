#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_command="${ACE_BENCHMARK_ORCHESTRATOR_PYTHON:-${root}/.venv-system/bin/python}"
if [[ ! -x "$python_command" ]]; then python_command="python3"; fi
if [[ -n "${ACE_EMBEDDING_LD_LIBRARY_PATH:-}" ]]; then
  export LD_LIBRARY_PATH="$ACE_EMBEDDING_LD_LIBRARY_PATH${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
elif command -v nix >/dev/null 2>&1; then
  library_dirs=()
  for pattern in '*gcc-*-lib/lib/libstdc++.so.6' '*zlib-*/lib/libz.so.1' '*gcc-*-libgcc/lib/libgcc_s.so.1' '*libffi-*/lib/libffi.so.8'; do
    library_path="$(find /nix/store -path "$pattern" -print -quit 2>/dev/null || true)"
    if [[ -n "$library_path" ]]; then library_dirs+=("$(dirname "$library_path")"); fi
  done
  if ((${#library_dirs[@]} > 0)); then export LD_LIBRARY_PATH="$(IFS=:; echo "${library_dirs[*]}")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"; fi
fi
export FASTEMBED_CACHE_PATH="${FASTEMBED_CACHE_PATH:-${root}/.cache/ace-fastembed}"
export HF_HOME="${ACE_EMBEDDING_HF_HOME:-${root}/.cache/ace-embedding-eval}"
export HF_HUB_CACHE="${ACE_EMBEDDING_HF_HUB_CACHE:-${HF_HOME}/hub}"
exec "$python_command" "$root/scripts/embedding-provider-comparison.py"
