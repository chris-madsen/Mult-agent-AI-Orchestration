# SPIKE — Retrieval provider readiness

**Status:** Local provider spike completed; production provider approvals remain open

## Implemented locally

ACE now has a neutral code-candidate index with symbol, workspace, range, generation
and SHA-256 source digest; lexical search ranks exact identifiers and marks digest
mismatches stale. ContextBundle preserves evidence citation, proof class, freshness,
deduplication and partial-source warnings. The MCP gateway accepts typed local context
and memory providers without leaking provider DTOs. The filesystem adapter builds that
local index from an observed workspace snapshot and revision-checked exact reads; the
local context provider returns stale/partial evidence rather than claiming freshness.
Typed Qdrant REST and Vertex documentation boundaries are also implemented behind
injected HTTP transport. They validate external payloads and fail closed before
requests on policy/auth denial; no live service success is claimed.

The pinned provider environment now includes `tree-sitter==0.26.0` and
`tree-sitter-typescript==0.23.2`. A Tree-sitter structural adapter is implemented
through an isolated Python boundary and returns typed symbol spans plus the exact
source SHA-256. A direct TypeScript `ts.LanguageService` candidate adapter returns
definitions, references, quick-info and diagnostics; this is a candidate for the
required Serena comparison, not an approved final LSP decision. Serena is not
installed as a command or Python module in the pinned environment. The direct
adapter's contract suite passes definition, reference, quick-info and diagnostic
checks; the suite's measured runtime is about 1.4 seconds on this workspace.
TypeScript is distributed under Apache-2.0; the candidate has no extra server
process or network dependency.

The local embedding arm is `local_sha256_projection_v1`, implemented in
`src/adapters/local-hash-embedding.ts` with deterministic normalized vectors and
Bertrand-style dimension/empty-input contracts. The cloud arm was not run: no
project policy or authorized cloud embedding credentials exist. The labeled holdout
therefore records cloud as `blocked`, not as a fabricated quality score; private code
remains local by default.

`npm run spike:embeddings` measured the local provider on three public labeled cases:
top-1 accuracy `0.6667` (2/3). The report is retained at
`benchmarks/reports/embedding-spike.json`; the one miss is preserved as a limitation,
not hidden by lexical fallback.

Qdrant is now running locally as Docker container `ace-qdrant`, image version
`1.19.2`, bound to `127.0.0.1:6333/6334`; collection `ace_code` health and adapter
upsert/query were smoke-tested through the TypeScript port. The live result remains `freshness: unknown` until
the workspace digest verifier is supplied.

## Not accepted as production decisions

- A live Qdrant endpoint/collection and rebuild failure run are not configured in this repo.
- Tree-sitter/ast-grep grammar set and approved LSP provider have not passed the ADR
  spike; dynamic dispatch remains explicitly uncertain.
- Vertex read-only IAM/resource probe is now verified for project
  `poetic-emblem-494722-v2`: `npm run probe:vertex` returns HTTP 200 in
  `us-central1` and `europe-west4`, with zero RAG corpora. Citation/version behavior
  on real documents and document authorization remain unverified because no corpus
  exists; the probe does not create or upload one.
- Cloud embeddings remain blocked by local policy unless a measured opt-in is approved.

No provider success, current snippet or cloud citation is fabricated. The next probe
is reproducible with `make probe-providers`; it must pin versions, capture one success
and one outage/denial response, and attach source/license/privacy evidence before
production adapter code is added.
