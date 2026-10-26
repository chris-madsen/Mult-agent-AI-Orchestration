# Retrieval replacement foundation readiness

> Status: implementation PR only. This is the first infrastructure slice of the Aider/Claw retrieval-composition plan; it is **not** the finished composition and makes no production or token-savings claim.

## Implemented here

- `@ast-grep/napi@0.51.0` parses JS/TS/TSX in-process where the new symbol extractor has verified outline parity.
- `ACE_AST_GREP_PROVIDER=napi|auto` is an explicit migration mode. The already-existing **batched CLI remains the default** until NAPI symbol coverage has real-repository parity evidence. In `auto`, NAPI is used only for the currently covered JS/TS/TSX subset and CLI remains the fallback for CSS/HTML and other registered languages. A bundled NAPI grammar alone is not treated as extraction support.
- Warm index reuse is bound to source digest, parser identity and scope identity; the linear candidate accumulator and batched extraction already on `main` are preserved.
- `@qdrant/js-client-rest@1.20.0` owns probe, collection/alias lifecycle, query, upsert, snapshot count/membership verification and vector-reuse scrolls on the runtime path. Direct SDK response shapes are not confused with the legacy REST envelope; authenticated runtimes no longer fall back to unauthenticated raw HTTP during snapshot verification.
- Existing `ACE_RETRIEVAL_STRATEGY=dense` remains the first planned strategy: no sparse worker is started and dense-only collections do not create or require sparse vectors.
- `WorkspaceSync` owns serialized workspace refresh state, generation/index identity, manifest race rejection, and the rebuild/publish transition. `WorkspaceFilePort.observeChanges()` uses bounded NUL-delimited Git metadata and fails closed for non-Git incremental observation; the host-worktree helper carries the same typed operation.
- Synchronized queries materialize the current retrieval manifest from the previous verified manifest + Git path delta + exact reads of affected retrieval-relevant files. They no longer require a recursive content-hashing snapshot on either the no-change path or the changed-path structural rebuild.
- An already-indexed dirty file is re-read but does not trigger a rebuild when its digest is unchanged; a HEAD-only change advances the sync baseline without rebuilding. The legacy full-snapshot path remains only for initial cold verification and contexts without `WorkspaceSync`.

## Explicitly deferred

- **Aider RepoMap**: no lexical post-Qdrant reranker is called RepoMap. The actual phase requires a repo-wide def/ref graph, PageRank-style ranking/personalization and a token-budgeted rendered map.
- **Claw LSP lifecycle**: no tiny refcount registry is presented as the Claw integration. The later phase should mine Claw Code PR #3016 discovery/lazy lifecycle/action design while retaining `vscode-jsonrpc` transport.
- **Stable per-path Qdrant mutation**: structural hashing/parsing is changed-path scoped, but publication still uses the existing snapshot/alias collection lifecycle. PR A is not complete until a one-file edit mutates only affected Qdrant points instead of publishing a new whole-snapshot collection.
- **LSP refresh I/O**: the current pre-Claw LSP adapter still rebuilds its static semantic snapshot by exact-reading all indexed source files during publication. This is not a filesystem snapshot/hash anymore, but it remains O(indexed source bytes) I/O and is explicitly deferred to the Claw-style LSP lifecycle phase.
- **Dirty-path cheap fingerprinting / non-Git fallback**: Git narrows the candidate set, but already-dirty/untracked files are still exact-read to prove whether their digest changed. Size+mtime caching and measured NFS/non-Git behavior remain open.
- **New multi-arm benchmark infrastructure**: intentionally absent. First establish one live retrieval path, then measure native Hermes vs Hermes+ACE.

## Next evidence

1. CI and deterministic contract gates on this exact head.
2. Real local Qdrant dense E2E on the synchronized SDK path.
3. NAPI-vs-CLI symbol/range parity on representative real JS/TS/TSX repositories before changing the parser default.
4. Cold/warm/no-change/edit-one-file timings, including the cheap observation path.
5. Then implement the actual Aider RepoMap and remaining freshness redesign.
