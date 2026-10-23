#!/usr/bin/env bash
set -euo pipefail

# SWE-Atlas images provide Python 3 but not the ACE embedding worker's
# dependency set. Install the pinned provider into the task-local /tmp area;
# this does not modify the task checkout or the immutable base image.
package_root="/tmp/ace-fastembed-packages"
marker="$package_root/.fastembed-0.7.4.ready"
python_launcher="$package_root/python"
mkdir -p "$package_root"
if [[ ! -f "$marker" ]]; then
  # MCP stdio reserves stdout for JSON-RPC. Keep bootstrap diagnostics on
  # stderr so pip progress cannot corrupt the Codex <-> ACE handshake.
  python3 -m pip install \
    --disable-pip-version-check \
    --no-input \
    --target "$package_root" \
    'fastembed==0.7.4' 1>&2
  : > "$marker"
fi

if [[ ! -x "$python_launcher" ]]; then
  cat > "$python_launcher" <<'PYTHON_LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
export PYTHONPATH="/tmp/ace-fastembed-packages:/ace/scripts${PYTHONPATH:+:$PYTHONPATH}"
exec python3 "$@"
PYTHON_LAUNCHER
  chmod +x "$python_launcher"
fi

export ACE_EMBEDDING_PYTHON="$python_launcher"
export ACE_SPARSE_EMBEDDING_PYTHON="$python_launcher"
exec node /ace/dist/bin/ace-mcp.js
