# Execution plan: finish the Aider + Claw retrieval composition after PR #177

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

Port/adapt the small core ideas, not the Aider CLI:

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

Study/adapt:

- `lsp_discovery.rs`
- `lsp_client/`
- `lsp_process/`
- action/status model

Do **not** port Claw's hand-written stdio framing; keep `vscode-jsonrpc`.

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
