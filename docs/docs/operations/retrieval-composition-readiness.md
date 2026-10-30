# Retrieval replacement foundation readiness

> Status: implementation PR only. This is the first infrastructure slice of the Aider/Claw retrieval-composition plan; it is **not** the finished composition and makes no production or token-savings claim.

## Implemented here

- `@ast-grep/napi@0.51.0` parses JS/TS/TSX in-process where the new symbol extractor has verified outline parity.
- `ACE_AST_GREP_PROVIDER=napi|auto` remains an explicit migration/research setting, but the active `auto` route now uses the official **batched CLI outline** until a ready NAPI outline-level implementation exists. NAPI is not used as a silent fallback or as a second production extractor. A bundled NAPI grammar alone is not treated as extraction support.
- Warm index reuse is bound to source digest, parser identity and scope identity; the linear candidate accumulator and batched extraction already on `main` are preserved.
- `@qdrant/js-client-rest@1.20.0` owns probe, collection/alias lifecycle, query, upsert, snapshot count/membership verification and vector-reuse scrolls on the runtime path. Direct SDK response shapes are not confused with the legacy REST envelope; authenticated runtimes no longer fall back to unauthenticated raw HTTP during snapshot verification.
- Existing `ACE_RETRIEVAL_STRATEGY=dense` remains the first planned strategy: no sparse worker is started and dense-only collections do not create or require sparse vectors.
- `src/application/ast-grep-parity.ts` and `scripts/ast-grep-provider-parity.ts` now produce a digest-bound CLI/NAPI symbol/range comparison. The representative frozen TypeScript fixture is equivalent after normalizing export declaration ranges, enum-member kinds, and UTF-8 name anchors. The production default remains CLI because the real-repository gate is still blocked.
- `WorkspaceSync` owns serialized workspace refresh state, generation/index identity, manifest race rejection, and the rebuild/publish transition. Git workspaces use bounded NUL-delimited change metadata; non-Git workspaces use a size+mtime metadata walk as a cheap detector. Exact reads remain authoritative before index mutation. The host-worktree helper carries the same typed operation.
- Synchronized queries materialize the current retrieval manifest from the previous verified manifest + Git path delta + exact reads of affected retrieval-relevant files. They no longer require a recursive content-hashing snapshot on either the no-change path or the changed-path structural rebuild.
- An already-indexed dirty file is re-read but does not trigger a rebuild when its digest is unchanged; a HEAD-only change advances the sync baseline without rebuilding. The legacy full-snapshot path remains only for initial cold verification and contexts without `WorkspaceSync`.

## Explicitly deferred

- **Aider RepoMap evidence**: the branch has an isolated provenance-bound LSP-to-graph adapter, deterministic PageRank-style ranking and bounded rendering, but that adapter is **not** wired into production composition because it would require a full-workspace per-candidate LSP scan. Runtime RepoMap remains `NOT_READY` until a structural def/ref owner is adapted; real-repository graph evidence and agent-facing quality evidence remain open.
- **Claw LSP evidence**: the branch has typed descriptors, lazy generation-bound/refcount leases, terminal awaitable shutdown, restart from the last confirmed file set, and `vscode-jsonrpc` transport. Publication no longer health-probes by starting the server eagerly: provider identity/configuration is checked at publish time, while the process starts only when a bounded semantic request actually needs it. Production still isolates semantic generations rather than mutating a published session in place. Claw one-process-per-workspace/server optimization, action parity, non-TS provider evidence, crash/restart evidence and agent-facing proof remain open.
- **Stable per-path Qdrant mutation:** the synchronized incremental path uses one stable workspace/embedding/retrieval-schema collection. Changed paths publish new points before pruning older path versions; deleted/empty paths are removed; cold/restart publication upserts the complete current snapshot before pruning all older workspace versions. This prevents embedding/upsert failure from destroying the last known-good vectors. Cross-process concurrency and real crash/restart evidence on the reviewed head remain required before production claims.
- **LSP refresh I/O**: the low-level semantic session supports didOpen/didChange/didClose refresh and crash restart, but production publication currently stages a generation-bound session from the verified source set to preserve rollback and concurrent-request freshness. Reusing one process safely across committed generations without mutating live old-generation requests remains an explicit optimization/evidence gap.
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

