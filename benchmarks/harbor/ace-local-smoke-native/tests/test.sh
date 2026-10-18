#!/bin/bash
set -euo pipefail

test "$(cat /workspace/fixture.txt)" = "ACE smoke fixture: DONE"
test -s /logs/agent/codex.txt
python3 - <<'PY'
import json
from pathlib import Path

for line in Path('/logs/agent/codex.txt').read_text().splitlines():
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        continue
    item = event.get('item', {})
    assert not (
        item.get('type') == 'mcp_tool_call'
        and item.get('server') == 'ace'
    ), 'native baseline must not call ACE MCP'
PY
printf '1.0\n' > /logs/verifier/reward.txt
