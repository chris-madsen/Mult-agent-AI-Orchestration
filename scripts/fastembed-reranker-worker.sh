#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_command="${ACE_RERANKER_PYTHON:-${root}/.venv-embedding-fast/bin/python}"
model="${ACE_RERANKER_MODEL:?ACE_RERANKER_MODEL must name the evaluated cross-encoder}"
export FASTEMBED_CACHE_PATH="${FASTEMBED_CACHE_PATH:-${root}/.cache/ace-fastembed}"

exec "${python_command}" "${root}/scripts/fastembed-reranker-worker.py" "${model}"
