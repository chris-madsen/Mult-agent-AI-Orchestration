# Vertex synthetic fixture import and DBC-14 conflict gate

**Scope:** only the committed synthetic/public fixtures under `benchmarks/fixtures/vertex-docs/`. This runbook does not authorize uploading source code, private session history, secrets or user files.

The existing Europe corpus is reused. The scripts never create or delete a corpus.

## 1. Import the synthetic document

Configure the already approved corpus and a disposable GCS prefix containing the literal string `ace-vertex-synthetic`:

```bash
export ACE_VERTEX_PROJECT="..."
export ACE_VERTEX_LOCATION="europe-west4"
export ACE_VERTEX_CORPUS_ID="..."
export ACE_VERTEX_SYNTHETIC_GCS_PREFIX="gs://<bucket>/ace-vertex-synthetic/v1"
export ACE_VERTEX_SYNTHETIC_IMPORT_ACK=true

npm run vertex:import-synthetic
```

The import script has no caller-controlled local source path. It uploads only `benchmarks/fixtures/vertex-docs/*.md`, records SHA-256 locally, waits for the Vertex long-running import operation, lists corpus files, and retains safe response artifacts under `artifacts/vertex-synthetic-import/`. OAuth token bytes are never written to those artifacts.

If the import operation does not finish or returns an error, the gate fails. Do not convert a queued/import-start response into PASS.

## 2. Retrieve the versioned synthetic ADR and compare with exact current code fixture

```bash
export ACE_VERTEX_SYNTHETIC_RETRIEVAL_ACK=true
npm run test:real-vertex-conflict
```

The gate queries for the unique `aceVertexConflictPolicy` fixture, requires a non-empty Vertex citation, and verifies the retrieved chunk contains the committed `vertex-conflict-v1` marker and outdated `operator confirmation` claim. It then compares that with the exact local code fixture, whose current behavior is `retry-immediately`.

Success evidence is written to:

- `artifacts/vertex-synthetic-conflict/evidence.json`
- `artifacts/vertex-synthetic-conflict/provider-trace.jsonl`

The report explicitly keeps `vertexServerRevision: unknown` because the current retrieval response contract does not prove a server-side document revision. The version claim is narrower: the retrieved content contains the frozen version marker and the retained committed fixture has a SHA-256 digest.

## 3. DBC evidence handoff

Use the import/retrieval artifacts with the DBC manifest generator. DBC-14 may be marked PASS only after the real retrieval command succeeds and the retained evidence contains both:

- cited documentation evidence;
- exact current-code digest and the explicit contradictory claims.

A still-empty corpus, permission denial, timeout, or uncited result is not a DBC-14 pass.
