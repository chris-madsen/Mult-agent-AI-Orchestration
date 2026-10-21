#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_command="${ACE_SPARSE_EMBEDDING_PYTHON:-${root}/.venv-embedding-fast/bin/python}"
model="${ACE_SPARSE_EMBEDDING_MODEL:-Qdrant/bm25}"
export FASTEMBED_CACHE_PATH="${FASTEMBED_CACHE_PATH:-${root}/.cache/ace-fastembed}"

exec "${python_command}" "${root}/scripts/fastembed-sparse-worker.py" "${model}"
