#!/bin/bash
set -euo pipefail
cd /workspace
mkdir -p /tmp/ace-artifacts
node --test test/*.test.mjs >/logs/verifier/test.log
test -s /logs/agent/codex.txt || test -s /logs/agent/hermes.txt
printf '1.0\n' > /logs/verifier/reward.txt