- NAPI-vs-CLI symbol/range parity before making NAPI the default; the frozen representative fixture passes, while the current `src` comparison remains `BLOCKED` with 125 files and 1,409 differences (`missing_from_cli=827`, `missing_from_napi=465`, `range_mismatch=116`, `syntax_mismatch=1`), so NAPI remains opt-in;
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
- `npm run test:real-same-name` — `PASS` on runtime SHA `26cd8ef`; CLI remains the production provider. RepoMap remains gated by the approved plan's structural evidence requirement, not by silently promoting NAPI.

## PR #187 retrieval follow-up — deterministic fixes pending final-head evidence

These changes are committed in PR #187 but are not attributed to the historical `26cd8ef950230c7d7ef10f42fc4f2654d8481760` evidence and do not close any real-provider or production gate:

- Active structural runtime uses the official CLI outline path for `provider=auto`; explicit NAPI remains experimental parity research.
- The current structural extractor exposes declaration outlines but not Aider-style reference tags. An edge-less outline is therefore **not** published as a ready RepoMap, and production composition does **not** substitute a full-workspace LSP reference scan: that would invert the approved order and create `O(N × LSP)` work. Runtime RepoMap remains `NOT_READY` until structural def/ref extraction is adapted; LSP enrichment stays bounded to Qdrant-selected candidates. Aider parity remains open.
- RepoMap ranking carries observed reference frequency, open-file/query personalization and grouped source rendering with an Aider-derived attribution comment. The pinned Aider behavioral fixture and real-repository/agent quality gates remain open.
- LSP server descriptors are typed, but publication remains generation-bound: a new semantic snapshot is staged under its own lease and only replaces the prior lease after the retrieval publication commits. A crashed lazy runtime restarts from the last successfully confirmed file set. This preserves freshness/rollback correctness while fuller Claw lifecycle parity remains open.
- LSP registry now carries a typed server descriptor, rejects same-key configuration collisions, and exposes **leased/ref-count** registry state. It does not label a lazy, uninitialized process as `ready`; runtime health is proven only by bounded semantic operations when the resolved source plan actually requests LSP.
- ContextAssembler enforces bounded `code`, `repo_map`, `lsp` and `other` sections while retaining exact-source receipts and lossless expansion. The current counter remains estimated; model-aware counting and composed context evidence remain open.
- The Qdrant context adapter can consume a RepoMap provider, but production composition does not inject one until a structural def/ref graph owner exists. Any injected/test RepoMap evidence is fail-closed as `unknown` until every rendered source is exact-reread at the request boundary; structural coverage cannot be `satisfied` merely because Qdrant returned code hits.
- Qdrant coverage degradation now uses the resolved `includeCode` default when marking incomplete index coverage, so omitted `include_code` cannot turn failed indexed paths into a false complete bundle.

## PR #188 R2 shared structural-record slice — pending final-head evidence

This PR is deliberately scoped to the R2 record boundary. It does not activate a production RepoMap implementation and does not close Aider parity, LSP lifecycle, real-provider, production-readiness, quality-parity or token-savings gates.

