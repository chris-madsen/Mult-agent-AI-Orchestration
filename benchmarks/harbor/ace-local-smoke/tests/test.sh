#!/bin/bash
set -euo pipefail

test "$(cat /workspace/fixture.txt)" = "ACE smoke fixture: DONE"
test -s /logs/agent/codex.txt
python3 - <<'PY'
import json
from pathlib import Path

seen_native_call = False
for line in Path('/logs/agent/codex.txt').read_text().splitlines():
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        continue
    item = event.get('item', {})
    seen_native_call = seen_native_call or (
        item.get('type') == 'mcp_tool_call'
        and item.get('server') == 'ace'
        and item.get('tool') == 'ace_context'
        and item.get('error') in (None, '')
    )

assert seen_native_call
PY
printf '1.0\n' > /logs/verifier/reward.txt
