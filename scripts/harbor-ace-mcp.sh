#!/usr/bin/env bash
set -euo pipefail

# SWE-Atlas images provide Python 3 but not the ACE embedding worker's
# dependency set. Install the pinned provider into the task-local /tmp area;
# this does not modify the task checkout or the immutable base image.
package_root="${ACE_FASTEMBED_PACKAGE_ROOT:-/tmp/ace-fastembed-packages}"
marker="$package_root/.fastembed-0.7.4.ready"
mkdir -p "$package_root"
if [[ ! -f "$marker" ]]; then
  python3 -m pip install \
    --disable-pip-version-check \
    --no-input \
    --target "$package_root" \
    'fastembed==0.7.4'
  : > "$marker"
fi

export PYTHONPATH="$package_root:/ace/scripts${PYTHONPATH:+:$PYTHONPATH}"
export ACE_EMBEDDING_PYTHON="${ACE_EMBEDDING_PYTHON:-python3}"
exec node /ace/dist/bin/ace-mcp.js
