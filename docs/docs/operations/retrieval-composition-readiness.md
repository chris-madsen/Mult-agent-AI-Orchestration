# Retrieval replacement foundation readiness

> Status: implementation PR only. This is the first infrastructure slice of the Aider/Claw retrieval-composition plan; it is **not** the finished composition and makes no production or token-savings claim.

## Implemented here

- `@ast-grep/napi@0.51.0` parses JS/TS/TSX in-process where the new symbol extractor has verified outline parity.
- `ACE_AST_GREP_PROVIDER=napi|auto` is an explicit migration mode. The already-existing **batched CLI remains the default** until NAPI symbol coverage has real-repository parity evidence. In `auto`, NAPI is used only for the currently covered JS/TS/TSX subset and CLI remains the fallback for CSS/HTML and other registered languages. A bundled NAPI grammar alone is not treated as extraction support.
- Warm index reuse is bound to source digest, parser identity and scope identity; the linear candidate accumulator and batched extraction already on `main` are preserved.
- `@qdrant/js-client-rest@1.20.0` owns probe, collection/alias lifecycle, query, upsert, snapshot count/membership verification and vector-reuse scrolls on the runtime path. Direct SDK response shapes are not confused with the legacy REST envelope; authenticated runtimes no longer fall back to unauthenticated raw HTTP during snapshot verification.
- Existing `ACE_RETRIEVAL_STRATEGY=dense` remains the first planned strategy: no sparse worker is started and dense-only collections do not create or require sparse vectors.
- `WorkspaceSync` now owns serialized workspace refresh state, generation/index identity, manifest race rejection, and the rebuild/publish transition. `WorkspaceFilePort.observeChanges()` uses bounded NUL-delimited Git metadata and fails closed for non-Git incremental observation; the host-worktree helper carries the same typed operation.
- Runtime Qdrant contexts use the synchronized path when it is wired: no-change requests use the cheap observation boundary instead of a recursive snapshot, and changed requests rebuild/publish before the new state becomes active. The legacy full-snapshot path remains as an explicit compatibility fallback for contexts without `WorkspaceSync`.

## Explicitly deferred

- **Aider RepoMap**: no lexical post-Qdrant reranker is called RepoMap. The actual phase requires a repo-wide def/ref graph, PageRank-style ranking/personalization and a token-budgeted rendered map.
- **Claw LSP lifecycle**: no tiny refcount registry is presented as the Claw integration. The later phase should mine Claw Code PR #3016 discovery/lazy lifecycle/action design while retaining `vscode-jsonrpc` transport.
- **Affected-source rebuild**: the synchronization boundary and no-change fast path are implemented, but changed requests still materialize a complete authoritative manifest before rebuilding through the existing previous-build reuse path. Per-file exact verification, finer-grained publication cleanup, and measured NFS behavior remain open work.
- **New multi-arm benchmark infrastructure**: intentionally absent. First establish one live retrieval path, then measure native Hermes vs Hermes+ACE.

## Next evidence

1. CI and deterministic contract gates on this exact head.
2. Real local Qdrant dense E2E on the synchronized SDK path.
3. NAPI-vs-CLI symbol/range parity on representative real JS/TS/TSX repositories before changing the parser default.
4. Cold/warm/no-change/edit-one-file timings, including the cheap observation path.
5. Then implement the actual Aider RepoMap and remaining freshness redesign.