- Active structural runtime still uses the official ast-grep CLI outline path for `provider=auto`; explicit NAPI remains experimental parity research.
- The canonical per-file `StructuralAnalysis` can now carry optional identifier occurrences with exact byte ranges. The explicit NAPI provider collects those occurrences during the same already-existing tree traversal that produces declarations; the production CLI path is not given a second parse pass merely to manufacture reference data.
- Identifier coverage remains optional: the production CLI record leaves it `undefined`, while a provider that actually supplies occurrence coverage can return `[]` for a known-empty result or a non-empty byte-bound array. Absence is not converted into false empty coverage.
- `LocalCodeIndexBuild` retains those digest-bound structural records in path-keyed state and reuses the record only when the authoritative source digest still matches. This is preparatory R2 state for changed-path consumers; it is not evidence that all remaining index work is O(changed bytes).
- NAPI identifier occurrences are not claimed as full language-independent definition/reference parity. Grammar-specific node kinds, declaration/reference classification, cross-file binding, frozen CLI/NAPI parity and the eventual shared tag contract remain R2 gaps.
- Production RepoMap remains `NOT_READY` in this slice. The current custom graph/rank/render implementation is still the R3 deviation documented above and is not injected into the runtime until the pinned Aider graph/ranking/rendering behavior has a frozen comparison and the R2 tag contract is sufficient.
- This PR does not change the LSP lifecycle or termination policy. LSP remains optional bounded enrichment after candidate selection as established by the previous retrieval follow-up.
- Existing Qdrant, ContextAssembler and freshness behavior is unchanged by this R2 slice.

## PR #189 R5 generic diagnostics slice — reviewed deterministic evidence

This PR is deliberately scoped to generic LSP diagnostics and bounded provider lifecycle behavior. It does not activate RepoMap, close R2/R3/R6, or relabel historical provider artifacts as current evidence.

- Production RepoMap remains `NOT_READY` exactly as established by PR #188. No custom Aider-like graph/ranking/rendering path is injected by this slice.
- Pull diagnostics are selected from the server's `initialize` capability `diagnosticProvider`; a pull request uses the provider-advertised diagnostic identifier when present. Pull-capable servers are not forced to wait through a push-notification timeout first.
- Push `textDocument/publishDiagnostics` remains supported. Versioned notifications that do not match the current document version are ignored, and cached diagnostics are invalidated on didOpen/didChange/didClose so a refreshed source cannot inherit stale diagnostics.
- Caller `timeoutMs` remains the actual startup/identity deadline. Graceful TERM/KILL cleanup has its own bounded grace window rather than silently raising the requested operation timeout.
- The non-TypeScript conformance script requires definition, references, hover **and non-empty diagnostics** for its invalid Rust fixture; a missing diagnostics result is a failed gate, not `provider-partial` success.
- The previously generated non-TypeScript report from pre-fix SHA `65aec6f...` is intentionally not retained as final-head evidence. `npm run test:real-non-ts-lsp` must be rerun on the reviewed final SHA where rust-analyzer is available.
- Deterministic runtime evidence at code head `f15b8c0f74ba0f4d8e7901b15db393a30b01c54d`: GitHub Actions run `40826931580` passed the affected selector (`4` changed files → `4` test files), `17/17` TypeScript tests, `tsc --noEmit`, ESLint, build, clean compiled-runtime provenance, isolated Bifröst tests and `go vet`. Full `verify:pr`, documentation/evidence verification and the real non-TypeScript provider command were not run on that head.
- Full Claw lifecycle parity remains open: one process per workspace/server-language group, source-generation separation from process identity, serialized refresh/query or equivalent generation fencing, crash/restart evidence and agent-facing semantic evidence are not claimed here.

## Historical PR-A evidence — runtime SHA `4e44252db0fa63305398d87a96bde5e410e183f2`

Evidence below predates the later PR #187 lifecycle, lazy-LSP and source-plan fixes. It remains historical evidence for that runtime and must not be treated as acceptance evidence for the final PR #187 head. The run used `sourceCleanAtBuild=true` and local Qdrant `qdrant/1.19.2`:

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
- Runtime SHA `8867d94e3ebadf917e26bd9a24dd0dff8e354309` passed full `npm run verify:pr` (`633/633` TypeScript tests, Hermes context plugin `20/20`, ESLint, build and clean runtime provenance) and OpenSpec validation (`9/9 PASS`). That remains Qdrant-boundary component evidence, not acceptance evidence for the later PR #187 runtime.
- The `2a58463` runs below are historical because later production fixes changed stable cleanup fencing and SDK mutation postconditions. They are not used as final R4 acceptance evidence.
- Real-provider evidence retained below validates the direct-stable Qdrant implementation at its recorded SHAs. It does not validate the later PR #187 LSP/source-plan/context-composition changes; production readiness, NAPI parity, RepoMap/LSP/ContextAssembler conformance, Harbor A/B and token-savings claims remain open.

