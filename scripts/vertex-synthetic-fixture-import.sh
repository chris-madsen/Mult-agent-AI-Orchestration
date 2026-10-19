#!/usr/bin/env bash
set -euo pipefail

if [[ "${ACE_VERTEX_SYNTHETIC_IMPORT_ACK:-}" != "true" ]]; then
  echo 'Set ACE_VERTEX_SYNTHETIC_IMPORT_ACK=true to authorize upload of the committed synthetic/public fixture only.' >&2
  exit 2
fi

project="${ACE_VERTEX_PROJECT:-}"
location="${ACE_VERTEX_LOCATION:-europe-west4}"
corpus_id="${ACE_VERTEX_CORPUS_ID:-}"
gcs_prefix="${ACE_VERTEX_SYNTHETIC_GCS_PREFIX:-}"
output_dir="${ACE_VERTEX_SYNTHETIC_EVIDENCE_DIR:-artifacts/vertex-synthetic-import}"
fixture_dir="benchmarks/fixtures/vertex-docs"

for pair in "project:$project" "location:$location" "corpus_id:$corpus_id"; do
  name="${pair%%:*}"
  value="${pair#*:}"
  if [[ -z "$value" || ! "$value" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Invalid or missing ${name}" >&2
    exit 2
  fi
done

if [[ ! "$gcs_prefix" =~ ^gs://[^/]+/.*ace-vertex-synthetic[^[:space:]]*$ ]]; then
  echo 'ACE_VERTEX_SYNTHETIC_GCS_PREFIX must be a gs:// path containing ace-vertex-synthetic' >&2
  exit 2
fi

if [[ ! -d "$fixture_dir" ]]; then
  echo "Synthetic fixture directory missing: $fixture_dir" >&2
  exit 2
fi

mkdir -p "$output_dir"
manifest="$output_dir/local-fixture-manifest.json"
python3 - "$fixture_dir" "$manifest" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
files = []
for path in sorted(root.glob("*.md")):
    data = path.read_bytes()
    files.append({
        "path": path.as_posix(),
        "sha256": hashlib.sha256(data).hexdigest(),
        "size_bytes": len(data),
    })
if not files:
    raise SystemExit("no committed synthetic Markdown fixtures found")
out.write_text(json.dumps({"schema_version": 1, "scope": "synthetic-public-only", "files": files}, indent=2) + "\n")
PY

# The source path is intentionally hard-coded to the committed synthetic fixture
# directory. No caller-supplied local path can be uploaded by this script.
gcloud storage cp "$fixture_dir"/*.md "${gcs_prefix%/}/" >/dev/null

token="$(gcloud auth print-access-token)"
endpoint="https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}/ragCorpora/${corpus_id}/ragFiles:import"
gcs_uri="${gcs_prefix%/}/*.md"
request_body="$(python3 - "$gcs_uri" <<'PY'
import json, sys
print(json.dumps({
    "import_rag_files_config": {
        "gcs_source": {"uris": [sys.argv[1]]},
        "rag_file_transformation_config": {
            "rag_file_chunking_config": {"chunk_size": 512, "chunk_overlap": 64}
        }
    }
}))
PY
)"

response_file="$output_dir/import-response.json"
http_code="$(curl -sS -o "$response_file" -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer ${token}" \
  -H 'Content-Type: application/json' \
  "$endpoint" \
  -d "$request_body")"
if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
  echo "Vertex import returned HTTP $http_code; response retained at $response_file" >&2
  exit 1
fi

operation_name="$(python3 - "$response_file" <<'PY'
import json, sys
body=json.load(open(sys.argv[1]))
print(body.get("name", ""))
PY
)"
if [[ -z "$operation_name" ]]; then
  echo 'Vertex import did not return a long-running operation name.' >&2
  exit 1
fi

poll_attempts="${ACE_VERTEX_IMPORT_POLL_ATTEMPTS:-60}"
poll_delay="${ACE_VERTEX_IMPORT_POLL_DELAY_SECONDS:-10}"
if [[ ! "$poll_attempts" =~ ^[1-9][0-9]*$ || ! "$poll_delay" =~ ^[0-9]+$ ]]; then
  echo 'Vertex import poll settings must be non-negative integers (attempts > 0).' >&2
  exit 2
fi

operation_file="$output_dir/import-operation-final.json"
operation_url="https://${location}-aiplatform.googleapis.com/v1beta1/${operation_name}"
done_flag="false"
for ((attempt=1; attempt<=poll_attempts; attempt++)); do
  curl -fsS -H "Authorization: Bearer ${token}" "$operation_url" -o "$operation_file"
  read -r done_flag has_error < <(python3 - "$operation_file" <<'PY'
import json, sys
body=json.load(open(sys.argv[1]))
print("true" if body.get("done") is True else "false", "true" if "error" in body else "false")
PY
)
  if [[ "$has_error" == "true" ]]; then
    echo "Vertex import operation failed; evidence retained at $operation_file" >&2
    exit 1
  fi
  if [[ "$done_flag" == "true" ]]; then
    break
  fi
  sleep "$poll_delay"
done
if [[ "$done_flag" != "true" ]]; then
  echo "Vertex import operation did not complete after $poll_attempts attempts." >&2
  exit 1
fi

list_file="$output_dir/rag-files.json"
list_url="https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}/ragCorpora/${corpus_id}/ragFiles"
curl -fsS -H "Authorization: Bearer ${token}" "$list_url" -o "$list_file"

python3 - "$manifest" "$response_file" "$operation_file" "$list_file" "$project" "$location" "$corpus_id" "$gcs_uri" <<'PY'
import hashlib, json, pathlib, sys
manifest, response, operation, listing = map(pathlib.Path, sys.argv[1:5])
evidence = {
    "status": "PASS",
    "scope": "synthetic-public-only",
    "project": sys.argv[5],
    "location": sys.argv[6],
    "corpus_id": sys.argv[7],
    "gcs_uri": sys.argv[8],
    "local_fixture_manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
    "import_response_sha256": hashlib.sha256(response.read_bytes()).hexdigest(),
    "operation_response_sha256": hashlib.sha256(operation.read_bytes()).hexdigest(),
    "rag_files_response_sha256": hashlib.sha256(listing.read_bytes()).hexdigest(),
    "note": "No OAuth token bytes are retained in these artifacts."
}
print(json.dumps(evidence))
PY
