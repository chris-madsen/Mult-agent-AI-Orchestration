#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_command="${ACE_EMBEDDING_PYTHON:-${root}/.venv-embedding-st/bin/python}"
model="${ACE_EMBEDDING_MODEL:-sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2}"
export HF_HOME="${HF_HOME:-${root}/.cache/ace-embedding-eval}"
export HF_HUB_CACHE="${HF_HUB_CACHE:-${HF_HOME}/hub}"

if [[ -z "${ACE_EMBEDDING_LD_LIBRARY_PATH:-}" ]]; then
  library_dirs=()
  for pattern in \
    "*gcc-*-lib/lib/libstdc++.so.6" \
    "*zlib-*/lib/libz.so.1" \
    "*gcc-*-libgcc/lib/libgcc_s.so.1" \
    "*libffi-*/lib/libffi.so.8"; do
    library_path="$(find /nix/store -path "$pattern" -print -quit 2>/dev/null || true)"
    if [[ -n "$library_path" ]]; then library_dirs+=("$(dirname "$library_path")"); fi
  done
  if ((${#library_dirs[@]} > 0)); then
    export LD_LIBRARY_PATH="$(IFS=:; echo "${library_dirs[*]}")"
  else
    unset LD_LIBRARY_PATH
  fi
else
  export LD_LIBRARY_PATH="${ACE_EMBEDDING_LD_LIBRARY_PATH}"
fi

exec "${python_command}" "${root}/scripts/sentence-transformers-worker.py" "${model}"
