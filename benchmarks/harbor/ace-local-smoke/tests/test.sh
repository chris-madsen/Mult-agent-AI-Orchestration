#!/bin/bash
set -euo pipefail

test "$(cat /workspace/fixture.txt)" = "ACE smoke fixture: DONE"
test -s /logs/agent/codex.txt
python3 - <<'PY'
import json
from pathlib import Path

def complete_context_result(item):
    result = item.get('result')
    structured_content = result.get('structured_content') if isinstance(result, dict) else None
    return (
        isinstance(structured_content, dict)
        and structured_content.get('complete') is True
        and structured_content.get('status') not in ('not_ready', 'error')
    )

seen_native_call = False
for line in Path('/logs/agent/codex.txt').read_text().splitlines():
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        continue
    item = event.get('item', {})
    seen_native_call = seen_native_call or (
        event.get('type') == 'item.completed'
        and item.get('type') == 'mcp_tool_call'
        and item.get('server') == 'ace'
        and item.get('tool') == 'ace_context'
        and item.get('status') == 'completed'
        and item.get('error') in (None, '')
        and complete_context_result(item)
    )

assert seen_native_call
PY
printf '1.0\n' > /logs/verifier/reward.txt
