#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_command="${ACE_EMBEDDING_PYTHON:-${root}/.venv-embedding-fast/bin/python}"
model="${ACE_EMBEDDING_MODEL:-sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2}"

if [[ -z "${ACE_EMBEDDING_LD_LIBRARY_PATH:-}" ]]; then
  libstdc_dir="$(dirname "$(find /nix/store -path '*gcc-*-lib/lib/libstdc++.so.6' -print | tail -1)")"
  zlib_dir="$(dirname "$(find /nix/store -path '*zlib-*/lib/libz.so.1' -print -quit)")"
  gcc_dir="$(dirname "$(find /nix/store -name libgcc_s.so.1 -path '*gcc-*-libgcc/lib/*' -print -quit)")"
  ffi_dir="$(dirname "$(find /nix/store -name libffi.so.8 -path '*libffi-*/lib/*' -print -quit)")"
  export LD_LIBRARY_PATH="${libstdc_dir}:${zlib_dir}:${gcc_dir}:${ffi_dir}"
else
  export LD_LIBRARY_PATH="${ACE_EMBEDDING_LD_LIBRARY_PATH}"
fi

exec "${python_command}" "${root}/scripts/fastembed-worker.py" "${model}"