## Historical R4 direct stable publication evidence — SHA `2a58463dab7c1f0483e704e526939d64c5abe1ec`

- `npm run test:real-provider` — `PASS`; source citation and exact expansion verified for that SHA.
- `npm run test:real-provider-race` — `PASS`; outcome `reconciled-current` for that SHA.
- `npm run test:real-provider-restart` — `PASS`; warm reuse, changed-source rebuild and direct stable collection identity verified; `publication_mode=stable_collection_direct`.
- `npm run test:real-index-scale -- --files 100` — `PASS`; cold/warm/change-only phases completed with current citations and the expected add/change/delete/rename deltas for that SHA.
- `npm run test:real-qdrant-crash` — `PASS`; interrupted publication retained direct stable collection identity, current-or-NOT_READY semantics and restart recovery for that SHA.
- `npm run test:real-qdrant-concurrency` — `PASS`; same-snapshot concurrent writers reported the same deterministic stable collection name, index key and provider fingerprint. The runner did not enumerate all collections, so this is not proof that no other collection existed.
- These historical results do not validate the later generation-fenced cleanup or strict mutation-result checks and do not close NAPI real-repository parity, RepoMap/LSP/ContextAssembler conformance, Harbor A/B, production readiness or token-savings claims.

## R4 direct stable publication component evidence — runtime SHA `8867d94e3ebadf917e26bd9a24dd0dff8e354309`

- `npm run test:real-provider` — `PASS`; current citation `service.ts:1-25`, exact expansion and `complete=true` verified.
- `npm run test:real-provider-race` — `PASS`; outcome `reconciled-current`.
- `npm run test:real-provider-restart` — `PASS` on runtime SHA `5a85b44`; warm reuse, changed-source rebuild and direct stable collection identity verified.
- `npm run test:real-index-scale -- --files 100` — `PASS` on runtime SHA `1efc987`; cold/warm/change-only phases passed with current citations and add/change/delete/rename deltas.
- `npm run test:real-qdrant-crash` — `PASS`; interrupted writer, direct stable collection identity, current-or-NOT_READY semantics and restart recovery verified.
- `npm run test:real-qdrant-concurrency` — `PASS`; concurrent writers reported the same deterministic stable collection name, index key and provider fingerprint. The run did not prove global absence of other collections.

## Historical branch-only observations — SHA `9512d379da892736dfb4375b4fe4ba191390c180`

The retained machine-readable file is `benchmarks/reports/real-retrieval-gates-9512.json`. It records operator-reported observations from a clean checkout and a reported runtime bundle built with task image `ace-local-hermes:ace-local-smoke-paired-fast@sha256:c0529227d3303b66115cd246d39c552cb591eed58c906d412e7883824d294dbc`, bundle SHA `13ffea031a86b6e3ab2b4b6cbda72b545f25c4ebd31f26359e8797f08805d785`, Python `3.11`, Pillow `11.3.0`, FastEmbed `0.7.4` and ONNX Runtime `1.23.2`.

This is not acceptance-eligible evidence: the run timestamp, exact commands actually executed, request/correlation IDs, raw stdout/stderr digests and bundle manifest were not retained. The source SHA is an intermediate historical branch commit and is not an ancestor of current `main`. The statuses below therefore describe observations only and must not be promoted to current-main gate results.

