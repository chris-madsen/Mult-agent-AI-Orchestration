# Plan: compose Aider RepoMap + ast-grep CST/AST + real LSP + Qdrant into a smaller ACE retrieval path

**Date:** 2026-10-26  
**Status:** PROPOSED — owner approval required before implementation.  
**Goal:** replace the current overgrown retrieval/index lifecycle with a thin, measurable pipeline built mostly from maintained components and small, attributed adaptations from Aider and Claw Code.  
**Related:** Issue #171, PR #175 (tactical fixes to the existing pipeline), `docs/reviews/2026-10-26-ace-hermes-token-economics-and-benchmark-bloat-review.md`.

## Source pins used for this design

- **Aider:** `Aider-AI/aider@5dc9490bb35f9729ef2c95d00a19ccd30c26339c`, Apache-2.0.
  - `aider/repomap.py`: Tree-sitter tags, disk cache, def/ref graph, PageRank ranking, token-budgeted tree rendering.
- **Claw Code:** `ultraworkers/claw-code@8aab1d4e5410f9ab5e5e7f03c8a87de479e814ec`, repository license MIT.
  - `rust/crates/claw-rag-service/src/ingest.rs`: changed-file ingest using size/mtime + content hash, batching, deletion cleanup.
  - `rust/crates/claw-rag-service/src/qdrant_index.rs`: official Qdrant client, simple collection/upsert/query boundary.
  - `rust/crates/claw-analog/src/lib.rs`: thin `retrieve_context` HTTP/tool boundary with timeout/top-k caps.
  - `rust/crates/runtime/src/lsp_client.rs`: useful action/status vocabulary only; **not** a complete external LSP transport.
- **ACE baseline:** `chris-madsen/Mult-agent-AI-Orchestration@b0484c7b189e2fd0b505430e8448f7560489e7df`.

### Provenance rule for Claw Code

Claw Code historically grew out of the Claude Code leak. Do **not** copy reconstructed Anthropic TypeScript, parity reference snapshots, `src/reference_data/subsystems/`, or any material whose authorship is ambiguous. If code is reused, restrict it to clearly later, independently authored MIT Rust modules with normal commit provenance (for example the RAG service added by `a4efdc43` on 2026-05-25), preserve license notices, and prefer reimplementation of small ideas over wholesale copying.

## Executive decision

Do **not** glue Aider, Claw Code and ACE together as three runtimes. That would recreate the same complexity problem.

The target is one small ACE retrieval subsystem in TypeScript:

```text
Hermes / ACE ContextEngine
        |
        v
  ContextAssembler  ----------------------+
        |                                 |
        | cheap structural prior          | semantic retrieval
        v                                 v
  RepoMapProvider                    QdrantClient
  (Aider algorithm)                  (official JS SDK)
        ^                                 ^
        |                                 |
        +------ shared SymbolIndex -------+
                    ^
                    |
              @ast-grep/napi
              changed files only
                    ^
                    |
          WorkspaceSync / FileState
        git status + watcher + hashes
                    |
                    +----> exact reread before delivery

Top semantic candidates
        |
        v
  LspSemanticProvider
  (existing real ACE LSP JSON-RPC)
        |
        v
definitions / references / hover only when useful
```

Principle: **Aider decides what is structurally important, Qdrant finds semantically similar code, LSP expands relationships, exact file reread proves freshness, and one context assembler spends the token budget.**

No Graphiti, Vertex, Bifrost, sparse vectors, reranker, four-arm benchmark or additional gateway is required for the first working code-retrieval slice.

---

# The five concrete zones

## 1. AST / CST

### Reuse

**Use maintained ast-grep directly in-process through `@ast-grep/napi`.**

Aider demonstrates the right abstraction: parse source once, extract definitions/references, cache by file identity, then build a graph. Aider's `RepoMap.get_tags_raw()` is the reference for the *information* we need, not a reason to run the whole Aider application.

Use Aider's Apache-2.0 logic as the behavioral reference for:

