# Retrieval replacement foundation readiness

> Status: implementation PR only. This is the first infrastructure slice of the Aider/Claw retrieval-composition plan; it is **not** the finished composition and makes no production or token-savings claim.

## Implemented here

- `@ast-grep/napi@0.51.0` parses JS/TS/TSX in-process where the new symbol extractor has verified outline parity.
- `ACE_AST_GREP_PROVIDER=napi|auto` is an explicit migration mode. The already-existing **batched CLI remains the default** until NAPI symbol coverage has real-repository parity evidence. In `auto`, NAPI is used only for the currently covered JS/TS/TSX subset and CLI remains the fallback for CSS/HTML and other registered languages. A bundled NAPI grammar alone is not treated as extraction support.
- Warm index reuse is bound to source digest, parser identity and scope identity; the linear candidate accumulator and batched extraction already on `main` are preserved.
- `@qdrant/js-client-rest@1.20.0` owns probe, collection/alias lifecycle, query, upsert, snapshot count/membership verification and vector-reuse scrolls on the runtime path. Direct SDK response shapes are not confused with the legacy REST envelope; authenticated runtimes no longer fall back to unauthenticated raw HTTP during snapshot verification.
- Existing `ACE_RETRIEVAL_STRATEGY=dense` remains the first planned strategy: no sparse worker is started and dense-only collections do not create or require sparse vectors.
- `src/application/ast-grep-parity.ts` and `scripts/ast-grep-provider-parity.ts` now produce a digest-bound CLI/NAPI symbol/range comparison. The production default remains CLI until the frozen-fixture and real-repository parity gate passes.
- `WorkspaceSync` owns serialized workspace refresh state, generation/index identity, manifest race rejection, and the rebuild/publish transition. Git workspaces use bounded NUL-delimited change metadata; non-Git workspaces use a size+mtime metadata walk as a cheap detector. Exact reads remain authoritative before index mutation. The host-worktree helper carries the same typed operation.
- Synchronized queries materialize the current retrieval manifest from the previous verified manifest + Git path delta + exact reads of affected retrieval-relevant files. They no longer require a recursive content-hashing snapshot on either the no-change path or the changed-path structural rebuild.
- An already-indexed dirty file is re-read but does not trigger a rebuild when its digest is unchanged; a HEAD-only change advances the sync baseline without rebuilding. The legacy full-snapshot path remains only for initial cold verification and contexts without `WorkspaceSync`.

## Explicitly deferred

- **Aider RepoMap**: no lexical post-Qdrant reranker is called RepoMap. The actual phase requires a repo-wide def/ref graph, PageRank-style ranking/personalization and a token-budgeted rendered map.
- **Claw LSP lifecycle**: no tiny refcount registry is presented as the Claw integration. The later phase should mine Claw Code PR #3016 discovery/lazy lifecycle/action design while retaining `vscode-jsonrpc` transport.
- **Stable per-path Qdrant mutation:** the synchronized incremental path uses one stable workspace/embedding/retrieval-schema collection. Changed paths publish new points before pruning older path versions; deleted/empty paths are removed; cold/restart publication upserts the complete current snapshot before pruning all older workspace versions. This prevents embedding/upsert failure from destroying the last known-good vectors. Cross-process concurrency and real crash/restart evidence on the reviewed head remain required before production claims.
- **LSP refresh I/O**: the current pre-Claw LSP adapter still rebuilds its static semantic snapshot by exact-reading all indexed source files during publication. This is not a filesystem snapshot/hash anymore, but it remains O(indexed source bytes) I/O and is explicitly deferred to the Claw-style LSP lifecycle phase.
- **Dirty Git paths / filesystem portability**: non-Git workspaces now retain size+mtime baselines from race-checked exact reads, but Git dirty/untracked paths are still exact-read on every observation to prove digest equality. Measured NFS/network-filesystem behavior remains open.
- **New multi-arm benchmark infrastructure**: intentionally absent. First establish one live retrieval path, then measure native Hermes vs Hermes+ACE.

## Next evidence

The original PR head reported successful local real-provider runs, but the review changed the stable-publication protocol, crash semantics and non-Git baseline handling. Those results **must not be attributed to the reviewed head**.

Required on the final reviewed SHA:

1. GitHub CI / `npm run verify:pr`.
2. `openspec validate --all --strict --no-interactive --report full`.
3. `npm run test:real-provider`.
4. `npm run test:real-provider-race`.
5. `npm run test:real-provider-restart`.
6. The Qdrant crash lifecycle test, now checking changed-path current-or-NOT_READY semantics rather than immutable-collection alias publication.
7. `npm run test:real-index-scale -- --files 100` (and the larger fixture when practical), recording cold/warm/no-change/edit-one-file reads, parses, embeddings and Qdrant mutations.

Still deferred:

- NAPI-vs-CLI symbol/range parity before making NAPI the default; the initial representative fixture currently reports range/export/symbol-class differences, so NAPI remains opt-in;
- Claw-style LSP lifecycle and removal of O(indexed source bytes) semantic-snapshot refresh;
- real cross-process Qdrant concurrency acceptance;
- Aider RepoMap and the token-budgeted ContextAssembler;
- provider-measured Hermes native-vs-ACE A/B.

No production-readiness, quality-parity or token-savings claim follows from this PR.