- Real dense provider smoke — observed pass: current citation `service.ts:1-25`, `complete=true`, exact expansion `63482` bytes.
- Provider outage — observed honest `NOT_READY`; no outage was reported as an empty successful result.
- Provider restart — observed pass: generations `1/2/3`, warm reuse, changed-source rebuild and direct stable collection reuse.
- Index scale 100 — observed pass: cold/warm/change-only phases, `100` warm reused vectors, `97` unchanged reuse and add/change/delete/rename deltas.
- Qdrant crash — observed pass: interrupted writer recovery, current-after-crash semantics, restart publication and stable collection reuse on Qdrant `1.19.2`.
- Qdrant concurrency — observed pass: both requests complete, current citations and converged index/provider fingerprints; both writers reported the same deterministic stable collection name.
- Provider race — `BLOCKED`: the bounded race runner did not complete and was killed; this is not a provider PASS.
- Harbor paired and matched Hermes gates — `BLOCKED`: generated native/ACE job paths, paired artifact and exact-current experiment binding are still absent.

All provider acceptance gates remain `BLOCKED` until the commands are rerun on a reviewed current head with the required raw bindings retained. These observations do not close Aider parity, full Claw parity, model-aware token counting, agent-E2E, Harbor/Hermes benchmark acceptance, production readiness or token-savings claims.

## Historical current-main runtime observations — runtime SHA `34816d17fb51f6b9706a188d7a4e5d0177968886`

The machine-readable summary is `benchmarks/reports/real-retrieval-gates-34816d1.json`. The runtime bundle is bound to clean source SHA `34816d17fb51f6b9706a188d7a4e5d0177968886`, but the provider commands ran before their runner changes were committed. The runner commit/clean state and final raw concurrency traces were not retained, so these are historical observations rather than acceptance-eligible current-head evidence.

A fresh runtime bundle was built from the same clean SHA with bundle SHA `60dfb180797e7c244d0c8be3ff01157eca5be5d55d22651ed19fc2a18813048d`, task image `ace-local-hermes:ace-local-smoke-paired-fast@sha256:c0529227d3303b66115cd246d39c552cb591eed58c906d412e7883824d294dbc`, Python `3.11`, Pillow `11.3.0`, FastEmbed `0.7.4` and ONNX Runtime `1.23.2`.

- Provider smoke — `PASS`: current citation `service.ts:1-25`, `complete=true`, expansion `63482` bytes.
- Provider race — `PASS`: `reconciled-current`, `complete=true`.
- Provider outage — `PASS`: honest `NOT_READY` provider failure.
- Provider restart — `INVALIDATED`: the old runner sent `SIGTERM` but started the next generation without awaiting process exit, so the observed sequence does not prove a real restart boundary.
- Index scale 100 — `PASS`: cold/warm/change-only/rename/delete/untracked fixture; content index-key transition and changed-source digest were verified.
- Qdrant crash — observed pass: stable collection retained across failpoint `SIGKILL`, reader reconciled current source, and restart published S2. The original runner hashed traces before provider shutdown.
- Qdrant concurrency — observed pass: two writers completed with current citations and converged index/provider fingerprints; both reported the same deterministic stable collection name. This does not prove global absence of other collections. The summary is `benchmarks/reports/real-qdrant-concurrency-34816d1.json`; final raw traces were not retained.
- Same-name LSP — `PASS`: DBC-04 with ast-grep `0.51.0` and TypeScript Language Server `6.0.2`.
- Non-TypeScript LSP — `BLOCKED/FAIL`: Rust Analyzer returned `EXTERNAL_UNAVAILABLE: content modified` during the definition query; no non-TypeScript conformance PASS is claimed.
- Runner hardening — `BLOCKED` for this historical run: source/runtime binding was exercised, but the executing runner itself was not bound to a committed clean worktree.
- Harbor/Hermes — `NOT_RUN`: exact-current native/ACE job directories and model-bound experiment binding are absent.

The earlier separate-runtime attempt was blocked before provider execution because the old current-main runners launched source-worktree `dist/bin/ace-mcp.js` while `ACE_RUNTIME_ROOT` pointed at the bundle. The current runner slice fixes that path and now records runner provenance, waits for bounded process-tree shutdown, and hashes traces only after provider exit. The observations above must be rerun on the final committed runner before promotion; they do not close Aider parity, full Claw parity, model-bound Hermes, Harbor, production readiness or token-savings claims.
