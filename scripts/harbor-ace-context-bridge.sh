#!/usr/bin/env bash
set -euo pipefail

# Direct Hermes ContextEngine bridge. This is not an MCP server; it speaks the
# versioned ACE JSONL transform protocol over stdin/stdout.
export ACE_WORKSPACE_ROOT="${ACE_WORKSPACE_ROOT:-/app}"
export ACE_ALLOWED_ROOTS="${ACE_ALLOWED_ROOTS:-$ACE_WORKSPACE_ROOT}"
export ACE_WORKSPACE_ID="${ACE_WORKSPACE_ID:-00000000-0000-4000-8000-000000000001}"
export ACE_STATE_DIR="${ACE_STATE_DIR:-/tmp/ace-state}"
export ACE_ARTIFACT_DIR="${ACE_ARTIFACT_DIR:-/logs/artifacts}"
export ACE_ENABLE_EXPERIMENTAL_QDRANT="${ACE_ENABLE_EXPERIMENTAL_QDRANT:-true}"
export ACE_QDRANT_URL="${ACE_QDRANT_URL:-http://172.17.0.1:6333}"
export ACE_QDRANT_LOCAL_HOSTS="${ACE_QDRANT_LOCAL_HOSTS:-172.17.0.1}"
export ACE_EMBEDDING_WORKER="${ACE_EMBEDDING_WORKER:-/ace/scripts/fastembed-worker.sh}"
export ACE_SPARSE_EMBEDDING_WORKER="${ACE_SPARSE_EMBEDDING_WORKER:-/ace/scripts/fastembed-sparse-worker.sh}"
export ACE_AST_GREP_COMMAND="${ACE_AST_GREP_COMMAND:-/ace/node_modules/.bin/ast-grep}"
export ACE_AST_GREP_VERSION="${ACE_AST_GREP_VERSION:-ast-grep/0.51.0}"
export ACE_LSP_COMMAND="${ACE_LSP_COMMAND:-/ace/node_modules/.bin/typescript-language-server}"
export ACE_LSP_VERSION="${ACE_LSP_VERSION:-typescript-language-server/6.0.2}"
export ACE_EMBEDDING_MODEL="${ACE_EMBEDDING_MODEL:-sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2}"
export ACE_EMBEDDING_DIMENSION="${ACE_EMBEDDING_DIMENSION:-384}"
export ACE_PROVIDER_TRACE_FILE="${ACE_PROVIDER_TRACE_FILE:-/logs/artifacts/provider-trace.jsonl}"
export ACE_REQUIRE_PINNED_EMBEDDING="${ACE_REQUIRE_PINNED_EMBEDDING:-true}"
export FASTEMBED_CACHE_PATH="${FASTEMBED_CACHE_PATH:-/ace/runtime/model-cache}"
export ACE_EMBEDDING_PROVIDER="${ACE_EMBEDDING_PROVIDER:-fastembed/onnx}"
export ACE_EMBEDDING_MODEL_REVISION="${ACE_EMBEDDING_MODEL_REVISION:-e8f8c211226b894fcb81acc59f3b34ba3efd5f42}"
export ACE_EMBEDDING_ARTIFACT_MODEL="${ACE_EMBEDDING_ARTIFACT_MODEL:-qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q}"
export ACE_EMBEDDING_ARTIFACT_REVISION="${ACE_EMBEDDING_ARTIFACT_REVISION:-faf4aa4225822f3bc6376869cb1164e8e3feedd0}"
export ACE_EMBEDDING_ARTIFACT_DIGEST="${ACE_EMBEDDING_ARTIFACT_DIGEST:-4bb74885d054d77b15c33520114d7edc19c31699bdab813d893e4f58c3afb4a1}"
export ACE_EMBEDDING_PREPROCESSING="${ACE_EMBEDDING_PREPROCESSING:-raw_text_v1}"
export ACE_CONTEXT_BRIDGE_MODE="true"
export ACE_RUNTIME_ROOT="${ACE_RUNTIME_ROOT:-/ace}"
export ACE_RUNTIME_ID="${ACE_RUNTIME_ID:-ace-harbor-runtime-v1}"

python_version="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
package_root="${ACE_RUNTIME_ROOT}/runtime/python/${python_version}/site-packages"
if [[ ! -d "$package_root" ]]; then
  printf 'ACE_CONTEXT_BLOCKED: unsupported or unbundled Python runtime %s\n' "$python_version" >&2
  exit 78
fi
export PYTHONPATH="$package_root:${ACE_RUNTIME_ROOT}/scripts${PYTHONPATH:+:$PYTHONPATH}"
export ACE_EMBEDDING_PYTHON="${ACE_EMBEDDING_PYTHON:-python3}"
export ACE_SPARSE_EMBEDDING_PYTHON="${ACE_SPARSE_EMBEDDING_PYTHON:-python3}"
exec node "${ACE_RUNTIME_ROOT}/dist/bin/ace-context-bridge.js"
