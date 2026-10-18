#!/usr/bin/env bash
set -euo pipefail

models_status="$(curl --http1.1 --connect-timeout 5 --max-time 15 -sS -o /tmp/ace-jev-models.json -w '%{http_code}' https://api.typesafe.ai/v1/models)"
systemone_status="$(curl --http1.1 --connect-timeout 5 --max-time 15 -sS -I -o /tmp/ace-jev-systemone.json -w '%{http_code}' https://api.typesafe.ai/v1/systemone)"
python3 - "$models_status" "$systemone_status" <<'PY'
import json, sys
models = json.load(open('/tmp/ace-jev-models.json'))
print(json.dumps({
    'models_endpoint_http': int(sys.argv[1]),
    'models_error': models.get('detail') if isinstance(models, dict) else None,
    'systemone_head_http': int(sys.argv[2]),
    'systemone_method_contract': 'POST-only observed',
    'private_code_default': 'blocked until explicit policy opt-in',
    'authenticated_trial': 'not run; no Jev credential configured',
}))
PY
