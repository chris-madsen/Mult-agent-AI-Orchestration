#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
default_python="${root}/.venv-embedding-fast/bin/python"
python_command="${ACE_SPARSE_EMBEDDING_PYTHON:-${default_python}}"
runtime_root="${ACE_RUNTIME_ROOT:-$root}"
if [[ -d "${runtime_root}/runtime/python" ]]; then
  python_version="$(${python_command} -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  package_root="${runtime_root}/runtime/python/${python_version}/site-packages"
  if [[ -d "$package_root" ]]; then
    export PYTHONPATH="$package_root:${runtime_root}/scripts${PYTHONPATH:+:$PYTHONPATH}"
  fi
fi
model="${ACE_SPARSE_EMBEDDING_MODEL:-Qdrant/bm25}"
export FASTEMBED_CACHE_PATH="${FASTEMBED_CACHE_PATH:-${root}/.cache/ace-fastembed}"
export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"

if [[ -n "${ACE_SPARSE_EMBEDDING_LD_LIBRARY_PATH:-}" ]]; then
  export LD_LIBRARY_PATH="${ACE_SPARSE_EMBEDDING_LD_LIBRARY_PATH}"
elif [[ "${python_command}" == "${default_python}" ]]; then
  library_dirs=()
  for pattern in     "*gcc-*-lib/lib/libstdc++.so.6"     "*zlib-*/lib/libz.so.1"     "*gcc-*-libgcc/lib/libgcc_s.so.1"     "*libffi-*/lib/libffi.so.8"; do
    library_path="$(find /nix/store -path "$pattern" -print -quit 2>/dev/null || true)"
    if [[ -n "$library_path" ]]; then library_dirs+=("$(dirname "$library_path")"); fi
  done
  if ((${#library_dirs[@]} > 0)); then
    candidate_library_path="$(IFS=:; echo "${library_dirs[*]}")"
    if LD_LIBRARY_PATH="$candidate_library_path" "${python_command}" -c 'import numpy' >/dev/null 2>&1; then
      export LD_LIBRARY_PATH="$candidate_library_path"
    else
      unset LD_LIBRARY_PATH
    fi
  else
    unset LD_LIBRARY_PATH
  fi
fi

if [[ -n "${ACE_SPARSE_EMBEDDING_LD_PRELOAD:-}" ]]; then
  export LD_PRELOAD="${ACE_SPARSE_EMBEDDING_LD_PRELOAD}"
fi

exec "${python_command}" "${root}/scripts/fastembed-sparse-worker.py" "${model}"
