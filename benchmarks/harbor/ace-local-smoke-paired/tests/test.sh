#!/bin/bash
set -euo pipefail

test "$(cat /workspace/fixture.txt)" = "ACE smoke fixture: DONE"
test -s /logs/agent/codex.txt || test -s /logs/agent/hermes.txt
printf '1.0\n' > /logs/verifier/reward.txt