- definition/reference tags;
- per-language tag queries;
- line/range identity;
- fallback behavior when a language provides definitions but weak references.

### Do not reuse

- Do not keep spawning `ast-grep outline` once per file.
- Do not write another parser.
- Do not copy Aider's Python Tree-sitter runtime into production just to obtain ASTs.
- Do not make LSP responsible for parsing the whole repository.

### ACE change

Replace the long-lived role of `src/adapters/ast-grep-structural.ts` with a thin in-process adapter:

```text
AstProvider.parseChangedFile(bytes, language)
  -> symbols[]
  -> definitions[]
  -> lightweight references[]
  -> exact byte ranges
```

The adapter should use `@ast-grep/napi` parse/traversal APIs. The current PR #175 batched-CLI fix is a valid tactical improvement, but this plan treats CLI batching as transitional; NAPI removes process startup entirely.

### Acceptance

- Parse the same 1,000-file fixture with **no child process per file**.
- Unicode byte ranges match exact source bytes.
- Changed-file parse cost is proportional to changed files, not repository size.
- Existing AST contract tests remain or are replaced with equivalent, smaller NAPI tests.

---

## 2. LSP

### Reuse

Keep ACE's **real** LSP transport/process implementation (`src/adapters/lsp-semantic.ts` and the smallest necessary support around it).

Borrow from Claw Code only the clean LSP surface vocabulary:

- diagnostics;
- hover/type info;
- definition;
- references;
- symbols;
- connected/disconnected/starting/error status.

### Important finding

Claw Code's current `LspRegistry` is **not** a complete replacement for our LSP implementation. Its own parity document says external language-server process orchestration remains separate, and non-diagnostics dispatch currently returns a structured “dispatched” placeholder. Replacing ACE LSP with it would be a regression.

### Target behavior

LSP becomes an **on-demand enrichment stage**, not an indexing prerequisite.

```text
Qdrant / RepoMap -> top 3-6 symbol hits
                         |
                         +-> LSP definition/references only for those hits
```

Do not run LSP across every indexed file during startup. A query that only needs a literal/structural answer may need zero LSP calls.

### Acceptance

- Real `typescript-language-server` process proves definition + references on a multi-file fixture.
- LSP unavailable => retrieval still returns AST/Qdrant evidence marked without semantic confirmation.
- LSP latency and calls are reported separately.
- One request never starts a fresh LSP server per candidate.

---

## 3. File freshness / synchronization

This is where the current ACE is most over-engineered on the hot path: `makeQdrantContextProvider.search()` can call a workspace snapshot that recursively reads/hashes the repository.

### Reuse

Combine two proven/simple patterns:

**Aider**
- cache parsed tags by cheap file identity (currently mtime).

**Claw RAG**
- use size + mtime as a cheap change filter;
- hash content before accepting a changed file;
- update only changed files;
- delete stale index rows for deleted files.

### Improve on both for ACE correctness

Use a two-level freshness model:

1. **Cheap sync detection**
   - startup: enumerate eligible files once;
   - before query: `git status --porcelain=v2 -z --untracked-files=all` plus HEAD identity;
   - when HEAD changes: `git diff --name-only <old>..<new>`;
   - optional filesystem watcher only as a wake-up signal, never as source of truth;
   - non-git fallback: cached size+mtime scan.

2. **Exact delivery verification**
   - Qdrant payload stores `content_hash`, `path`, symbol/range and index revision;
   - before a snippet is sent to Hermes, reread **only selected files**;
   - hash exact bytes and compare to indexed payload;
   - mismatch => drop/stale the hit, synchronously reindex that path, then retry bounded once.

This preserves ACE's strongest property — “do not call stale evidence current” — without hashing every file on every query.

### New state record

```ts
type FileState = {
  path: string;
  size: number;
  mtimeMs: number;
  contentHash: string;
  astVersion: string;
  indexedAt: number;
};
```

Store this in one small local metadata database/cache. SQLite is acceptable; the point is to avoid inventing a custom database protocol.

