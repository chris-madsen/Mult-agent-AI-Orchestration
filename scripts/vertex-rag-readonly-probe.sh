#!/usr/bin/env bash
set -euo pipefail

project="${ACE_VERTEX_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
if [[ -z "$project" || "$project" == "(unset)" ]]; then
  echo 'Vertex project is not configured' >&2
  exit 2
fi
token="$(gcloud auth print-access-token)"
for location in us-central1 europe-west4; do
  response="$(curl -fsS -H "Authorization: Bearer ${token}" "https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/ragCorpora")"
  RESPONSE="$response" LOCATION="$location" PROJECT="$project" python3 - <<'PY'
import json, os
body = json.loads(os.environ['RESPONSE'])
print(json.dumps({
    'project': os.environ['PROJECT'],
    'location': os.environ['LOCATION'],
    'http': 200,
    'corpora_count': len(body.get('ragCorpora', [])),
    'citation_contract': 'unverified_empty_corpus',
    'version_contract': 'unverified_empty_corpus',
}))
PY
done
