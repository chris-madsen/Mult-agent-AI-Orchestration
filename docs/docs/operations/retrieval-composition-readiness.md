# Retrieval replacement foundation readiness

> Status: implementation PR only. This is the first infrastructure slice of the Aider/Claw retrieval-composition plan; it is **not** the finished composition and makes no production or token-savings claim.

## Implemented here

- `@ast-grep/napi@0.51.0` parses JS/TS/TSX in-process where the new symbol extractor has verified outline parity.
- `ACE_AST_GREP_PROVIDER=napi|auto` is an explicit migration mode. The already-existing **batched CLI remains the default** until NAPI symbol coverage has real-repository parity evidence. In `auto`, NAPI is used only for the currently covered JS/TS/TSX subset and CLI remains the fallback for CSS/HTML and other registered languages. A bundled NAPI grammar alone is not treated as extraction support.
- Warm index reuse is bound to source digest, parser identity and scope identity; the linear candidate accumulator and batched extraction already on `main` are preserved.
- `@qdrant/js-client-rest@1.20.0` owns probe, collection/alias lifecycle, query, upsert, snapshot count/membership verification and vector-reuse scrolls on the runtime path. Direct SDK response shapes are not confused with the legacy REST envelope; authenticated runtimes no longer fall back to unauthenticated raw HTTP during snapshot verification.
- Existing `ACE_RETRIEVAL_STRATEGY=dense` remains the first planned strategy: no sparse worker is started and dense-only collections do not create or require sparse vectors.
- `src/application/ast-grep-parity.ts` and `scripts/ast-grep-provider-parity.ts` now produce a digest-bound CLI/NAPI symbol/range comparison. The representative frozen TypeScript fixture is equivalent after normalizing export declaration ranges, enum-member kinds, and UTF-8 name anchors. The production default remains CLI because the real-repository gate is still blocked.
- `WorkspaceSync` owns serialized workspace refresh state, generation/index identity, manifest race rejection, and the rebuild/publish transition. Git workspaces use bounded NUL-delimited change metadata; non-Git workspaces use a size+mtime metadata walk as a cheap detector. Exact reads remain authoritative before index mutation. The host-worktree helper carries the same typed operation.
- Synchronized queries materialize the current retrieval manifest from the previous verified manifest + Git path delta + exact reads of affected retrieval-relevant files. They no longer require a recursive content-hashing snapshot on either the no-change path or the changed-path structural rebuild.
- An already-indexed dirty file is re-read but does not trigger a rebuild when its digest is unchanged; a HEAD-only change advances the sync baseline without rebuilding. The legacy full-snapshot path remains only for initial cold verification and contexts without `WorkspaceSync`.

## Explicitly deferred

- **Aider RepoMap evidence**: the current branch now has a provenance-bound structural/LSP def-ref adapter, deterministic PageRank-style ranking, bounded rendering, and an optional Qdrant prior. Real-repository graph evidence and agent-facing quality evidence are still required before calling this production-ready.
- **Claw LSP evidence**: the current branch now has a workspace-keyed lazy/refcount registry, reusable LSP session, didOpen/didChange/didClose refresh, and one cleanup owner while retaining `vscode-jsonrpc`. Claw action parity, non-TS provider evidence, crash/restart evidence and agent-facing proof remain open.
- **Stable per-path Qdrant mutation:** the synchronized incremental path uses one stable workspace/embedding/retrieval-schema collection. Changed paths publish new points before pruning older path versions; deleted/empty paths are removed; cold/restart publication upserts the complete current snapshot before pruning all older workspace versions. This prevents embedding/upsert failure from destroying the last known-good vectors. Cross-process concurrency and real crash/restart evidence on the reviewed head remain required before production claims.
- **LSP refresh I/O**: initial publication still exact-reads the indexed source set, but verified unchanged files are reused across incremental publication and the active LSP session receives only changed/open/close document notifications. Measured large-workspace I/O and race evidence remain open.
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

- NAPI-vs-CLI symbol/range parity before making NAPI the default; the frozen representative fixture passes, while the current `src` comparison remains `BLOCKED` with 125 files and 1,386 differences (`missing_from_cli=809`, `missing_from_napi=462`, `range_mismatch=114`, `syntax_mismatch=1`), so NAPI remains opt-in;
- real-provider/agent evidence for the LSP registry and measured large-workspace refresh I/O;
- real cross-process Qdrant concurrency acceptance;
- real-repository/agent evidence for RepoMap and ContextAssembler source-priority behavior;
- provider-measured Hermes native-vs-ACE A/B.

No production-readiness, quality-parity or token-savings claim follows from this PR.

## Current B1 NAPI parity evidence — runtime SHA `26cd8ef950230c7d7ef10f42fc4f2654d8481760`

- Frozen parity — `PASS`: `equivalent=true`, matching source digest and zero differences for `test/fixtures/ast-grep-parity/representative.ts`.
- NAPI contracts — `21/21 PASS`; CLI structural contracts and parity comparator contracts pass.
- B1 fixes now align NAPI import records with CLI `module` identity and suppress type-alias object fields that the CLI does not expose.
- Real repository parity — `BLOCKED`: `npm exec -- tsx scripts/ast-grep-provider-parity.ts src` reports the discrepancy counts above; no broad normalization is used to hide them.
- `npm run test:real-same-name` — `PASS` on runtime SHA `26cd8ef`; CLI remains the production default and RepoMap work remains gated on B1 closure.

## Current PR-A evidence