### Acceptance

- Edit one file in a 10k-file fixture: only that file is parsed/re-embedded.
- Delete/rename/add are reflected before a query claims complete coverage.
- A deliberately missed watcher event is still caught by Git/status reconciliation.
- A file modified between retrieval and delivery is never labelled current.
- No normal query performs a full content read/hash of all repository files.

---

## 4. Repository indexing / cache

### Reuse from Aider

Port/adapt the small core of `RepoMap`, with Apache-2.0 attribution:

- tag cache semantics;
- def/ref graph;
- PageRank-style file/symbol importance;
- personalization for mentioned/open files and identifiers;
- token-budgeted repo-map rendering;
- context around lines of interest.

Do **not** vendor the whole Aider CLI. The production implementation should expose a tiny interface:

```ts
interface RepoMapProvider {
  update(changedFiles: ChangedFile[]): Promise<void>;
  map(query: QueryHints, tokenBudget: number): Promise<RepoMapResult>;
}
```

The first implementation can be validated against `aider --show-repo-map` on frozen fixtures. Once parity is sufficient, the runtime no longer needs Aider installed.

### Reuse from Claw RAG

Adapt the **incremental ingest shape** from `claw-rag-service/src/ingest.rs`:

```text
enumerate
 -> cheap unchanged check
 -> read/hash changed file
 -> AST symbol chunks
 -> embed in batches
 -> Qdrant upsert
 -> delete removed paths
 -> persist file metadata
```

Do **not** reuse Claw's character-window `chunk_text(900, 120)` for code. Our chunks should be AST/CST symbols/functions/classes, with a bounded file-level fallback only when no structural node is available.

### Qdrant

Replace hand-written REST payload management in the hot path with the official TypeScript client `@qdrant/js-client-rest`.

Initial schema: **dense only**.

Payload per point:

```ts
{
  workspaceId,
  path,
  contentHash,
  symbolName,
  symbolKind,
  startByte,
  endByte,
  startLine,
  endLine,
  repoRank,
  indexRevision
}
```

One stable collection per workspace + embedding identity is enough for MVP. Use deterministic point IDs from `workspace + path + contentHash + range`.

Do not introduce collection-per-snapshot churn unless a measured concurrency/correctness requirement forces it.

### Why dense only first

PR #175 already fixes the bug where dense mode depended on sparse-worker. Preserve that simplification. Sparse/RRF and reranking return only after dense retrieval is measured and shown insufficient on a frozen holdout.

### Acceptance

- Cold index, warm startup, one-file edit, rename and delete are measured.
- Warm startup does not recompute embeddings for unchanged content.
- Qdrant is accessed through the official client, not a second home-grown HTTP schema layer.
- No O(N²) candidate accumulation.
- A 10k-file one-file edit scales approximately with changed content, not with all candidates.

---

## 5. Context delivery

This should be the **unique ACE layer**. Everything below it is retrieval plumbing.

### Reuse from Claw

Adopt the thin boundary demonstrated by `claw-analog`:

- one retrieval call;
- explicit timeout;
- bounded top-k;
- structured results;
- agent runtime does not own index lifecycle.

In our case the boundary can remain an in-process port initially, but its contract should look service-like so it can be moved out later without changing Hermes:

```ts
retrieve({
  workspaceId,
  query,
  openFiles,
  mentionedIdentifiers,
  tokenBudget,
  topK
}) -> ContextBundle
```

### Compose the result

For one query:

1. **RepoMap** creates a cheap structural prior under ~20–30% of the context budget.
2. **Qdrant dense search** returns semantic symbol candidates.
3. Merge/dedupe by `path + range`; use repo-map rank as a small prior, not a second opaque scorer.
4. **LSP** enriches only the strongest candidates when definitions/references are useful.
5. **Exact reread/hash** selected files.
6. Context assembler packs:
   - short repo-map;
   - exact source snippets;
   - minimal LSP edges;
   - source/path/range/hash metadata.
7. Stop at the requested token budget.

