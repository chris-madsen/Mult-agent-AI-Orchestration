#!/bin/bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path
expected = 'export function smokeFixtureStatus(): string {\n  return "ACE smoke fixture: DONE";\n}\n'
assert Path('/workspace/fixture.ts').read_text() == expected
PY
test -s /logs/agent/codex.txt
python3 - <<'PY'
import json
from pathlib import Path

def complete_context_result(item):
    result = item.get('result')
    structured_content = result.get('structured_content') if isinstance(result, dict) else None
    evidence = structured_content.get('evidence', []) if isinstance(structured_content, dict) else []
    verified_code = any(
        isinstance(entry, dict)
        and entry.get('source') == 'code'
        and entry.get('freshness') == 'current'
        and entry.get('proofClass') == 'direct'
        for entry in evidence
    )
    return (
        isinstance(structured_content, dict)
        and structured_content.get('complete') is True
        and structured_content.get('status') not in ('not_ready', 'error')
        and verified_code
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