Evidence below was collected against reviewed runtime SHA `4e44252db0fa63305398d87a96bde5e410e183f2` with `sourceCleanAtBuild=true` and local Qdrant `qdrant/1.19.2`:

- `npm run test:real-provider` — `PASS`; current citation `service.ts:1-25`, `complete=true`, exact expansion verified.
- `npm run test:real-provider-race` — `PASS`; outcome `reconciled-current`: when the source changes during the request, delivered evidence is the changed digest rather than the old digest mislabeled as current.
- `npm run test:real-provider-restart` — `PASS`; cold generation, warm reuse and changed-source stable-collection mutation all passed.
- `npm run test:real-index-scale -- --files 100` — `PASS`; cold/warm/change-only phases passed with `deltaAdded=1`, `deltaChanged=10`, `deltaDeleted=1`, `deltaRenamed=1`.
- `npm run test:real-qdrant-crash` — `PASS`; interrupted writer, alias safety, reconciliation, restart publication and stable collection reuse passed.
- `npm run test:real-qdrant-concurrency` — `BLOCKED` on the latest run by local Qdrant `HTTP 500 Internal Server Error`; the runner must remain blocked rather than treating the failure as successful convergence.
- `npm run test:real-non-ts-lsp` — `BLOCKED`: configured `rust-analyzer` is unavailable; no non-TypeScript parity claim is made.
- `npm run test:real-same-name` — not rerun for this PR-A slice; the existing tracked report remains historical.

These provider results do not close NAPI real-repository parity, RepoMap quality, Claw lifecycle parity, ContextAssembler quality, Harbor A/B, production readiness or token-savings claims.

## Current R1 Qdrant boundary

- `makeQdrantCodeCandidatePort` and the collection/alias/count/scroll/membership helpers now use the official `@qdrant/js-client-rest` client; no Qdrant `http.request` branch remains in `src/adapters/qdrant-context-provider.ts`.
- The SDK boundary still validates the declared destination against the local-only policy before every operation; transport consolidation did not move authorization out to callers.
- `src/bin/ace-mcp.ts` and `scripts/qdrant-hybrid-rank-probe.ts` pass the authenticated SDK client plus the policy-bound local endpoint; direct contracts use SDK-shaped doubles.
- The later direct-stable-collection change removed alias publication from the replacement runtime. Full current-snapshot publication may prune older workspace versions only after exact current-key membership, completed SDK mutation status and the generation fence `generation < currentGeneration` are proven. Here `generation` is the persisted workspace observation epoch advanced through the workspace-store CAS path, not an alias or `index_key`; mixed-key warm reuse does not perform workspace-wide cleanup.
- Current reviewed runtime SHA `8867d94e3ebadf917e26bd9a24dd0dff8e354309` passed full `npm run verify:pr` (`633/633` TypeScript tests, Hermes context plugin `20/20`, ESLint, build and clean runtime provenance) and OpenSpec validation (`9/9 PASS`).
- The `2a58463` runs below are historical because later production fixes changed stable cleanup fencing and SDK mutation postconditions. They are not used as final R4 acceptance evidence.
- Current real-provider evidence is retained below for the final direct-stable implementation; production readiness, NAPI parity, RepoMap/LSP/ContextAssembler conformance, Harbor A/B and token-savings claims remain open.

## Historical R4 direct stable publication evidence — SHA `2a58463dab7c1f0483e704e526939d64c5abe1ec`

- `npm run test:real-provider` — `PASS`; source citation and exact expansion verified for that SHA.
- `npm run test:real-provider-race` — `PASS`; outcome `reconciled-current` for that SHA.
- `npm run test:real-provider-restart` — `PASS`; warm reuse, changed-source rebuild and direct stable collection identity verified; `publication_mode=stable_collection_direct`.
- `npm run test:real-index-scale -- --files 100` — `PASS`; cold/warm/change-only phases completed with current citations and the expected add/change/delete/rename deltas for that SHA.
- `npm run test:real-qdrant-crash` — `PASS`; interrupted publication retained direct stable collection identity, current-or-NOT_READY semantics and restart recovery for that SHA.
- `npm run test:real-qdrant-concurrency` — `PASS`; same-snapshot concurrent writers converged on one direct stable collection/index key/provider fingerprint with no duplicate collection.
- These historical results do not validate the later generation-fenced cleanup or strict mutation-result checks and do not close NAPI real-repository parity, RepoMap/LSP/ContextAssembler conformance, Harbor A/B, production readiness or token-savings claims.

## Current R4 direct stable publication evidence — runtime SHA `8867d94e3ebadf917e26bd9a24dd0dff8e354309`

- `npm run test:real-provider` — `PASS`; current citation `service.ts:1-25`, exact expansion and `complete=true` verified.
- `npm run test:real-provider-race` — `PASS`; outcome `reconciled-current`.
- `npm run test:real-provider-restart` — `PASS` on runtime SHA `5a85b44`; warm reuse, changed-source rebuild and direct stable collection identity verified.
- `npm run test:real-index-scale -- --files 100` — `PASS` on runtime SHA `1efc987`; cold/warm/change-only phases passed with current citations and add/change/delete/rename deltas.
- `npm run test:real-qdrant-crash` — `PASS`; interrupted writer, direct stable collection identity, current-or-NOT_READY semantics and restart recovery verified.
- `npm run test:real-qdrant-concurrency` — `PASS`; concurrent writers converged on one direct stable collection, index key and provider fingerprint without duplicate collections.