### No unconditional context injection

Hermes must receive the ACE projection only when it replaces more expensive history/context or when the agent explicitly requested retrieval. Do not append repo-map + Qdrant + LSP material blindly to every turn.

### Acceptance

- One real task proves Hermes receives the exact selected context.
- Every delivered code snippet has current-byte verification.
- Context fits an explicit token budget.
- Native vs ACE provider-measured tokens/cost + task correctness are recorded.
- If the same task is worse with ACE, stop and diagnose; do not add more layers.

---

# What to keep, replace and delete in current ACE

| Current ACE area | Decision |
| --- | --- |
| `src/adapters/lsp-semantic.ts` | **KEEP/SIMPLIFY** — it is more real than Claw's placeholder registry. |
| `src/adapters/typescript-language-service.ts` | **AUDIT** — keep only if it owns behavior not covered by generic LSP; otherwise choose one semantic path. |
| `src/adapters/ast-grep-structural.ts` | **REPLACE** CLI process boundary with `@ast-grep/napi`; retain only normalization/byte-range contracts that add value. |
| `src/adapters/local-code-index.ts` | **REPLACE** with incremental changed-file indexer + metadata cache. |
| `src/adapters/qdrant-context-provider.ts` (~62 KB) | **DECOMPOSE/DELETE MOST** — Qdrant adapter, sync, LSP enrichment, source verification and context assembly must not live in one file. |
| Qdrant portion of `src/adapters/http-provider-boundaries.ts` | **REPLACE** with official Qdrant JS client. Keep unrelated Vertex/Graphiti code only if still required elsewhere. |
| `src/adapters/node-workspace-port.ts` | **KEEP path safety/exact read; REMOVE full-repo hashing from query hot path.** |
| `src/bin/ace-mcp.ts` (~52 KB) | **SHRINK** — composition/config only; no giant index lifecycle. |
| benchmark three/four-arm generations | **NO NEW WORK** until one real Hermes A/B works. |
| PR #175 linear-index + dense/sparse fixes | **KEEP** as correct tactical fixes; batch CLI is transitional if NAPI lands. |

Target after migration: the active code-retrieval path should be understandable in roughly five modules, not dozens:

```text
src/retrieval/
  workspace-sync.ts
  ast-provider.ts
  repo-map.ts
  qdrant-index.ts
  context-assembler.ts

src/adapters/
  lsp-semantic.ts           # retained/simplified
  node-workspace-port.ts    # exact safe reads only
```

Names are illustrative; avoid creating duplicate parallel modules before deleting/moving the old owners.

---

# Implementation sequence

## Phase 0 — freeze behavior and source provenance

- [ ] Record current main SHA, PR #175 status and one frozen retrieval fixture.
- [ ] Add an attribution/provenance note listing the exact Aider and Claw source pins used.
- [ ] Do not import reconstructed Claude/Anthropic source.
- [ ] No new benchmark framework.

**Exit:** approved source/ownership map and deletion targets.

## Phase 1 — Qdrant thin client + incremental file state

- [ ] Add official `@qdrant/js-client-rest`.
- [ ] Implement small file-state cache using Claw-style size/mtime/hash changed-file logic.
- [ ] Keep dense vectors only.
- [ ] Migrate upsert/query/delete to the official client.
- [ ] Real Qdrant fixture: cold, warm, edit-one, rename, delete.

**Exit:** semantic retrieval works without `qdrant-context-provider.ts` owning synchronization.

## Phase 2 — NAPI AST/CST + Aider RepoMap

- [ ] Add `@ast-grep/napi`; parse changed source bytes in-process.
- [ ] Port/adapt Aider def/ref graph + PageRank + token-budget map with attribution.
- [ ] Reuse one parsed symbol record for both RepoMap and Qdrant chunks.
- [ ] Compare frozen output/ranking with Aider `--show-repo-map`.

**Exit:** repo map + symbol index update only changed files; no ast-grep process-per-file.

## Phase 3 — freshness correctness

