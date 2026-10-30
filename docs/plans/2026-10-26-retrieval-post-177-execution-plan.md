# Execution plan: finish the Aider + Claw retrieval composition after PR #177

> **2026-10-30 owner clarification:** For named upstream components, *reuse the actual working, appropriately licensed functions and their tested behavior*. “Port/adapt” means a narrow, traceable translation or wrapper of real source code, not re-deriving algorithms from a summary and calling the result Aider/Claw-compatible. For Rust Claw → TypeScript, reuse only source whose license/provenance permits it; preserve `vscode-jsonrpc` instead of copying Claw framing. No unapproved Python/Rust sidecar or model-tokenizer rewrite. This clarification does not change current implementation or acceptance status.

> **2026-10-27 update:** The original A–E queue below describes the post-#177 starting point. Read the [repository-wide reuse audit and remediation queue](#2026-10-27-addendum--repository-wide-reuse-audit-and-remediation-queue) before new work; it records the inspected post-#183 baseline, remaining deviations, adjacent candidates, and the updated dependency order. Findings and replacement choices are not production acceptance.


**Date:** 2026-10-26  
**Status:** EXECUTION-READY  
**Baseline:** `main@b8f17c8efb6997bc704b21894e307b135410b28a` (includes merged PR #177)  
**Parent architecture plan:** `docs/plans/2026-10-26-aider-claw-retrieval-composition-plan.md`  
**Goal:** turn the PR #177 foundation into one small, working retrieval path: changed-only indexing, real Aider RepoMap, Claw-style LSP lifecycle, exact freshness verification and one token-budgeted context assembler.

This document is written for the implementation agent. Follow the PR order below. Do not jump ahead by adding parallel frameworks or placeholder abstractions.

---

## 0. Current state after PR #177

PR #177 correctly established only the foundation:

- official `@qdrant/js-client-rest@1.20.0` is available on the runtime path;
- dense mode does not require sparse worker;
- `@ast-grep/napi@0.51.0` exists as an opt-in migration path;
- batched ast-grep CLI remains the safe default until real NAPI parity is proven;
- NAPI positions are normalized to ACE UTF-8 byte contracts;
- warm index reuse is bound to structural parser fingerprint + scope identity;
- Qdrant count/scroll verification and prior-vector reuse can use the authenticated SDK;
- `embedding_key` is actually requested for content-addressed vector reuse.

What is **still wrong / unfinished** on current main:

- `src/adapters/qdrant-context-provider.ts` is ~68 KB / ~1,528 lines and still owns too many concerns;
- `makeQdrantContextProvider().search()` still calls `files.snapshot(...)` on the query hot path;
- `src/adapters/node-workspace-port.ts` snapshot still performs repository-wide observation/hashing;
- `buildLocalCodeIndex()` still starts from a full workspace snapshot;
- current collection lifecycle is still snapshot-oriented rather than a simple changed-file ingest model;
- no real Aider RepoMap exists;
- NAPI has not yet proven symbol/range parity against the existing CLI on representative repositories;
- LSP is still the existing bespoke lifecycle in `src/adapters/lsp-semantic.ts`;
- no single small ContextAssembler owns the final token budget;
- no provider-measured Hermes native-vs-ACE win has been demonstrated.

The next work must **replace**, not stack on top of, these owners.

---

# Non-negotiable implementation rules

1. **One PR = one behavioral step.** Do not combine RepoMap + freshness + LSP + context delivery in one giant PR.
2. **No new benchmark framework.** Use existing tests/scripts and add only focused regressions needed by the changed owner.
3. **No fake feature naming.** A lexical boost is not RepoMap; a registry wrapper is not Claw LSP; a mock Qdrant response is not real-provider proof.
3a. **Source-code reuse is required before new algorithm code.** Pin original working functions, inspect their tests/license, and adapt their implementations faithfully. For Aider this includes ranking/rendering, not merely mimicking a few weights. For LSP, prefer permitted Claw discovery/lifecycle implementations and existing standard Node/Effect libraries. A from-scratch implementation requires recorded evidence and explicit owner approval.
4. **No parallel permanent old/new paths.** Transitional compatibility is allowed only when there is an explicit deletion point in the next PR.
5. **Dense first.** Do not reintroduce sparse/RRF/reranker as a dependency until dense retrieval has real measured evidence that it is insufficient.
6. **Freshness is fail-closed.** Never label stale source as current.
7. **Agent-side native context features remain intact.** ACE changes provider-bound context, not durable agent transcript ownership.
8. **No token-economy claim without provider usage.**
9. **After each phase, prefer negative diff.** If a new owner replaces an old owner, delete the old owner in the same or immediately following PR.
10. **Do not change Bifröst/Hermes architecture in these PRs.** This queue is retrieval-only.

---

# PR A — changed-only workspace sync + incremental Qdrant index

## Objective

Remove the most expensive architectural mistake still present after #177:

```text
query
  -> files.snapshot(all repo files)
  -> hash/read repository
  -> reconcile
  -> search
```

Replace it with:

```text
query
  -> cheap changed-path observation
  -> reindex only changed paths
  -> Qdrant search
  -> exact reread/hash only selected evidence
```

This PR must finish the remaining part of Phase 1 / Phase 3 from the parent plan before RepoMap is added.

## New ownership boundary

Introduce one small application-level owner, e.g. `WorkspaceSync` (name may vary, but there must be one owner):

```ts
interface WorkspaceSync {
  initialize(): Promise<WorkspaceSyncState>;
  observeChanges(): Promise<WorkspaceDelta>;
  readChanged(paths: readonly RepoPath[]): Promise<ChangedSource[]>;
}
```

The important point is the behavior, not the exact type names.

### WorkspaceSync must do

For Git workspaces:

- remember current HEAD;
- run a cheap Git status/path observation before query;
- detect added/modified/deleted/renamed paths;
- if HEAD changes, use Git diff/path metadata to find affected paths;
- treat filesystem watcher events only as wake-up hints, never as sole truth;
- exact-read/hash only changed paths before accepting them into the index.

For non-Git workspaces:

- use cached `size + mtime` as a cheap detector;
- hash only paths whose cheap state changed.

## File state

Maintain one compact record per indexed file:

```ts
type FileState = {
  repoPath: RepoPath;
  sizeBytes: number;
  mtimeMs?: number;
  contentHash: ContentDigest;
  parserFingerprint: string;
  candidateIds: readonly CandidateId[];
};
```

Do not invent a distributed metadata service. Reuse the existing local state/artifact infrastructure if possible. If persistence needs a new store, keep it local and atomic.

## Qdrant change

Move from “new immutable collection for every source snapshot” toward one stable collection per:

```text
workspace + embedding identity + retrieval schema
```

Use deterministic point IDs from stable evidence identity, for example:

```text
workspace + path + contentHash + byteRange
```

For changed paths:

- delete points belonging to the previous path version;
- parse changed source;
- embed only new/changed symbol chunks;
- upsert them;
- remove deleted-path points;
- handle rename as delete old + ingest new unless a safe cheaper identity is proven.

Do not scroll/copy the entire prior collection merely to update one changed file.

## Hot-path freshness

Before delivery:

- reread only files represented by selected Qdrant hits;
- compare exact current digest with payload digest;
- if a selected hit is stale:
  1. reindex that path synchronously;
  2. retry retrieval at most once;
  3. if still racing, return truthful partial/not-ready rather than stale current evidence.

## Current files to change

Expected owners:

- `src/adapters/node-workspace-port.ts`
- `src/adapters/local-code-index.ts`
- `src/adapters/qdrant-context-provider.ts`
- `src/bin/ace-mcp.ts`
- Qdrant/index contracts already covering freshness and restart behavior.

Do **not** create a second independent workspace/index stack alongside these. Move ownership and delete superseded logic.

## Required regressions

Add/adjust focused tests for:

- unchanged query: zero full-repository content reads;
- one-file edit: one changed file parsed and embedded;
- add/delete/rename;
- missed watcher event caught by Git/status reconciliation;
- source modified between Qdrant result and delivery is rejected/reindexed;
- authenticated Qdrant path stays on official SDK;
- warm startup does not re-embed unchanged content.

## Real gate before merge

Run existing gates, not a new harness:

```bash
npm run verify:pr
npm run test:real-provider
npm run test:real-provider-race
npm run test:real-provider-restart
npm run test:real-index-scale
```

For the scale run, record at minimum:

- cold index duration;
- warm startup duration;
- one-file edit duration;
- number of files reparsed;
- number of embeddings recomputed;
- number of Qdrant points upserted/deleted.

### Exit condition

A normal query must **not** call a full content-hashing workspace snapshot.

A one-file edit in a large repository must cause work proportional to that changed file plus selected evidence, not repository size.

---

# PR B — real Aider RepoMap + NAPI parity

## Objective

Implement a real structural prior based on Aider's RepoMap design, not a post-Qdrant lexical heuristic.

Source reference:

- `Aider-AI/aider@5dc9490bb35f9729ef2c95d00a19ccd30c26339c`
- `aider/repomap.py`
- Apache-2.0 attribution required for adapted algorithm/code.

## First: prove NAPI parity

Before making NAPI the default, compare NAPI output to the current batched CLI on representative JS/TS/TSX projects.

Compare at least:

- function/class/interface/type/enum names;
- top-level arrow functions;
- methods;
- imports/exports;
- exported status;
- UTF-8 byte ranges;
- syntax-error behavior.

Do not require byte-for-byte identical metadata if semantics are equivalent, but any symbol loss must be explained and covered.

### NAPI default switch rule

Only switch default from CLI to NAPI when:

- supported symbol classes have parity on frozen fixtures and at least one real repository;
- Unicode byte/range tests stay green;
- no material retrieval regression appears in the existing semantic retrieval E2E.

Until then, keep CLI default and NAPI opt-in.

## Shared symbol model

RepoMap and Qdrant must consume the **same parsed symbol records**.

Do not parse the same file twice for two subsystems.

Target shape:

```ts
type SymbolRecord = {
  repoPath: RepoPath;
  contentHash: ContentDigest;
  name?: string;
  kind: string;
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
  isExported?: boolean;
  definitions?: readonly SymbolRef[];
  references?: readonly SymbolRef[];
  text: string;
};
```

## Aider algorithm to adapt

Port/adapt the **working, pinned Aider source functions** (not only their ideas), with Apache-2.0 provenance and upstream parity; do not run or vendor the entire Aider CLI:

1. collect definition/reference tags;
2. build file/symbol relation graph;
3. rank importance with PageRank-style propagation;
4. personalize rank using:
   - currently open files;
   - explicitly mentioned files;
   - identifiers extracted from the query;
5. render the highest-value tree/symbol context under an explicit token budget.

The implementation must produce an actual repo-wide structural map/prior.

## Interface

Expose a small owner:

```ts
interface RepoMapProvider {
  update(delta: readonly SymbolDelta[]): Promise<void>;
  render(input: {
    query: string;
    openFiles: readonly RepoPath[];
    mentionedFiles: readonly RepoPath[];
    tokenBudget: number;
  }): Promise<RepoMapResult>;
}
```

Do not expose graph library internals to the context layer.

## Ranking role

RepoMap is a **prior**, not a replacement for Qdrant.

Recommended combination:

```text
RepoMap structural rank
        +
Qdrant semantic score
        ->
candidate merge/dedupe
```

Keep the structural contribution bounded. It should reorder close semantic hits, not bury a clearly stronger semantic result.

## Token budget

RepoMap output must have its own budget. Start around 20–30% of the total retrieval context budget and make that configurable.

Do not inject a full repository map.

## Tests

Required:

- frozen small graph where PageRank order is deterministic;
- query/open-file personalization changes rank predictably;
- token-budget rendering stops at the budget;
- identical changed-file delta updates only affected graph nodes;
- no lexical-only implementation can satisfy the RepoMap contract;
- compare representative output against Aider `--show-repo-map` behaviorally on a frozen fixture.

## Real gate

Use existing semantic E2E plus one real repository retrieval comparison.

Measure:

- whether expected file/symbol remains in top-K;
- how often RepoMap improves/worsens top-1/top-K;
- added tokens from map rendering.

Do not create a new multi-arm benchmark framework.

### Exit condition

There is a real def/ref graph + PageRank/token-budget map, and “RepoMap” no longer means string matching.

---

# PR C — replace bespoke LSP lifecycle with Claw #3016 design over vscode-jsonrpc

## Objective

Use the strongest parts of Claw Code's unmerged LSP design instead of continuing to grow ACE-specific process management.

Reference:

- Claw Code PR #3016
- head `5e7d7edb8e82782371f8747aca63e63412ccfca6`

Reuse the **actual, legally reusable** implementation and tests, translated only as needed for TypeScript/Node:

- `lsp_discovery.rs` descriptors, known server catalog, PATH discovery and hints;
- `lsp_client/` registry, status and lazy lifetime;
- `lsp_process/` document and action lifecycle;
- action/status model.

Retain concrete behavior and upstream test scenarios rather than rebuilding the subsystem from a prose description. Inspect standalone maintained Node LSP lifecycle clients before writing replacement lifecycle mechanics; if a compatible one exists, wrap it instead. Record the source license/provenance for each Claw file; do not copy reconstructed proprietary Claude/Anthropic sources without rights. **Do not** port Claw's hand-written stdio framing; keep `vscode-jsonrpc`.

## Target architecture

```text
LspServerDescriptor
  -> discovery / command / args / language ids
  -> lazy server registry
  -> one process per workspace + language/server
  -> vscode-jsonrpc transport
  -> didOpen/didChange/didClose
  -> hover/definition/references/etc
```

## First supported actions

Only wire actions retrieval actually needs:

- definition;
- references;
- hover/type information;
- diagnostics if already useful.

Do not wire completion/rename/code actions merely because Claw exposes them. Add them later when an agent workflow requires them.

## Query behavior

LSP must be on-demand:

```text
RepoMap + Qdrant
  -> top candidate symbols
  -> LSP enrichment only for those
```

A basic semantic retrieval must still work if LSP is unavailable.

## Process lifecycle

Required behavior:

- lazy start;
- reuse process across requests;
- initialize/initialized exactly once per process;
- open/change/close document state correctly;
- bounded request timeout;
- provider outage is degraded/partial, not global retrieval death;
- clean shutdown;
- no per-candidate process spawn.

## Delete/reduce targets

After the new owner works:

- shrink/replace lifecycle sections in `src/adapters/lsp-semantic.ts`;
- audit `src/adapters/typescript-language-service.ts`; if it is only a second path to the same semantic functionality, remove it;
- keep source/freshness contracts outside LSP.

## Regressions

- definition + references across two files;
- same process reused across multiple queries;
- didChange updates semantic answer;
- server crash/restart behavior;
- unavailable LSP leaves Qdrant/RepoMap evidence usable;
- Unicode URI/range handling;
- Windows/file URI semantics through standard library behavior where possible.

## Real gate

Use existing:

```bash
npm run test:real-same-name
npm run test:real-non-ts-lsp
npm run verify:pr
```

Add no new benchmark system.

### Exit condition

ACE has one understandable LSP lifecycle modeled after Claw's design, but protocol framing remains on a standard library.

---

# PR D — one ContextAssembler + decompose qdrant-context-provider

## Objective

Make context delivery the unique ACE value and stop one 68-KB provider from owning the whole retrieval system.

## Target boundary

Create one small retrieval contract:

```ts
retrieve({
  workspaceId,
  query,
  openFiles,
  mentionedFiles,
  tokenBudget,
  topK,
}) -> ContextBundle
```

Internally:

```text
WorkspaceSync
    |
    +-> changed-only AST/index update

RepoMap --------+
                |
Qdrant ---------+-> candidate merge/dedupe
                |
LSP ------------+-> optional enrichment
                |
Exact reread/hash
                |
ContextAssembler
                |
ContextBundle
```

## ContextAssembler responsibilities

Only:

- allocate token budget;
- merge/dedupe candidates by current source range;
- reserve a bounded RepoMap slice;
- choose exact code snippets;
- include minimal LSP relationships;
- attach source/path/range/hash provenance;
- stop when budget is reached;
- mark partial/incomplete truthfully.

It must **not** own:

- Qdrant collection creation;
- filesystem traversal;
- embedding worker lifecycle;
- LSP process lifecycle;
- Git status;
- benchmark persistence.

## Budget strategy

Start simple and explicit:

- RepoMap: at most ~25% of budget;
- exact source snippets: majority of budget;
- LSP relation summary: small bounded tail;
- no unconditional history inflation.

The exact percentages can be tuned later from evidence; do not build a policy engine now.

## Hermes / Bifröst rule

Do not mutate the agent's durable transcript.

Production request flow remains:

```text
agent native context processing
  -> Bifröst / ACE projection
  -> provider-bound request
```

Exactly one ACE projection per request.

## Decomposition target

By the end of this PR, `src/adapters/qdrant-context-provider.ts` should no longer own all retrieval behavior.

Desired small owners may be named differently, but responsibilities should roughly become:

```text
workspace-sync
ast/symbol index
repo-map
qdrant-index
lsp-semantic
context-assembler
```

Delete moved logic. Do not leave a facade that simply duplicates every old method indefinitely.

## `ace-mcp.ts`

Shrink it to composition/configuration:

- instantiate ports;
- resolve configuration;
- start/close providers;
- connect gateway/transport.

It should not implement repository reconciliation algorithms.

## Tests

- deterministic budget packing;
- dedupe same source reached from RepoMap + Qdrant + LSP;
- exact current-source verification;
- partial result when LSP is unavailable;
- no duplicate ACE projection;
- context bundle does not exceed budget.

### Exit condition

There is one small ContextAssembler, and the current giant provider/composition root has a meaningful negative diff.

---

# PR E — real evidence, Hermes A/B, then negative-diff cleanup

## Objective

Do not add another feature. Prove whether the composed retrieval actually helps.

## Real retrieval evidence first

Run the existing real-provider suite on the final composed path:

```bash
npm run test:real-provider
npm run test:real-provider-race
npm run test:real-provider-outage
npm run test:real-provider-restart
npm run test:real-semantic
npm run test:real-index-scale
npm run test:real-same-name
npm run test:real-non-ts-lsp
```

Record failures honestly. Do not classify a partially working run as production acceptance.

## One Hermes A/B

Only after real retrieval is green enough to be meaningful:

```text
A: Hermes native
B: Hermes native + one ACE gateway projection
```

Same:

- task;
- model;
- provider;
- repository state;
- tool permissions;
- success oracle.

Record:

- task success/correctness;
- provider input tokens;
- provider output tokens;
- provider cache fields if available;
- cost;
- retrieval latency;
- number of ACE retrieval calls;
- amount of context inserted/replaced.

Do **not** add 3-arm/4-arm infrastructure before this pair produces interpretable evidence.

## Decision rule

If ACE is better:

- repeat on a small holdout;
- inspect which parts provided the gain;
- only then consider tuning sparse/reranker.

If ACE is worse:

- diagnose one measured cause;
- fix that cause;
- rerun the same pair.

Do not respond by adding more architecture.

## Cleanup

Once the new path is proven:

- delete raw Qdrant HTTP runtime code superseded by SDK;
- delete snapshot-per-query/full-repository hashing path;
- delete old ast-grep CLI lifecycle if NAPI parity/default has been proven;
- delete duplicate LSP lifecycle/TypeScript semantic owner;
- delete obsolete benchmark glue tied only to superseded paths;
- reduce tests together with deleted owners, while keeping unique correctness/security regressions.

### Exit condition

The active retrieval path is smaller than before, works end-to-end, and has provider-measured evidence. If the codebase grows substantially without deleting superseded owners, the migration is not complete.

---

# Required PR discipline for the implementation agent

For every PR:

## PR body must state

1. **Which phase/PR in this document it implements.**
2. **What old owner it replaces.**
3. **What is deliberately deferred.**
4. **What code is deleted or scheduled for deletion in the immediately following PR.**
5. **Which real-provider evidence was actually run.**
6. **No unmeasured performance/token claim.**

## Do not merge when

- only mocks prove an integration that is supposed to be real;
- a new path silently falls back to stale/full-repo work while claiming incremental behavior;
- a feature name overstates the implementation;
- the PR adds a parallel framework with no deletion path;
- source freshness can race and still be marked current;
- CI is green but the required real-provider gate for that phase has not been run.

---

# Concrete “next task” for the agent

Start with **PR A only**.

Do not start Aider RepoMap yet.

The next implementation task is:

> Replace the query-time full workspace snapshot/hash reconciliation with a changed-path synchronization layer and incremental Qdrant updates, while preserving exact selected-file verification and fail-closed race handling.

The first code review question for the next PR is binary:

> **Does a normal retrieval query still read/hash every repository file?**

If yes, PR A is not finished.

The second question:

> **Does editing one file cause only that file's structural parse/embedding/Qdrant mutation, plus exact reads of selected evidence?**

If no, PR A is not finished.

Only after both answers are correct should the agent move to the real Aider RepoMap.

---

# 2026-10-27 addendum — repository-wide reuse audit and remediation queue

**Status:** audit and implementation plan; no remediation below is implemented or accepted by this document.
**Audited baseline:** main@b0b0d0d236deb9777606614fceffcbf8dec800c1 (merged PR #183).
**Separate in-flight change:** [PR #184](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/pull/184), head d8a65f9eb33dedd82e46704165e761eff8981db2, was open at inspection. It fixes workspace observation convergence; it does not establish RepoMap, LSP, gateway or benchmark conformance.

This addendum updates the original A–E queue after inspection of the delivered implementation. The original baseline and sequence above remain historical context. For work starting after this audit, use the dependency order below instead of blindly restarting PR A or treating already merged slices as complete. Accepted ADRs and applicable OpenSpec requirements retain authority. In particular, the broader adjacent-work lane is a proposed follow-up queue, not permission to combine storage, gateway or benchmark changes into a retrieval PR.

**Goal:** remove unnecessary independent ownership of upstream algorithms, protocols and lifecycle machinery while preserving exact-source freshness, honest completeness, local-first policy, immutable originals and request-only context delivery.

**Architecture:** keep TypeScript + Effect and the selected provider roles. Adapt the named Aider/Claw behavior, use existing SDKs and standard resource primitives, and retain the small ACE-specific source/policy/delivery boundaries. A replacement must delete an old owner, or record an immediate, bounded deletion point.

## Audit coverage and evidence limits

The repository tree was inventoried at the pinned SHA. Static source/caller inspection covered 386 files: 125 under src/, 103 scripts, 111 tests, 14 integration files, 8 infrastructure files, 22 documentation/instruction files, and root instructions/manifest/README. Gateway contracts, OpenSpec documents, Rust manifests/stub and CI configuration were additionally inspected. Benchmark tasks/reports and historical plans were inventoried and selectively checked for live consumers and evidence identity.

This is repository-wide architecture and reuse coverage, **not a claim that every historical report/fixture was read line by line**. Deep inspection followed runtime composition, ports, duplicated lifecycle owners, caller reachability and their owning contracts. Static source findings do not establish reproduced races, provider success, production readiness or token savings. No runtime or provider gate was run for this documentation audit. Package choices below are candidates unless already locked or explicitly selected by the governing plan.

Use these labels:

- **DEVIATION:** delivered behavior differs from the named implementation/ownership required by this plan.
- **DUPLICATE:** source inspection confirms multiple owners of the same protocol/lifecycle/schema behavior.
- **CANDIDATE:** an existing engine/library may remove ownership, but parity, integration cost or deployment suitability remains to be proved.
- **KEEP:** necessary ACE behavior or a conforming provider boundary; do not delete merely to reduce LOC.
- Runtime failure consequences remain **static-unconfirmed** until the owning regression or real-provider gate reproduces them.

## 1. Named upstream conformance

| Capability | Source actually inspected | Expected mode | Current implementation/evidence | Verdict and next owner |
| --- | --- | --- | --- | --- |
| RepoMap | Aider-AI/aider@5dc9490bb35f9729ef2c95d00a19ccd30c26339c, aider/repomap.py, especially get_ranked_tags and render_tree | ADAPT algorithm; do not run the Aider CLI in production | src/domain/repo-map.ts:86 uses a custom symbol graph, deduplicated unweighted targets, fixed 30 iterations and its own personalization; no Aider comparison fixture found | **DEVIATION / shadow reimplementation**. R3 must restore selected weighting/rank distribution/rendering semantics or obtain an explicit justified deviation |
| Shared AST records | @ast-grep/napi and batched CLI, both locked 0.51.0; src/adapters/ast-grep-napi.ts and ast-grep-structural.ts inspected | ADOPT parsers; normalize into one shared def/ref record | NAPI is a hand-maintained declaration extractor; CLI outline normalizes a different result. Representative parity is not real-repo parity; lightweight references are not the RepoMap input | Parser reuse **CONFORMING**, shared record/coverage **INCOMPLETE**. R2 |
| Incremental ingest | ultraworkers/claw-code@8aab1d4e5410f9ab5e5e7f03c8a87de479e814ec, rust/crates/claw-rag-service/src/ingest.rs | ADAPT changed-file ownership; keep ACE safe publication and structural chunks | WorkspaceSync and digest-bound reuse exist. Full candidate/materialized graph work remains on changes | **PARTIAL adaptation**. R1/R4; preserve improvements over unsafe delete-first ingest |
| LSP lifecycle/discovery | Claw #3016 head 5e7d7edb8e82782371f8747aca63e63412ccfca6 in TheArchitectit/claw-code; rust/crates/runtime/src/lsp_discovery.rs and lsp_client/mod.rs | ADAPT descriptor/discovery/lazy registry/document lifecycle | Small refcount registry plus original ACE adapter; process key includes semantic snapshot generation; discovery is configuration rather than descriptor-based | **PARTIAL**, not demonstrated Claw lifecycle parity. R5 |
| LSP transport | vscode-jsonrpc, locked 9.0.3; src/adapters/lsp-semantic.ts:6,283 | ADOPT maintained framing/dispatch | createMessageConnection + StreamMessageReader/Writer are used | **CONFORMING**. Do not replace with Claw handwritten framing or describe this layer as a custom wire implementation |
| Qdrant | @qdrant/js-client-rest, locked 1.20.0; sdk branches in http-provider-boundaries.ts and qdrant-context-provider.ts | ADOPT SDK; thin ACE payload/freshness adapter | Production composes QdrantClient. Raw REST branches remain alongside SDK branches and retain a second wire contract | Runtime SDK **CONFORMING**; duplicate compatibility ownership to sunset in R1 |
| Context delivery | Parent plan ContextAssembler and thin Claw retrieve boundary | ACE-specific composition using existing provider results | Assembly is priority packing. Rendered RepoMap is used as a score prior rather than a delivered map section; no independent map/snippet/LSP budgets | **DEVIATION / incomplete delivery**, not evidence that all custom assembly is forbidden. R6 |
| MCP | Official maintained TypeScript SDK, locked client/server 2.3.1 | ADOPT | ace-mcp.ts runs SDK transport; old handwritten transport remains publicly exported | Production **CONFORMING**, superseded owner remains. X2 |
| Hermes/Bifrost | Accepted ADR-016 and accepted-direction ADR-017; Hermes v0.22.3 and Bifrost source pin in §5 | WRAP selected host/gateway seams | Native compressor inheritance and thin Go connector exist; narrow dedupe/schema/cancellation overlaps remain | Keep architecture; X3/X7 address boundaries without changing delivery ownership |
| Graphiti / Vertex / Harbor | Selected roles in accepted ADRs; exact additional sources in §5 | WRAP engines, not reinvent extraction/search/evaluation orchestration | Real upstream boundaries exist; auth, presence checks and legacy experiment variants retain avoidable ownership candidates | X4–X6; do not call the whole subsystems shadow implementations |

### Upstream reuse record required before each implementation slice

Record: requirement; authoritative ADR/spec/plan; exact source commit/tag/file/API; ADOPT/ADAPT/WRAP/REJECT; behavior preserved; deliberate deviations; parity fixture; deletion target; risk/rollback. REJECT requires concrete evidence, not preference for a shorter local solution. A pinned upstream outranks an unrelated library and local invention.

When the plan does not name a sufficient solution, compare the best 2–3 applicable options: existing project capability, standard/provider-native primitive, maintained external library. Record functional fit, maintenance/security/license, integration cost, performance, lock-in and long-term ownership. Pin exact installed versions and check advisories before adding a package. Do not treat this document as a dependency-installation list.

## 2. Findings in the retrieval path

### F01 — custom RepoMap semantics replace the selected Aider algorithm

**Classification:** DEVIATION; high confidence. Owner: src/domain/repo-map.ts, rankRepoMap/renderRepoMap; src/adapters/repo-map-structural.ts, buildRepoMapDelta.

Aider constructs a weighted file/identifier multigraph from definition/reference tags, applies reference-frequency scaling and identifier/chat-file personalization, distributes file rank back to definitions, then renders context around selected lines. Current ACE ranks symbol nodes, deduplicates their edges, assigns its own boosts and renders a one-line path/kind/name list. A passing local PageRank test proves the local algorithm, not Aider behavioral parity.

**Remedy:** adapt the inspected Aider core, including explicit fallback/tie/rendering semantics, with Apache-2.0 attribution and a frozen comparison. Keep graph-library internals private. Do not independently invent another graph/ranking policy. R2 supplies tags; R3 owns the adapter and replacement.

### F02 — RepoMap requires LSP and builds it across the indexed candidate set

**Classification:** DEVIATION; high confidence. Evidence: src/bin/ace-mcp.ts:765–799 guards map construction with lspReady and supplies build.index.candidates. src/adapters/repo-map-structural.ts:99 onward calls semantics.references for candidates.

This reverses the plan's independence boundary: AST def/ref → RepoMap, followed by optional LSP on a bounded shortlist. It couples map availability and update cost to server readiness.

**Remedy:** remove SemanticAnalysisPort from the structural map builder; extract lightweight tags through the shared parser record. Keep approximate tag relations explicitly structural, not semantically verified references. Only query LSP for the selected top 3–6 candidates, with a zero-call path when enrichment adds no value. R2/R3/R5 must include a map-without-LSP fixture and call-count assertions.

### F03 — Claw lifecycle is only partially adapted; generation sessions replace reuse

**Classification:** DEVIATION / incomplete lifecycle; high confidence. Evidence: src/application/lsp/server-registry.ts:29–76; src/bin/ace-mcp.ts:739–761 includes snapshotIdentity in the registry key; src/adapters/lsp-semantic.ts:416–420 caches the start promise.

The adapter has real document notifications and transport reuse within a session. However, a source generation gets a separate session; descriptor discovery/status is incomplete; a cached failed/dead process is not automatically replaced by a clear restart owner. Startup initialize is not covered by the ordinary request timeout, and close disposes/kills instead of completing shutdown-request then exit-notification.

**Remedy:** one descriptor/registry owner modeled on the pinned Claw design, on vscode-jsonrpc and Effect/Node cleanup. Keep process identity separate from evidence generation. Serialize document update + query, capture generation before/after and reject raced semantics; do not mutate a published semantic state unsafely. Generation isolation must not be removed until this alternative passes concurrency fixtures. R5.

### F04 — two Qdrant protocol implementations survive the SDK migration

**Classification:** DUPLICATE; high confidence. Evidence: src/adapters/http-provider-boundaries.ts:237–505 has SDK and manual REST query/upsert/delete paths. src/adapters/qdrant-context-provider.ts:266–310,524–744,800–963 repeats SDK/REST alias, collection, count and scroll branches. ace-mcp.ts:386,693,870 supplies the SDK.

**Remedy:** retain payload validation, policy checks, exact membership verification and ACE provenance, but make the SDK the single Qdrant wire owner. Convert tests to a typed SDK test boundary and retain one real-provider test. Inventory scripts such as scripts/qdrant-hybrid-rank-probe.ts before removing compatibility. Do not falsely describe current production as raw-HTTP only. R1.

### F05 — publication/recovery coordination is custom and concurrency remains unproven

**Classification:** CANDIDATE plus acceptance gap, not proof that an SDK can replace transactions; high confidence. Owners: mutateQdrantChangedPaths, verifyQdrantSnapshotMembership, reuseOrPopulateQdrantSnapshot in qdrant-context-provider.ts; publication closure in ace-mcp.ts.

Upsert → physical membership verification → prune → verify → active-state handover is custom coordination with real ACE invariants. WorkspaceSync's promise queue serializes one process, not all writers of a stable collection. A stale writer can conflict with another writer's prune/publication. PR #184 observation convergence is not a Qdrant writer fence.

**Remedy:** compare pinned Qdrant batch/wait/ordering and atomic alias capabilities against each observable invariant first. Batch ordering is **not** a demonstrated multi-operation transaction, workspace lease or compare-and-set. An atomic collection alias swap does not by itself prove changed-file cost or safe concurrent mutation of one stable collection. Prefer one explicit writer owner per collection when deployment supports it; if fencing or a persistent intent journal is still required, choose the smallest evidenced local primitive and record the gap. Keep current safe rejection and last-known-good preservation until replacement passes R4.

**Correction to the original PR-A ingest bullets:** prepare/parse/embed the new content before destructive cleanup; verify publication before pruning older points. The earlier delete-first bullet ordering is not an executable instruction. Do not inherit Claw ingest's delete-before-embedding shape where it loses last-known-good evidence.

### F06 — changed-file parsing coexists with repository-wide in-memory rebuilding

**Classification:** confirmed ownership/scaling candidate; high confidence, no measured latency claim. Evidence: local-code-index.ts:215–281 groups/copies previous candidates and scans the manifest; mutateQdrantChangedPaths repeatedly filters all index candidates per changed path; ace-mcp.ts reconstructs a fresh RepoMap service over all candidates. semantic-snapshot.ts reuses unchanged source text, but still materializes the source set.

Normal synchronized queries no longer unconditionally hash all repository bytes: preserve that actual improvement. Dirty Git files are still exact-read to establish digest equality; removing those reads based only on unchanged status is unsafe.

**Remedy:** use one path-keyed symbol/tag owner with changed-path mutations and derive both Qdrant chunks and map deltas from it. Reuse existing maps/state, not a new distributed cache or index framework. Measure metadata traversal, candidate copying, AST calls, source bytes, LSP calls and Qdrant mutations separately. Do not promise O(changed bytes) for unavoidable graph ranking; distinguish update cost from explicit map rendering. R2/R3/R7.

### F07 — ContextAssembler lacks section ownership and uses repeated character heuristics

**Classification:** DEVIATION for composition, CANDIDATE for token counting; high confidence. Evidence: src/domain/context-assembly.ts:28–79; src/domain/repo-map.ts:139–162; qdrant-context-provider.ts:1344–1358; integrations/hermes/ace_context_engine/engine.py:29–41,257–261.

Character-count/4 estimates are separately maintained. They are not an exact model-aware token ceiling, especially for Unicode, minified code, escaping, message framing and tool/schema overhead. Their explicit estimated labels are correct and must stay honest.

**Remedy:** pass the actual rendered map to assembly; reserve bounded map/snippet/relation sections; share a model/encoding-aware counting boundary using an existing host/provider counter when available. Compare a small maintained tokenizer such as gpt-tokenizer with tiktoken-based host counting; do not implement BPE. Unsupported model/protocol counts stay estimated/unknown; never infer provider usage from a local count. Keep lossless source expansion independent of the initial context budget. R6.

### F08 — large owners have not been replaced

**Classification:** DEVIATION in ownership direction; high confidence. qdrant-context-provider.ts is 1,833 lines versus the plan's approximately 1,528-line baseline; ace-mcp.ts is 1,135 lines. These are symptoms backed by actual ownership: protocol adapters, publication, vector reuse, freshness, query ranking, semantic enrichment and runtime setup remain mixed.

**Remedy:** move the existing responsibilities as R1–R6 establish their final owners; delete moved bodies in the same PR. R7 removes leftover composition/reconciliation algorithms. Do not make six wrappers around the same large provider and call it decomposition. LOC is a directional review signal, not a numeric pass/fail target independent of behavior.

## 3. Findings outside the original retrieval-only queue

These are independent follow-ups. They must preserve accepted architecture, current public ports, security gates and immutable historical evidence. Their presence here does not authorize a single giant cleanup PR.

### F09 — three independent JSONL worker lifecycle implementations

**Classification:** DUPLICATE; high confidence. Dense process-embedding.ts:208–365, sparse process-sparse-embedding.ts:160–376, reranker process-reranker.ts:107–290 each own spawn, stdout framing, ready/pending maps, request IDs, timers, errors and termination. Effect.async registrations do not return interruption cleanup. ace-mcp.ts:1107–1125 omits dense-worker finalization and one cleanup exception can skip later cleanup.

**Remedy:** keep maintained FastEmbed/SentenceTransformers inference; consolidate only proven common process mechanics using already installed Effect.async cleanup, acquireRelease/scopes and Node streams/process lifecycle. Preserve model-specific identities, vector/cardinality checks, preprocessing, environment allowlists and error mapping. No new worker service, pool framework or mandatory Ollama. X1.

### F10 — public legacy MCP parser remains beside the official SDK

**Classification:** DUPLICATE superseded owner; high confidence. src/transport/mcp-stdio.ts:26–172 maintains JSON-RPC validation, initialize, schemas, dispatch and framing; src/index.ts:53 exports it. Production ace-mcp.ts:1105 uses the SDK. Internal caller inspection found the old implementation used by its own test, not a live executable; external barrel consumers are unknown.

**Remedy:** migrate unique contract assertions to the official SDK conformance suite, check public compatibility, remove the barrel export and old parser/test. If a real compatibility consumer exists, offer a temporary SDK-backed entry point with a sunset, not another protocol implementation. X2.

### F11 — gateway contract shape is handwritten three ways and has drift

**Classification:** DUPLICATE and confirmed source-level drift; high confidence. contracts/ace-gateway/v1/projection-request.schema.json rejects unknown properties; src/domain/gateway-projection.ts:76–159 does not. Enum validation uses String(value), so an array such as ["public"] can pass the membership check despite violating the wire schema. Go connector DTO/decoding maintains another partial interpretation. Existing schema tests inspect required names, not full decoder equivalence.

**Remedy:** use already installed Zod 4 strict structural schemas and generated JSON Schema/types; retain semantic digest, canonical Base64, authorization and deadline checks. Go uses standard strict decoding plus shared accepted/rejected fixtures and explicit union/required checks. No general code-generation platform unless this small approach proves insufficient. X3.

### F12 — gateway cancellation ignores an available upstream context

**Classification:** confirmed missed primitive; runtime consequences static-unconfirmed. integrations/bifrost/ace-connector/plugin/main.go:134 calls Project(context.Background(), ...), although its BifrostContext implements context.Context and connector.go:119 already combines caller context with the deadline. src/transport/gateway-projection-http.ts:68 runs the projection without the incoming request's abort signal.

**Remedy:** propagate Bifrost context through standard Go HTTP and the HTTP disconnect/AbortSignal through the Effect computation. Keep deadline admission and strict no-forward-after-failure policy. No custom cancellation registry or extra proxy. X3 is split into independently reviewable schema and cancellation PRs.

### F13 — filesystem locking/atomic rewrite ownership is repeated

**Classification:** DUPLICATE; transactional replacement remains CANDIDATE. Active owners: file-memory-archive.ts:26–52, file-projection-outbox.ts:35–67 and application/file-workspace-store.ts:93–116 independently maintain mkdir locks, polling, deadlines and release. A terminated owner can leave a lock; deliberate refusal to steal it is currently fail-closed behavior.

**Remedy:** compare a small local SQLite transactional adapter against a single maintained filesystem-lock/atomic-write adapter. SQLite can remove physical metadata transaction/lock ownership, but is not selected here: verify runtime/binding, filesystem, migration and backup costs. Keep epoch conflicts, tombstones, archive identity, shared-blob reference safety and persisted outbox semantics in ACE. Do not substitute transient Effect retry for durable retry history. X4.

### F14 — Vertex auth and REST retry lifecycle overlap official Google clients

**Classification:** CANDIDATE; high confidence in ownership. ace-mcp.ts:157–167 synchronously shells out for gcloud tokens; vertex-rag.ts:41–79 owns request URL/body/auth/timeout and 401 refresh/replay.

**Remedy:** compare google-auth-library around the existing adapter with generated VertexRagServiceClient behind DocumentationPort. Preserve explicitly selected host-gcloud compatibility: ADC and gcloud active identities are not interchangeable. Verify SDK retry/logging defaults; existing ACE contracts do not refresh on 403, whereas OAuth defaults can. Keep destination/secret/policy checks before credentials and transmission. X5.

### F15 — Graphiti exact presence is emulated through large group enumeration

**Classification:** CANDIDATE / upstream capability gap; high confidence. graphiti-mcp.ts:382–409 lists up to 100,000 episodes for one UUID; reconciliation/deletion repeats this per receipt. The current full-page NOT_READY result is honest, not a false absence.

Inspected upstream MCP get_episodes has no exact-ID/cursor facility, but Graphiti core EpisodicNode.get_by_uuid does. **An empty get_episode_entities result does not prove absence of the episode.**

**Remedy:** prefer upstreaming a small group-scoped exact presence tool, or a tightly versioned provider extension delegating to the native lookup. Keep the official MCP transport; do not add a parallel permanent direct-DB client. Delete group enumeration only once capability/version and real absence/outage parity are established. Otherwise keep the explicit bound. X5.

### F16 — benchmark generation has multiple readers and obsolete policy graphs

**Classification:** DUPLICATE overlap/candidate consolidation; high confidence. src/adapters/harbor-four-arm-trial-evidence.ts, harbor-feedback-trial-evidence.ts and scripts/render-harbor-paired-report.ts, render-harbor-retrieval-report.ts each interpret trial evidence; domain/harbor-three-arm.ts and harbor-four-arm.ts preserve separate experiment policies and active package commands. Release preflight and harbor-byte-binding still import older policy owners.

**Remedy:** keep Harbor as scheduler/runtime and ACE as evidence/quality consumer. Extract the common observation reader before retiring old variants. Preserve raw reports/holdouts and explicit unknown cost fields. Validate emitted job configs against the pinned Harbor model rather than fossilized local assumptions. X6.

### F17 — Hermes adds a second request-local dedupe policy

**Classification:** CANDIDATE, medium confidence; not a blanket compaction violation. integrations/hermes/ace_context_engine/engine.py:45–69 deduplicates historical tool results. The plugin correctly inherits the real ContextCompressor. Hermes v0.22.3 already has _dedupe_tool_results, but uses different fingerprints/eligibility and potentially different durability behavior.

**Remedy:** compare on shared protected-message fixtures; prefer a supported exact-equality request-local upstream seam. Until it exists, a small documented JUSTIFIED DEVIATION may be safer than calling a private native method with weaker/different invariants. Keep native compaction, byte-stable durable history, retry memoization and non-beneficial no-op admission. X7.


### F18 — unused Harbor task/runner adapters retain an alternate lifecycle

**Classification:** superseded parallel infrastructure; high confidence for internal reachability, public consumers still to check. src/adapters/harbor-task-adapter.ts owns job config, worktree reset/clean and artifact retention; harbor-runner.ts owns another CLI/stdout contract. src/index.ts exports them, but the inspected internal callers are their tests and one legacy case in retrieval-memory-routing.contracts.test.ts. The real feedback route uses generated Harbor commands and the current collector.

**Remedy:** check external/documented consumers, move any unique fixture-verifier assertions, then delete both adapters, their exports and implementation-only tests. Keep actual task fixture bytes and current collection/byte-binding evidence. X6 includes this bounded deletion; no new Harbor wrapper replaces it.

### F19 — historical MCP benchmark launcher repeats runtime installation

**Classification:** CANDIDATE / superseded bootstrap ownership; medium confidence. scripts/harbor-ace-mcp.sh:35–60 installs Python packages at startup and maintains a marker/generated launcher. scripts/build-harbor-ace-runtime.mjs prepares dependencies/model cache before runs, and harbor-ace-context-bridge.sh uses the verified bundle. Only historical instruction references were found in the inspected source set; external explicit-MCP consumers are not disproved.

**Remedy:** if explicit MCP consumers remain, use a thin entry point into the same verified runtime bundle and dist/bin/ace-mcp.js; delete startup installation/marker logic after container/MCP smoke. Otherwise sunset this historical launcher, preserving archived configs/evidence. Do not remove the actual production MCP SDK transport. X6.

## 4. What must remain ACE-owned

- Exact safe reads, UTF-8 byte/range normalization, digest/generation checks and selected-source race rejection. Using a parser or SDK does not eliminate these contracts.
- Coverage/completeness, typed unavailable/stale/not_ready/policy_denied/not_required/empty distinctions and source provenance.
- Source/policy/receipt-aware ContextAssembler and lossless expansion; upstream retrieval engines do not own ACE's authorized delivery contract.
- Immutable original session archive, admission/approval decisions, tombstones, shared-original protection and durable projection intent. Graphiti's process-local asyncio.Queue is not a durable outbox replacement.
- Thin Graphiti MCP and Qdrant SDK adapters; genuine FastEmbed/SentenceTransformers model workers; no new parser, vector DB or graph engine.
- Native Hermes compressor inheritance and the local typed/versioned JSONL projection bridge. This bridge is not a handwritten MCP implementation.
- Thin Go Bifrost connector, body/digest/ownership enforcement and strict unsupported-route rejection. No TypeScript reverse proxy or arbitrary Bifrost fork.
- Small artifact storage and explicit offline backup. The existing backup requires quiesced writers; do not claim it promises an online snapshot.
- Standard Docker/k3s/Helm deployment and disabled Rust extension stub. They are not duplicate engines. Infrastructure readiness discrepancies are operational follow-ups, not evidence of reinvention.
- ACE-specific quality, uncertainty, source-integrity, authorization and release evidence gates. Do not delete them merely because Harbor computes job results or token totals.
- Historical Codex/three/four-arm observations. Deleting old executable orchestration does not license rewriting evidence or calling it current Hermes evidence.
- Existing small domain Result helpers are not grounds for an unrelated repository-wide Either/Effect rewrite.

## 5. Reuse choices and inspected references

| Area | Preferred option and alternatives considered | Constraint / decision |
| --- | --- | --- |
| RepoMap | Reuse and faithfully translate selected working functions from pinned Apache-2.0 Aider, with upstream tests/oracles; compare wrapping existing runtime only if translation is materially infeasible | **ADOPT original algorithmic implementation**, not a paraphrase. Preserve weighting, graph semantics, PageRank and TreeContext-style rendering, with permitted licensed fragments and attribution. Do not add a production Python sidecar without a separately justified topology decision |
| AST | Locked ast-grep NAPI plus the existing batched CLI transition versus a new parser or LSP-wide indexing | **ADOPT existing parsers**; preserve one normalization/tag contract. No permanent double extraction |
| LSP | Reuse licensed Claw #3016 discovery/registry/lifecycle functions and tests where appropriate, or a compatible ready standalone Node LSP client, over locked vscode-jsonrpc | **ADOPT/WRAP first**. A Rust-to-TS port must trace actual permitted Claw source, not redesign lifecycle from scratch. Keep standard wire library and only necessary ACE source-generation validation |
| Qdrant | Existing SDK batch/filter/scroll/ordering/alias facilities versus raw REST twin or new coordination service | **ADOPT SDK**; publication fence choice remains evidence-gated. No unsupported transaction claim |
| Worker lifecycle | Existing Effect 3.22.3 + Node versus adding @effect/platform solely for extraction or a worker service/pool | **ADOPT existing primitives**, consolidate only real common behavior; no dependency/topology expansion by default |
| Token counting | Existing host/provider counter; gpt-tokenizer; host tiktoken | Prefer the already available matching counter; otherwise pin a maintained matching encoding. gpt-tokenizer is MIT, TypeScript; host tiktoken avoids a new TS runtime only if already present. Model mapping, startup/memory/security and parity must be checked before selection |
| Gateway schemas | Existing Zod 4.6.7 + native JSON Schema generation; Effect Schema; hand-maintained schemas/validators | Prefer **Zod already used by MCP**, strict objects and shared cross-language fixtures. No experimental fromJSONSchema or new generator by default |
| Metadata storage | Local SQLite transactions; one maintained filesystem lock/atomic-write adapter; current duplicated locks | **CANDIDATE comparison**, not an approved storage migration. SQLite core is public-domain; binding/runtime/package selection, maintenance/advisories and filesystem support remain open |
| Vertex | Official auth library plus current thin REST adapter; generated official RAG client | **CANDIDATE comparison**, choose the option deleting meaningful ownership with proven auth/retry/privacy parity. Both official clients are Apache-2.0; do not silently change credential identity |
| Graphiti presence | Upstream exact-ID MCP capability; tiny versioned extension using core lookup; existing bounded group listing | Prefer upstream **ADOPT/WRAP** after capability evidence; existing listing remains honest fallback, not a second DB owner |
| Harbor | Native Job/JobPlan/TrialResult; small ACE observation adapter; old per-arm local generators/readers | Use pinned Harbor primitives where equivalent; preserve experiment ordering and ACE evidence semantics |
| Hermes dedupe | Supported upstream request-local seam; minimal exact-equality adaptation; private native helper | Upstream first, but **do not blindly adopt different behavior**. Justified local adaptation is permissible with parity evidence |

Inspected source references (pins are evidence references, not instructions to upgrade production):

1. [Aider RepoMap, Apache-2.0](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py).
2. [Claw #3016 lifecycle](https://github.com/TheArchitectit/claw-code/blob/5e7d7edb8e82782371f8747aca63e63412ccfca6/rust/crates/runtime/src/lsp_client/mod.rs) and [discovery](https://github.com/TheArchitectit/claw-code/blob/5e7d7edb8e82782371f8747aca63e63412ccfca6/rust/crates/runtime/src/lsp_discovery.rs). Preserve provenance; use clearly licensed later modules or fresh public-protocol adaptation, not large reconstructed proprietary source copies.
3. [Claw ingest](https://github.com/ultraworkers/claw-code/blob/8aab1d4e5410f9ab5e5e7f03c8a87de479e814ec/rust/crates/claw-rag-service/src/ingest.rs). Do not copy its character windows or unsafe delete-before-embed sequence.
4. [Qdrant batch/wait/ordering](https://api.qdrant.tech/api-reference/points/batch-update), [collections/aliases](https://qdrant.tech/documentation/concepts/collections/). The inspected API page defaults to 1.20.x; runtime evidence must match the actual server pin, including the existing 1.19.2 fixtures.
5. [Effect 3.22.3 async/acquireRelease](https://github.com/Effect-TS/effect/blob/effect%403.22.3/packages/effect/src/Effect.ts), [Scope](https://effect.website/docs/v3/resource-management/scope), [Node child_process](https://nodejs.org/api/child_process.html). Use locked/runtime-compatible APIs, not unreviewed major-version upgrades.
6. [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer), [tiktoken](https://github.com/openai/tiktoken). No new tokenizer package/version is selected by this audit.
7. [Zod JSON Schema](https://zod.dev/json-schema), [Go strict decoder](https://pkg.go.dev/encoding/json#Decoder.DisallowUnknownFields).
8. [SQLite transactions](https://sqlite.org/lang_transaction.html), [atomic commit](https://sqlite.org/atomiccommit.html), [backup](https://sqlite.org/backup.html).
9. [Official Vertex retrieveContexts client](https://github.com/googleapis/google-cloud-node/blob/f52b7155ce4c6be0774928fc985cfcdd95944728/packages/google-cloud-aiplatform/src/v1beta1/vertex_rag_service_client.ts), [Google auth](https://github.com/googleapis/google-cloud-node-core/blob/76ba85a7f55c6e82943008b4eceb07a0f58b39e1/packages/google-auth-library-nodejs/src/auth/googleauth.ts), [OAuth retry behavior](https://github.com/googleapis/google-cloud-node-core/blob/76ba85a7f55c6e82943008b4eceb07a0f58b39e1/packages/google-auth-library-nodejs/src/auth/oauth2client.ts). Inspected auth package 10.6.2 is a candidate, not selected.
10. [Graphiti core exact lookup](https://github.com/getzep/graphiti/blob/2b5db9e139b2627c3ba18ff55f9181569b0d8224/graphiti_core/nodes.py#L362), [MCP capabilities](https://github.com/getzep/graphiti/blob/2b5db9e139b2627c3ba18ff55f9181569b0d8224/mcp_server/src/graphiti_mcp_server.py#L795). Verify against deployed provider before enabling a new tool.
11. [Harbor v0.24.0](https://github.com/harbor-framework/harbor/tree/b53b8134e1241686dca7759af188f987ecc48e8b). Inspect src/harbor/models/job/config.py, src/harbor/job_plan.py, src/harbor/models/trial/result.py and the installed runtime before migration.
12. [Hermes v0.22.3 compressor](https://github.com/NousResearch/hermes-agent/blob/5b147ab036d6d19131bff8d20701b5001eab844a/agent/context_compressor.py#L3166), [Bifrost context](https://github.com/maximhq/bifrost/blob/fe7634a6c828927d05ffdd57c62be0aaab04193f/core/schemas/context.go). These demonstrate available seams; they are not current ACE provider-wire certification.
13. [Official MCP SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/). Implementation must inspect/use locked 2.3.1, not assume latest-main equivalence.

## 6. Detailed remediation sequence

### Common execution contract for every slice

- [ ] Refresh main, open PRs and retained evidence; reconcile PR #184 independently. Do not overwrite its branch or claim its results for another SHA.
- [ ] Read the applicable Accepted ADR and OpenSpec contract; update normative acceptance before changing behavior where needed. Broader provider/storage choices require an explicit decision record.
- [ ] Complete the upstream reuse record and compare actual caller/import reachability, including scripts, public exports and release gates.
- [ ] Extend the cheapest existing owning test with the missing behavior; obtain a deterministic RED when practical. A newly invented implementation cannot define its own upstream parity oracle.
- [ ] Implement the smallest coherent replacement; remove the superseded body/tests or document the immediately following deletion commit.
- [ ] Run affected tests during the loop and the repository's required verification once at handoff. Real-provider/agent/wire gates apply only to the changed capability and cannot be replaced by mocks.
- [ ] Commit the focused slice, push and open a PR to main. Report implemented/tested/blocked separately and include exact SHA, fixture/provider identity and retained evidence. No automatic production promotion.

**Review focus across the queue:** source changes during delivery; concurrent writer termination; LSP/worker startup hangs and cancellation; Unicode/model-token budgets; malformed/version-skewed provider contracts. Each has a designated gate below.

### R1 — one Qdrant SDK boundary (F04)

**Modify:** src/adapters/http-provider-boundaries.ts; src/adapters/qdrant-context-provider.ts; src/bin/ace-mcp.ts; actual script callers. **Tests:** test/qdrant-client.contracts.test.ts, test/qdrant-alias.contracts.test.ts, test/qdrant-real-pipeline.contracts.test.ts, test/provider-and-multiprocess-contracts.test.ts.

- [ ] Inventory every SDK/raw branch and authenticated caller. Define the existing CodeCandidatePort and collection/membership operations as the preserved boundary; keep ACE DTO validation.
- [ ] Add matching SDK fixtures for query/upsert/delete/count/scroll/alias/collection failure and malformed responses. Preserve wrong-workspace rejection, empty-versus-outage distinction and credential handling.
- [ ] Require the SDK in the real adapter; move protocol test doubles to a typed SDK seam. Remove REST envelope normalization, duplicate URL/body construction and count/scroll fallbacks.
- [ ] Move Qdrant client operations into one focused adapter owner; moved implementations are deleted immediately from the large provider. Do not introduce a pass-through owner for every method.
- [ ] Run affected contracts, verify:pr and test:real-provider plus outage/auth cases on a clean runtime when available.

**Exit:** one wire implementation; source/freshness checks and physical membership proofs remain. **Rollback:** revert the SDK-boundary slice; never silently switch an authenticated runtime to unauthenticated HTTP.

### R2 — shared changed-path AST tags with real parity (F02/F06)

**Depends on:** current WorkspaceSync contracts; can prepare fixtures before R1 completes.
**Modify:** src/adapters/ast-grep-napi.ts, ast-grep-structural.ts, local-code-index.ts; src/domain/semantic.ts; src/application/ports.ts and ast-grep-parity.ts. **Tests:** existing ast-grep, parity, UTF-8 and workspace-sync suites.

- [ ] Freeze real JS/TS/TSX source fixtures and current CLI/NAPI output; include imports/exports, overloads, nested/anonymous declarations, enum/object/type fields, malformed syntax and Unicode.
- [ ] Define one digest/parser/scope-bound per-file structural result carrying definitions, lightweight references and exact ranges. Reuse existing parser APIs; do not write a second parser or a per-subsystem extraction pass.
- [ ] Adapt tag extraction to supply RepoMap and Qdrant from that same result. Keep semantic confirmation separate from structural name/reference approximation.
- [ ] Maintain path-keyed records and update only changed/added/deleted paths. Avoid regrouping/copying every symbol solely to update one path where the existing state can be mutated safely.
- [ ] Delete the LSP dependency from buildRepoMapDelta as soon as the structural replacement is wired; do not keep two production graph builders.
- [ ] Run frozen and real-repository parity, the existing semantic E2E and a one-file edit instrumentation case. Switch NAPI default only when its actual supported coverage passes; retain CLI solely for explicit unsupported languages with a documented sunset/extension criterion.

**Exit:** one parsed record, two consumers, map construction works with no LSP. **Rollback:** keep the prior parser default and restore the affected adapter; parser identity invalidates incompatible cached records.

### R3 — faithful Aider graph/rank/render adaptation (F01/F02)

**Depends on:** R2 tags.
**Modify:** src/domain/repo-map.ts; src/application/repo-map-service.ts; src/adapters/repo-map-structural.ts; map call sites. **Tests:** existing repo-map suites and a frozen upstream comparison fixture/tool, not a new benchmark framework.

- [ ] Inventory and map **actual pinned Aider functions** (`get_ranked_tags`, `get_ranked_tags_map`, `render_tree`, `to_tree`) and their executable dependencies/tests to replacement ACE symbols. Record direct reuse vs line-traceable translation, Apache-2.0 license/notice, and necessary ACE-specific deviations; do not implement the algorithm from a verbal summary.
- [ ] Record the pinned Aider graph, weighting, dangling behavior, personalization, rank-to-definition redistribution, tie and rendering semantics actually being adopted.
- [ ] Produce expected rankings/map sections from pinned Aider on a frozen source fixture with query/open-file inputs. Record tolerated parser/tag differences explicitly.
- [ ] Replace custom `pageRankFiles`/`rankRepoMap`/`renderRepoMap` behavior with faithful reuse/translation of the **original pinned algorithm and rendering code**, not another invented implementation. Retain official upstream fixtures as an independent oracle; a generic numerical library is acceptable only if upstream semantic equivalence is proven.
- [ ] Update only the changed graph inputs; keep ranking invocation distinct from ingest. Render useful source/tree context under an explicit budget, not only path/name rows.
- [ ] Remove the old custom ranking/build path and stale-prior handling that exists solely because of that path. Preserve digest-bound candidate matching.
- [ ] Run upstream behavioral comparison, query personalization, dangling/duplicate/ambiguous identifier, deletion and bounded rendering cases; measure top-K effect on an existing real repository fixture.

**Exit:** the reuse record can name preserved upstream behavior and point to its oracle. **Rollback:** disable optional map contribution truthfully while retaining Qdrant evidence; never call the old algorithm Aider-equivalent.

### R4 — prove and simplify stable collection publication (F05)

**Depends on:** R1; coordinate metadata primitive choice with X4 without requiring a whole-memory migration.
**Owners:** mutateQdrantChangedPaths/reuseOrPopulateQdrantSnapshot; WorkspaceSync rebuild handover; Qdrant SDK operations. **Tests:** existing real-pipeline, workspace-sync and concurrency/crash/restart runners.

- [ ] Write an invariant matrix for changed-path publication, stale writer, writer death, partial upsert, failed prune and restart. State what selected exact rereads prove and what index completeness additionally requires.
- [ ] Inspect the actual pinned Qdrant server/SDK capabilities. Compare single explicit writer, provider-native ordering/batches and an evidenced minimal local fence/journal. Record why none/some primitives meet each invariant.
- [ ] Choose one supported publication owner. If an atomic alias/snapshot alternative is required, record its changed-file cost and deviation from stable-collection intent before implementing it.
- [ ] Prepare new parse/embeddings first; publish/verify before cleanup; publish active metadata only after the chosen protocol's checks. Fence stale destructive work. Do not remove exact cleanup verification on the strength of a successful acknowledgement.
- [ ] Delete redundant generation/alias/scroll-copy coordination only where the selected protocol makes it obsolete; keep repair/restart evidence.
- [ ] Run deterministic two-process barriers and writer-kill failpoints, then test:real-qdrant-concurrency, test:real-qdrant-crash, test:real-provider-restart and scale on the reviewed clean SHA.

**Exit:** current/partial/not-ready outcomes remain truthful under real multiprocess failure; no unexplained new coordinator. **Rollback:** restore prior validated metadata/index snapshot with writers stopped, or block mutation; never treat a partial generation as current.

### R5 — Claw lifecycle over the existing transport (F03)

**Depends on:** R2/R3 remove index-time LSP dependency.
**Modify:** src/application/lsp/server-registry.ts, src/adapters/lsp-semantic.ts, src/application/semantic-snapshot.ts and ace-mcp.ts. **Tests:** existing LSP registry/semantic/snapshot contracts and real LSP scripts.

- [ ] Inspect pinned Claw #3016 actual discovery, registry and process code, tests and per-file licensing; compare existing standalone Node lifecycle libraries before writing new management logic. Record function-level direct reuse/faithful translation (or a proven compatibility reason for wrapping another ready library), not a new lifecycle inspired by Claw.
- [ ] Add descriptor/discovery and explicit server status based on the permitted working Claw source; retain configured overrides and library URI semantics.
- [ ] Make the registry own one process per workspace/server-language group, with lazy start. Separate source-generation validation from the process key.
- [ ] Serialize document delta application and semantic queries or use an equivalent evidenced protocol. Check expected generation before/after; failed refresh must not turn old semantic evidence current.
- [ ] Bound version/startup/initialize and ordinary calls; invalidate dead sessions and restart on a subsequent bounded operation. Implement shutdown request → exit notification → bounded forced termination fallback.
- [ ] Enrich only the selected top 3–6 hits when useful. Preserve zero-LSP retrieval and truthful optional-provider failure.
- [ ] Remove superseded generation-session handover and ad hoc release logic after concurrency parity. Audit the compatibility TypeScript factory by callers; it already delegates to LSP and is not a second engine.
- [ ] Verify same process across queries and changed files, exactly-once initialization, didOpen/change/close, crash/restart, startup hang, cancellation, Unicode URIs/ranges and simultaneous refresh/query. Run test:real-same-name and test:real-non-ts-lsp where the servers are available.

**Exit:** documented Claw adaptation on vscode-jsonrpc, bounded lifecycle and no LSP prerequisite for the map. **Rollback:** optional semantic stage becomes unavailable/partial; preserve the previously validated generation strategy until the new one proves safety.

### R6 — one sectioned ContextAssembler and counting boundary (F07)

**Depends on:** R3 rendered map and R5 enrichment boundary.
**Modify:** src/domain/context-assembly.ts, src/application/context-assembler.ts, context-transform-service.ts and Qdrant composition; shared count seam where actually needed. **Tests:** context-assembler, context-transform, progressive delivery and receipt contracts.

- [ ] Extend assembly inputs to carry a map section, verified snippet candidates and relation summaries with provenance. Keep public ContextBundle compatibility or version the affected boundary deliberately.
- [ ] Allocate configurable bounded slices: initially map at most about 25%, snippets the majority and LSP a small tail. Specify unused-slice redistribution and truthful omitted/partial behavior.
- [ ] **Treat existing `length / 4` as diagnostic-only, never a guaranteed limit.** Inventory exact token-count APIs already available in the actual Hermes/model host. Only if those cannot be reused, select a maintained tokenizer compatible with the actual model/protocol and pinned encoding; do not implement BPE or a competing tokenizer. Budget rendered headers/separators/escaping, not only content length.
- [ ] Compare the selected existing-host or maintained-library token count against measured provider usage on RU/CJK/emoji, minified source, JSON escaping and message wrappers; pin encoding identity and mark unsupported models estimated/unknown.
- [ ] Centralize counting; delete duplicated budget heuristics where a matching counter replaces them. Explicit estimated-only modes cannot claim an exact model bound.
- [ ] Deduplicate by current source identity/range while preserving distinct relations and provider receipts. Keep expansion lossless and independent of initial budget.
- [ ] Verify RU/CJK/emoji, long identifiers, minified source, overlapping evidence, an oversized highest-ranked entry, unknown model, empty sections and unavailable LSP. Confirm rendered RepoMap actually reaches provider-bound context.

**Exit:** one assembler owns section allocation, counting status and omissions; source verification stays separate. **Rollback:** retain prior contract version with truthful estimated/partial labels; do not silently truncate originals.

### R7 — delete superseded retrieval ownership (F06/F08)

**Depends on:** R1–R6; moves should already have deleted their old bodies.
**Modify:** qdrant-context-provider.ts, ace-mcp.ts, local-code-index.ts and public exports. **Tests:** owning contracts and actual caller inventory.

- [ ] Produce before/after responsibility and LOC tables for the giant owners. Count active responsibilities, not only files.
- [ ] Remove obsolete snapshot-only publication, duplicate Qdrant wire helpers, LSP graph construction and moved context packing. Preserve explicit cold-start and unsupported-language behavior still required.
- [ ] Reduce ace-mcp.ts to config/port setup and start/close composition. Remove reconstruction algorithms from its closures.
- [ ] Merge/delete redundant tests only after mapping every unique freshness, security, recovery and protocol assertion to its remaining owner.
- [ ] Run import/export/script reachability checks, verify:pr and the changed real-provider gates.

**Exit:** meaningful reduction in independent behavior; no facade retaining the entire old lifecycle. **Rollback:** focused responsibility moves can be reverted separately, without restoring parallel permanent stacks.

### R8 — final composed evidence and one Hermes A/B

**Depends on:** R7 and relevant X1 lifecycle safety. Use the existing Hermes native bridge without making unrelated Bifrost work a prerequisite. A Bifrost-route experiment additionally requires its applicable X3 contract/native-plugin/wire/cancellation evidence.
**Reuse:** original PR-E commands and existing Harbor task/receipt tooling.

- [ ] Freeze clean source/build/parser/embedding/LSP/provider/task/runtime identities and raw evidence locations.
- [ ] Run existing provider, race, outage, restart, semantic, scale and real LSP gates on that composed SHA. Record unavailable servers/services as BLOCKED.
- [ ] Run one matched retrieval-demanding Hermes native versus Hermes+one-ACE-projection pair, with identical native compaction/model/provider/cache conditions and independent success oracle.
- [ ] Correlate each actual outbound attempt, projection, usage/cache fields, cost and task quality. No bridge-receipt-only savings claim.
- [ ] If worse, diagnose one measured cause and rerun that pair. Add no sparse/reranker/multi-arm dependency without evidence of dense insufficiency and an explicit decision.

**Exit:** retained reproducible evidence, not assumed improvement. Production approval remains separate. **Rollback:** keep the previous validated runtime available, block promotion after regression and retain the failed raw trial; never erase a negative result or relabel historical evidence.

## 7. Adjacent cleanup lanes

These are deliberately separate from R1–R8. Implement a lane only as a focused PR against its applicable contracts; source/provider/storage choices not already accepted require a decision before promotion.

### X1 — shared scoped worker mechanics (F09)

**Files:** process-embedding.ts, process-sparse-embedding.ts, process-reranker.ts, ace-mcp.ts; existing process worker contracts.

- [ ] Reproduce interrupted startup/request using deterministic child-ready/request-started barriers.
- [ ] Use Effect 3.22.3 interruption cleanup/acquireRelease with Node streams; consolidate ready/pending/framing/deadline mechanics, keeping task-specific validation.
- [ ] Define maximum incomplete JSONL record/pending work, UTF-8 chunk handling, write backpressure and late-response disposition. Caller interruption immediately unregisters its pending entry/timer or startup waiter. Caller cancellation is not proof that synchronous Python inference stopped; define bounded retirement of a hung worker and explicit failure of its outstanding requests.
- [ ] Give runtime composition one cleanup owner covering dense, sparse and reranker, including partial startup failure. One release failure must not skip other releases.
- [ ] Migrate each adapter and delete its duplicate mechanics/tests in the same slice. Do not kill a shared worker for one cancelled request while unrelated requests are active.
- [ ] Test interruption, malformed output, cardinality/identity mismatch, worker exit, SIGTERM refusal and actual close; a deterministic concurrent-request case must prove cancelling one request cannot corrupt a surviving request. Refresh real embedding-timeout evidence when available.

**Exit/rollback:** three transport owners become one; revert adapters independently behind unchanged ports. No inference algorithm/model switch.

### X2 — sunset legacy MCP transport (F10)

**Files:** src/transport/mcp-stdio.ts, src/index.ts, test/mcp-stdio.contracts.test.ts; SDK adapter/conformance tests.

- [ ] Verify internal and public compatibility consumers; preserve any required API via a temporary SDK-backed adapter only.
- [ ] Move unique tool-schema/error assertions to official SDK Client/InMemoryTransport tests; verify format, working context and known evidence arguments.
- [ ] Delete old parser/framing/schema definitions and barrel export; remove redundant tests.
- [ ] Run SDK initialize/list/call/errors/concurrency/cancellation and executable interoperability cases with locked 2.3.1.

**Exit/rollback:** one MCP protocol owner; revert deletion if a real public compatibility consumer was missed, without restoring the old production path.

### X3 — gateway structural schema, then cancellation (F11/F12)

**Files:** src/domain/gateway-projection.ts, contracts/ace-gateway/v1/, gateway-projection-http.ts, gateway-projection-service.ts; integrations/bifrost/ace-connector/connector.go and plugin/main.go.

- [ ] First PR: add enum-array/unknown-field/required-data regressions to existing TS/schema/Go suites. Define strict Zod structural contracts, generate JSON schemas/types, keep semantic policy/digest checks explicit.
- [ ] Use directional fixtures: Go request encoding → TypeScript request decoding, and TypeScript decision encoding → Go decision decoding. The receiving side owns structural/semantic rejection; do not add unnecessary reciprocal decoders. Cover wrong primitive types, extra nested/root fields, invalid epochs, missing receipt data and trailing JSON. Generated schema must reproduce without diff.
- [ ] Delete superseded structural validators and handwritten schema ownership. Record any corrected rejection of formerly accepted invalid clients.
- [ ] Separate PR: pass Bifrost context into Project and propagate premature request abort or premature response closure to Effect/provider operations; keep bounded deadline admission. Do not treat every IncomingMessage.close as cancellation: normal request-body completion can emit it. Check completion state and remove listeners once the computation settles.
- [ ] Verify caller cancellation interrupts a stalled request and causes zero unauthorized/failed-projection provider sends; include a normal successful-request case proving it is not cancelled on body completion. Preserve protected fields and retry/fallback blocks.
- [ ] Build and recapture the pinned native-plugin route. Ordinary go test excludes the build-tagged native plugin and cannot certify it.

**Exit/rollback:** one structural contract with cross-language parity, standard cancellation throughout. Revert slices independently; keep strict routes blocked if new wire evidence fails.

### X4 — local metadata transaction decision, then staged migration (F13)

**Files:** application/file-workspace-store.ts, adapters/file-memory-archive.ts, file-projection-outbox.ts, local-memory-backup.ts and their owning ports/tests.

- [ ] Record local-filesystem and runtime assumptions, concurrency needs, archive sizes and recovery costs. Compare a maintained lock/atomic-write approach against a local SQLite transaction adapter. A heartbeat/timeout-based stale-lock reclamation is unacceptable unless stale writers are fenced; otherwise preserve fail-closed behavior. Select binding/version only after actual compatibility/license/advisory review.
- [ ] Spike the smallest owner: workspace metadata with unique root/workspace and conditional epoch update. Kill a writer inside the physical write primitive; demonstrate bounded restart recovery.
- [ ] If evidence favors SQLite, approve a local storage decision and migrate workspace metadata first. Do not rewrite all memory-domain rules in the spike.
- [ ] Consider archive metadata/tombstone and outbox migration only after separate evidence of benefit, not automatically after a successful workspace spike. Atomically register original metadata plus projection intent only where one store owns both. For external originals, require verified durable blob publication before metadata commit, and define recovery for orphan blobs, partial publication and interrupted last-reference deletion: a database transaction does not atomically include external files. Keep large original blobs external unless measured otherwise.
- [ ] Validate offline migration by digest/count/tombstone/receipt comparison. Forbid mixed old/new writers; retain verified backup and define export-based rollback after new writes.
- [ ] Delete each replaced JSON rewrite/lock implementation when its owner switches; update backup for database plus external originals, rather than assuming database backup includes blobs.

**Gates:** provider-and-multiprocess, projection-outbox, retained-memory-delete, local-memory-backup, test:memory-process; deterministic competing epochs/shared-digest deletion/import/stale receipt/writer-death cases. Graphiti crash-after-enqueue does not cover physical lock-owner death.

**Exit:** fewer physical transaction/lock owners with unchanged archive/outbox semantics, or an evidenced decision to retain the existing storage with a smaller shared maintained primitive.

### X5 — provider-native Vertex auth and Graphiti exact presence, separate PRs (F14/F15)

**Vertex files:** src/adapters/vertex-rag.ts and ace-mcp.ts credential composition; existing auth-refresh/data-policy/outbound-secret suites.

- [ ] Compare official auth-only wrapping against generated retrieveContexts client; verify region, runtime, credentials, automatic retry, timeout/cancellation and logging behavior.
- [ ] Preserve explicit gcloud identity compatibility; authorize before credentials and at every actual SDK transmission attempt, including automatic retries. Prove one allowed 401 refresh, no 403 refresh and no retry after policy denial; preserve bounded cancellation and disable/redact request/response logging. SDK defaults do not establish these guarantees.
- [ ] Remove only superseded token/subprocess/retry/wire code after parity. Run an already-authorized synthetic read-only real gate; no new cloud resources are implied.

**Graphiti files:** src/adapters/graphiti-mcp.ts, current projectionState port and lifecycle/delete suites.

- [ ] Verify deployed provider capability and group isolation; upstream or version a minimal exact episode-presence tool delegating to native UUID lookup.
- [ ] Prove existing-with-no-facts, true missing, cross-group UUID, outage and malformed replies. Empty derived entities are never an absence oracle. Exact lookup proves current existence/absence only, not that a previously accepted asynchronous add_memory cannot materialize later.
- [ ] Switch presence consumers and delete 100,000-entry listing only after real parity; otherwise keep current NOT_READY limit.
- [ ] Add a deterministic queued-before-delete/late-materialization case. Prove provider drain/cancel/fencing for already accepted work or return deletion blocked/incomplete; a local outbox fence cannot fence provider work already queued. This is a static-unconfirmed risk until reproduced. Run existing real lifecycle/crash gates and preserve pending enqueue/tombstones.

**Exit/rollback:** one narrower provider boundary per PR; restore explicit old adapter/capability with honest limits if parity fails. Do not replace durable outbox with Graphiti's volatile queue.

### X6 — Harbor-native jobs, one observation reader and obsolete wrappers (F16/F18/F19)

**Files:** harbor-four-arm-trial-evidence.ts, harbor-feedback-trial-evidence.ts, application/harbor-byte-binding.ts, domain/harbor-three-arm.ts and harbor-four-arm.ts; prepare/freeze/collect/report scripts; release-preflight wiring.

- [ ] Pin actual Harbor runtime and validate emitted JobConfig/EnvironmentConfig using that model. The inspected v0.24.0 EnvironmentConfig includes type/delete/mounts; stale local comments saying otherwise are not contracts.
- [ ] Extract the shared raw trial observation DTO/reader before deleting old variants: feedback currently maps ace_optional to a four-arm dense label. Preserve every usage/cache/failure/unknown field and ACE receipt link.
- [ ] Move generic job normalization out of harbor-three-arm before changing harbor-byte-binding. Migrate release-preflight's explicit harborThreeArm input/schema and callers deliberately.
- [ ] Reuse Harbor Job/JobPlan for attempts and TrialResult usage totals only after equivalence fixtures. Harbor n_attempts expansion order differs from local grouped repeats; freeze experiment ordering or record/revalidate the intentional change.
- [ ] Retire superseded executable three/four-arm generators and duplicate readers with tests/package commands. Keep immutable raw evidence/holdouts and the justified Hermes OAuth adapter until native supported auth parity exists.
- [ ] Remove unreachable harbor-task-adapter.ts and harbor-runner.ts plus exports/implementation-only tests only after the compatibility inventory. Preserve the unique fixture-verifier assertions.
- [ ] Check historical harbor-ace-mcp.sh consumers. Replace startup pip/marker installation with the already verified runtime bundle if explicit MCP still needs a launcher; otherwise sunset only the obsolete launcher.
- [ ] Keep ACE-specific source/authorization/quality/receipt gates and unknown-not-zero telemetry. Verify one matched Hermes pair and compare old/new parsing on frozen historical artifacts; run container-runtime plus explicit MCP smoke for any launcher change.

**Exit/rollback:** Harbor owns orchestration, one ACE reader owns adaptation, release callers have a deliberate migration. Historical data remains untouched; a focused reader/CLI change can be reverted.

### X7 — Hermes request-local dedupe reuse decision (F17)

**Files:** integrations/hermes/ace_context_engine/engine.py and test_engine.py; pinned upstream compressor interface.

- [ ] Compare native and ACE exact-duplicate behavior on protected control/tool groups, same-name/different content, Unicode, opaque/multimodal blocks, recent tail, durable bytes and retry memoization.
- [ ] Prefer a supported exact-equality request-local seam contributed upstream. If native methods cannot meet the contract, record a justified minimal adaptation with its parity boundary.
- [ ] Remove local duplicate policy only when the selected seam passes; never reduce exactness or call a private truncated-hash helper solely to remove lines.
- [ ] Run real pinned Hermes integration and provider-bound projection evidence, separately from fallback-stub tests.

**Exit/rollback:** one proven dedupe policy or an explicit bounded justified adaptation. Native compaction inheritance and byte-stable durable transcript remain unchanged.

## 8. Dependency order, acceptance and stop conditions

**Retrieval critical path:** baseline/evidence reconciliation → R1 → R4; R2 → R3 → R5 → R6 → R7 → R8. R7 consumes all R1–R6 outputs. R4 may use a narrowly selected primitive investigated in X4, but must not depend on migrating all archive/memory storage. X1 can run independently before R8. X2–X7 are independent scoped follow-ups; shared contract changes are coordinated before callers switch.

**Baseline policy:** re-inspect code after each merged PR and close findings from current evidence. Do not keep executing a stale audit item merely because its checkbox remains empty. A rejected replacement candidate is closed by an explicit reason and retained invariant evidence, not by an automatic rewrite.

For each finding/PR record:

- old owner and behavior; selected upstream/source and reuse mode;
- preserved observable contracts and explicit deviations;
- files/symbols removed, unique tests retained, remaining compatibility sunset;
- exact commands and current-SHA runtime/provider/wire evidence;
- risks, migration/rollback procedure and blocked checks;
- whether anything changed about production approval or benchmark claims (normally no).

Stop and return to source/decision review if:

- a new algorithm/lifecycle substitutes for a named upstream without parity;
- the proposed package cannot preserve a required source/policy/identity invariant;
- a generic SDK/ordering/alias feature is presented as a transaction/fence without proof;
- a component scheduled for removal gains another permanent state owner;
- a benchmark/evidence reader is deleted while release/feedback callers still depend on it;
- custom code is called a duplicate only because it is long or local;
- mocks or historical SHA reports are used to close a new real-provider gate.

**Completion criterion:** the active path has fewer independent algorithm/protocol/lifecycle owners, not merely more modules or green local tests. Current verified source, authorized delivery, recovery safety and accepted task quality must remain intact.
