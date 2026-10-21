#!/bin/bash
set -euo pipefail
cd /workspace
npm run typecheck
npm test -- --runInBand
test -s /logs/agent/codex.txt
printf '1.0\n' > /logs/verifier/reward.txt