- [ ] Git-based changed-path reconciliation before query.
- [ ] Exact reread/hash only selected files before delivery.
- [ ] Bounded reindex/retry when selected hit is stale.
- [ ] Missed-watcher and mid-request-edit regression tests.

**Exit:** no stale result can be labelled current and normal query cost is not O(repository bytes).

## Phase 4 — on-demand LSP enrichment

- [ ] Retain one real ACE LSP transport.
- [ ] Start/reuse server per workspace/language.
- [ ] Call definitions/references only on top candidates.
- [ ] Remove duplicate semantic path if equivalent.

**Exit:** LSP improves evidence without being required for basic retrieval.

## Phase 5 — one context assembler and Hermes A/B

- [ ] Merge RepoMap prior + Qdrant hits + optional LSP edges.
- [ ] Exact token budget; no unconditional append.
- [ ] Run one real Hermes native vs Hermes+ACE task with provider usage.
- [ ] If positive or diagnostically useful, repeat; otherwise fix one observed cause.

**Exit:** first honest answer to “does the composed retrieval help the agent?”

## Phase 6 — negative-diff cleanup

Only after Phases 1–5 are working:

- [ ] Delete superseded raw Qdrant HTTP code.
- [ ] Delete old full-snapshot/reconciliation machinery no longer on the hot path.
- [ ] Delete old AST CLI lifecycle after NAPI equivalence.
- [ ] Collapse duplicate LSP paths.
- [ ] Remove obsolete tests with their code owners, retaining unique safety/correctness coverage.
- [ ] Keep historical reports/ADRs as evidence, not runtime dependencies.

**Exit:** production code and tests have a meaningful negative diff; old path is not silently retained “just in case”.

---

# Minimal data contracts

## SymbolRecord

```ts
type SymbolRecord = {
  path: string;
  contentHash: string;
  language: string;
  name?: string;
  kind: string;
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
  text: string;
  definitions?: string[];
  references?: string[];
};
```

## RetrievalHit

```ts
type RetrievalHit = {
  symbol: SymbolRecord;
  vectorScore?: number;
  repoMapScore?: number;
  lspVerified?: boolean;
};
```

## DeliveredContext

```ts
type DeliveredContext = {
  repoMap: string;
  snippets: Array<{
    path: string;
    range: [number, number];
    contentHash: string;
    text: string;
    reason: "semantic" | "repo_map" | "lsp";
  }>;
  tokenEstimate: number;
  freshness: "current" | "partial";
};
```

Keep these contracts small. Do not expose Qdrant collection lifecycle, AST parser internals or LSP process state to Hermes.

---

# Tests that matter

The first implementation should have **few high-value tests**, not another hundred-file suite:

1. AST Unicode/range exactness.
2. RepoMap ranking parity on a frozen small fixture.
3. Incremental cache: unchanged file = no parse/no embedding.
4. Add/edit/delete/rename sync.
5. Missed watcher caught by Git reconciliation.
6. Mid-request source edit rejected before delivery.
7. Real Qdrant dense query.
8. Real LSP definition/reference on two files.
9. End-to-end retrieval on this repository.
10. One real Hermes task + provider-measured A/B.

Everything else is secondary until these are green.

---

# Expected outcome

The desired architecture is **not** “Aider inside Claw inside ACE”. It is:

- Aider's proven **repo-map algorithm**;
- ast-grep's maintained **in-process CST/AST engine**;
- ACE's existing **real LSP JSON-RPC**;
- Claw RAG's simple **incremental ingest/service boundary**;
- official **Qdrant client**;
- ACE's unique **freshness verification + token-budgeted context delivery**.

This should remove the need for a giant provider that simultaneously owns workspace snapshots, vector lifecycle, LSP, ranking, source verification, benchmark telemetry and context assembly.

The success metric is not code reuse percentage. It is: **one small retrieval path that works on the current repository, updates one changed file cheaply, delivers current exact code to Hermes, and can be measured against native Hermes before more infrastructure is added.**
