# Provider completion report — ACE PR #2

Date: 2026-10-19. Status: **code submitted, CI/real-service acceptance pending**. No 5× claim.

## Provider implementations and actual APIs

### Vertex AI RAG Engine

`src/adapters/vertex-rag.ts` implements the documented `projects.locations.retrieveContexts` endpoint, authenticates using a supplied OAuth bearer token, sends `vertexRagStore.ragResources` with the selected corpus, and consumes `contexts.contexts` with `sourceUri` and `text`. It is wired into `ace_context` when `ACE_ENABLE_VERTEX_RAG=true`, and **cloud opt-in** must additionally be `ACE_CLOUD_DOCS_OPT_IN=true`. With opt-in disabled, policy denies the call before any HTTP request. Documents remain `derived/unknown` freshness until separately verified; ACE must never confuse cloud RAG snippets with current code truth.

Required settings: `ACE_VERTEX_PROJECT`, `ACE_VERTEX_LOCATION`, `ACE_VERTEX_CORPUS_ID`, `ACE_VERTEX_ACCESS_TOKEN`. **Do not** write credentials into repo. Google Cloud API and corpus availability must be checked against the real project. Official reference: https://docs.cloud.google.com/vertex-ai/docs/reference/rest/v1beta1/projects.locations/retrieveContexts

### Graphiti

`src/adapters/graphiti-mcp.ts` uses the **official MCP TypeScript client v2** to launch/connect to Graphiti's supported `stdio` MCP server. It calls real `add_memory` and `delete_episode` tools with group partition and deterministic episode UUID; there are no hand-invented `/episodes/{id}/project` routes. Graphiti's `add_memory` is asynchronous; projected receipts stay `pending`, not falsely `projected`. Graphiti facts are derived and `approval=unverified`.

The `src/bin/ace-memory.ts` CLI imports original Codex history into the immutable archive before queuing its Graphiti projection, and on deletion purges derived facts **before** tombstoning source. Retries are idempotent at the source archive. The CLI uses `ACE_MEMORY_ARCHIVE_ROOT`, `ACE_WORKSPACE_ID`, `ACE_GRAPHITI_COMMAND`, `ACE_GRAPHITI_ARGS_JSON` (JSON argv array) and `ACE_GRAPHITI_GROUP_ID`. Graphiti MCP `stdio` requires its own installed Python, database and configured inference credentials. No Graphiti environment was provided here. Official MCP server tools and group scoping: https://github.com/getzep/graphiti/tree/main/mcp_server

**Open Graphiti issues:** transactionally durable outbox between raw archive and asynchronous Graphiti processing, projection acknowledgement/reconciliation, and `search_memory_facts` query/citation mapping back to immutable originals are still not end-to-end verified. The legacy `makeGraphitiProjectionPort` and `makeVertexDocumentationPort` in `http-provider-boundaries.ts` are obsolete generic prototypes; do **not** wire them.

### Archive

The file archive now wraps **all mutations** in a global `mkdir` lock across processes sharing the same POSIX/atomic-filesystem volume. It never steals a potentially stale lock; after 20 seconds it fails closed and requires operator inspection. Existing reference counting by metadata scan protects blobs shared across episodes, and SHA-256 verification rejects corruption. A new test creates **two independent archive instances**. Real subprocess concurrency/kill/recovery and Kubernetes RWX/NFS semantics still need testing. For distributed storage, prefer a transactional database; do not claim the directory mutex is equivalent to one.

### Harbor

`scripts/harbor-retrieval-gate.ts` consumes raw trial results and Codex JSONL MCP call evidence from **two real Harbor job directories**, computes quality, tokens and observed ACE invocations, and fails if success rates fall, counts differ or ACE is not actually called. It never manufactures an improvement ratio. A new `benchmarks/harbor/ace-retrieval-impact` behavior-driven task requires locating a retry-limit defect across multiple files while preserving the independent payment flow.

Invocation **after running real paired Harbor jobs**:

```bash
npm run gate:harbor -- /path/to/native-job /path/to/ace-job /path/to/report.json
```

The existing Harbor smoke reports cannot establish causal benefit. A three-task
native-only exploratory attempt was run, but all three trials errored: one
Codex trial was rejected with `invalid_api_key`, and two pre-fix task builds
failed because their Docker contexts lacked `environment/fixture`. No ACE arm
was run, so no quality, attribution, token, cost or 5x claim is made. The
redacted raw summary is `benchmarks/reports/harbor-native-exploratory-failure.json`.
The task contexts are now fixed and Docker-build locally; a valid owner-provided
Codex runtime is still required for the paired gate.

## Verification matrix

| Verification | Status |
|---|---|
| Real API shapes researched and adapters implemented | Code committed |
| Multi-instance file-lock regression | Test committed; CI pending |
| Vertex denied-before-network contract | Test committed; CI pending |
| Graphiti stdio client + tools wired for import/delete | Code committed; real Graphiti MCP not exercised |
| Paired Harbor tool and behavioral task | Tool and three exploratory tasks committed; native-only attempt rejected with preserved failure evidence; paired benchmark remains open |
| OpenSpec 006 production acceptance, 5× | **Not proven** |

All outstanding failures should be repaired by Codex with direct real-provider integration and negative tests. Do not relax Meyer invariants to make CI pass.
