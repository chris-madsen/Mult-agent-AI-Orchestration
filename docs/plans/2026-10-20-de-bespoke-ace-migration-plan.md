> **Status update — 2026-10-21:** PR #94 implemented the core de-bespoke migrations: ast-grep production structure, generic LSP, Qdrant immutable collections/atomic alias publication, content-addressed vector reuse, deletion of filesystem snapshot/lease/caches, request-time reconciliation and explicit source obligations. This plan is now historical migration guidance. **Current next-step plan:** [2026-10-21-cursor-like-hybrid-context-completion-plan.md](2026-10-21-cursor-like-hybrid-context-completion-plan.md).

# ACE de-bespoke migration plan — replace custom infrastructure with maintained engines

**Date:** 2026-10-20  
**Baseline:** `main` @ `01d469eba0b98faaac896711113f963317e12566` before this plan.  
**Purpose:** stop expanding ACE-specific parser/index/lifecycle infrastructure where mature provider primitives already exist. Preserve ACE's product-specific policy, provenance and context contract; delete implementation machinery that duplicates Tree-sitter/ast-grep, language servers, Qdrant, Git/worktree state or Graphiti.

This plan supersedes the implementation direction in the restored [remaining-work review](../reviews/2026-10-20-ace-remaining-work-and-benchmark-readiness.md) where that direction asks ACE to grow its own incremental-index, semantic-project or Qdrant coordination framework. Historical findings/evidence remain historical truth.

## 1. Owner decision: buy before build, aggressively

ACE is an orchestration/context product, not a parser vendor, language-server vendor, vector-database coordinator or filesystem database.

From now on:

1. **Structural syntax:** use **ast-grep/Tree-sitter as a product**, not Tree-sitter as a low-level library around which ACE writes per-language extractors.
2. **Semantic code intelligence:** use real **language servers / compiler-backed servers** behind a small generic LSP boundary. Do not grow a bespoke in-process semantic project manager.
3. **Vector publication and atomic cutover:** use **Qdrant collections + atomic aliases**. Do not maintain a parallel filesystem database of Qdrant publication state and reader leases unless a measured gap remains after provider-native primitives are exercised.
4. **Change truth:** source bytes / Git/worktree state are authoritative. Do not reproduce Cursor's Merkle implementation merely because Cursor uses one. Merkle/change trees are an optimization, not product logic.
5. **Embedding reuse:** key reuse by **chunk content + embedding-provider identity**, not by custom parser generations. Use Qdrant/provider storage for vectors; do not add another file-backed cache unless measurements prove it necessary.
6. **Temporal memory:** use Graphiti/FalkorDB for derived graph/search and keep only the minimum ACE archive/outbox needed for immutable source provenance and recoverable projection. Do not reimplement Graphiti query/history semantics in ACE.
7. **Routing:** let the agent/request state explicit source obligations. Do not build a semantic router to replace a keyword router before measurement proves a router is needed.

A custom subsystem now needs evidence that the maintained upstream primitive cannot satisfy the observable ACE contract.

## 2. Why this change is justified

### Cursor is an architecture analogy, not a component to clone

Cursor publicly describes codebase indexing as:

```text
change detection / Merkle tree
    -> syntactic chunks
    -> embeddings
    -> content-addressed reuse of unchanged chunk embeddings
```

The lesson for ACE is the separation of concerns, not “implement our own Merkle tree”. ACE already has authoritative workspace snapshots and exact source digests. We should reuse those until profiling proves a maintained incremental change engine is needed.

Reference: https://cursor.com/blog/secure-codebase-indexing

### ast-grep already solves the structural layer we are hand-writing

Current ast-grep provides:

- polyglot Tree-sitter parsing;
- built-in language support;
- structural search;
- `outline` specifically for code-agent navigation;
- JSON output with symbol names, types, AST kinds and exact byte/line ranges;
- imports/exports/members;
- custom outline rules for languages outside bundled coverage.

That is almost exactly the contract our custom `NAME_NODES` walker is trying to grow into.

References:
- https://ast-grep.github.io/reference/cli/outline
- https://ast-grep.github.io/guide/outline-code
- https://ast-grep.github.io/reference/languages

### Qdrant already solves atomic index cutover

Qdrant collection aliases can point queries at one collection while another is built. Alias actions are atomic, including delete-old/create-new in one operation. This is a better ownership boundary than an ACE filesystem lease database coordinating which payload generations may be deleted from a shared collection.

References:
- https://qdrant.tech/documentation/manage-data/collections/#collection-aliases
- https://qdrant.tech/documentation/operations/snapshots/

### A real LSP process should own semantic project lifecycle

For TS/JS, `typescript-language-server --stdio` is a maintained thin LSP layer over tsserver. For other languages ACE should configure a real server appropriate to that language. ACE only needs a small generic LSP client boundary and version/capability evidence.

References:
- https://github.com/typescript-language-server/typescript-language-server
- https://github.com/microsoft/vscode-languageserver-node

Serena remains useful as a ready-made multi-language candidate/tool surface, but the retained comparison (TS-LS 9/9 versus Serena 7/9 on our oracle) means it must not be declared the semantic truth provider by convenience alone.

## 3. What ACE should still own

Do **not** confuse “remove bikes” with “remove ACE”.

ACE-specific responsibilities remain:

- MCP facade and agent-neutral tool contract;
- workspace registration / authorization;
- data-class and outbound policy;
- exact source re-read before citation;
- provenance: workspace/path/digest/range/provider identity;
- required/optional source coverage and truthful partial/not-ready results;
- ContextBundle composition and lossless expansion;
- immutable original session archive;
- admission policy for what may become project memory;
- Graphiti projection provenance and deletion intent needed to protect source truth;
- provider tracing, benchmark attribution and release acceptance;
- current-code-over-derived-doc conflict policy.

Everything below those contracts should be delegated when an upstream engine already has the primitive.

## 4. Current bespoke inventory and disposition

| Current subsystem | Problem | Disposition |
|---|---|---|
| `scripts/tree-sitter-structural.py` + hard-coded `NAME_NODES` | ACE owns language-specific symbol extraction and only really handles TS/JS | **DELETE** after ast-grep outline parity |
| Python `tree-sitter`, `tree-sitter-typescript` | required only by the helper above | **DELETE** after ast-grep migration |
| `ast-grep-py` | installed but current structural path does not use it | **DELETE**; use one pinned ast-grep CLI/NAPI implementation instead |
| `pygls` | no current production use found | **DELETE** unless a concrete consumer is identified |
| `compilerSpans()` fallback in `local-code-index.ts` | second custom language-specific parser path | **DELETE**; unsupported structural provider must be explicit rather than secretly switching parsers |
| `src/adapters/tree-sitter-structural.ts` | subprocess protocol exists only to feed custom Python extractor | **REPLACE** with thin ast-grep outline adapter |
| `src/adapters/typescript-language-service.ts` custom LS host | ACE owns script snapshots/project setup/version semantics | **REPLACE** with generic LSP adapter + maintained TS server |
| `file-structural-analysis-cache.ts` | caches output of a fast local parser in ACE-owned storage | **DELETE unless benchmark proves it pays for itself** |
| `file-code-candidate-cache.ts` | another ACE file database for derived candidates | **DELETE unless benchmark proves it pays for itself** |
| `file-qdrant-snapshot-state.ts` (~565 LOC) | ACE reimplements publication, leases, ownership and GC around Qdrant | **REPLACE** with Qdrant snapshot collections + atomic alias |
| `workspace-manifest.ts` diff/rename engine | duplicates source-control/change bookkeeping | **SHRINK** to an identity/check function, or remove if the workspace snapshot/Git provider supplies the needed identity directly |
| custom candidate ID coupled to file digest/range | an unchanged chunk inside an edited file loses embedding reuse | **SPLIT** source citation identity from `embeddingKey = hash(provider + chunk bytes)` |
| custom semantic dependency fingerprint logic in `ace-mcp.ts` | runtime hand-builds a partial model of TS project lifecycle | **DELETE with LSP migration**; server/project config becomes semantic provider identity |
| immediate Qdrant generation GC + reader lease model | creates race/locking complexity | **DELETE**; retain old snapshot collections conservatively and prune asynchronously |

Implementation-specific tests for deleted machinery should be removed with it. Keep black-box correctness tests that express observable contracts.

## 5. Target code-retrieval architecture

```text
authoritative worktree / Git
        |
        | changed file set / snapshot identity
        v
ast-grep outline (polyglot structural chunks + byte ranges)
        |
        | chunk bytes + chunk hash
        v
FastEmbed (or approved embedding provider)
        |
        | vectors keyed by embedding-provider + chunk-content hash
        v
Qdrant snapshot collection: ace_<workspace>_<indexKey>
        |
        | verify completeness
        v
atomic alias switch: ace_<workspace>_current
        |
        v
semantic search
        |
        +--> exact current source reread
        |
        +--> real LSP server for definition/reference/type verification
        |
        v
ACE provenance / coverage / ContextBundle
```

### Core consequence

The **published Qdrant alias**, not a filesystem JSON manifest, is the public vector-index pointer.

The **worktree/source digest**, not Qdrant payload, is source truth.

The **language server**, not ACE's custom TS host, owns semantic project state.

The **ast-grep outline output**, not ACE's hand-maintained node table, owns structural declaration discovery.

## 6. Migration A — replace custom Tree-sitter extraction with ast-grep outline

### Implementation

- Add one pinned ast-grep distribution, preferably `@ast-grep/cli` or `@ast-grep/napi`; do not keep parallel Python and Node ast-grep stacks.
- Prefer `ast-grep outline --json=stream --items structure --view expanded` for a path/file set.
- Map only the stable output fields ACE needs:
  - path;
  - language;
  - name;
  - symbolType;
  - AST kind;
  - byte offsets;
  - line/column range;
  - optional import/export/public metadata.
- Flatten members into candidate chunks only when useful for retrieval.
- Chunk bytes come from the authoritative ACE read, not from trusting an external cached text copy.
- Use ast-grep's bundled language support first. Add project outline rules only for a concrete language gap.
- Pin the ast-grep version because `outline` is still an evolving surface; ACE's adapter schema isolates that evolution.

### Delete after parity

- `scripts/tree-sitter-structural.py`;
- `src/adapters/tree-sitter-structural.ts`;
- `tree-sitter`, `tree-sitter-typescript`, `ast-grep-py` provider requirements;
- `compilerSpans()` as an alternate production structural parser.

### Acceptance

The replacement must pass the existing exact-range/Unicode/large-file fixtures and add small Python/Rust/Go structural smoke fixtures. It does **not** need semantic reference correctness; that belongs to LSP.

## 7. Migration B — replace custom TS LanguageService host with real LSP

### Implementation

- Introduce a generic `LspSemanticAnalysisPort`.
- Use a maintained JSON-RPC/LSP client library rather than hand-framing protocol messages.
- TS/JS initial server: `typescript-language-server --stdio`, bound to the repository's pinned TypeScript runtime after compatibility verification.
- Requests:
  - `textDocument/definition`;
  - `textDocument/references`;
  - `textDocument/hover` for type/info;
  - diagnostics through standard server notifications/requests as supported.
- Open/update documents through normal LSP lifecycle. Let the server own script versions, tsconfig/project references and dependency invalidation.
- Provider identity records server version, underlying compiler/runtime version, root/workspace and relevant configuration digest.
- For Python/Rust/Go/etc., configure a language server; do not add language-specific semantic branches to ACE core.

### Serena

Keep Serena as:

- a benchmarked ready-made alternative;
- optional extra tooling where its higher-level operations help;
- not a mandatory semantic backend while the retained oracle has unresolved mismatches.

Re-evaluate Serena when its API/version fixes the two retained gaps or when multi-language agent-level value outweighs them.

### Delete after parity

- `src/adapters/typescript-language-service.ts`;
- manual TS semantic snapshot version logic whose sole purpose was compensating for the custom host.

### Acceptance

The new TS LSP path must at least preserve the current 9/9 semantic oracle before the old adapter is deleted.

## 8. Migration C — Qdrant-native publication instead of filesystem snapshot coordination

### New model

For each complete index:

```text
collection = ace_<workspace-key>_<embedding-key>_<index-key-prefix>
alias      = ace_<workspace-key>_<embedding-key>_current
```

1. Build a new collection without changing the alias.
2. Upsert all candidate points for that immutable snapshot.
3. Verify candidate membership/count and stored snapshot metadata.
4. Atomically switch the alias from old collection to new collection.
5. Serve new queries through the alias.
6. Retain the previous collection for a conservative grace window / bounded number of generations.
7. Delete old collections asynchronously. Never make correctness depend on immediate GC.
8. Use Qdrant snapshot APIs for actual storage backup/restore evidence.

### Why this removes code

The current custom layer maintains:

- publish state;
- owner IDs;
- lease files;
- process liveness;
- lease locking;
- active-key scanning;
- GC fencing;
- building/published manifests.

With immutable collections + atomic alias publication, most of that is provider responsibility. A crashed builder leaves an unaliased collection; cleanup can remove it later. It cannot become current by accident.

### Embedding reuse

Do not tie reuse to `candidateId`.

Use:

```text
embeddingKey = SHA256(
  embeddingProviderIdentity
  + "\0"
  + chunkContentBytes
)
```

Source candidate identity remains workspace/path/range/digest-specific for provenance.

During the build, reuse a vector for an identical `embeddingKey` from the previous snapshot/provider cache; embed only misses.

### Delete after provider-native race/crash tests

- `src/adapters/file-qdrant-snapshot-state.ts`;
- snapshot lease files/state owner/GC locks;
- lease-specific tests and failpoints that no longer represent production behavior.

Keep only black-box tests:

- crash before alias switch => old alias remains current;
- crash after collection build before switch => old alias remains current;
- concurrent builders => exactly one complete collection becomes current, never a partial one;
- alias switch is atomic from the client view;
- old collection cleanup cannot affect current alias.

## 9. Migration D — simplify change detection and reuse

### Do not build our own Cursor clone

No custom Merkle tree in this milestone.

Use the existing authoritative `WorkspaceFilePort.snapshot()` / Git-aware workspace boundary to produce the current file set and exact digests. Optimize only after measuring it.

For a normal Git workspace, mature Git state can identify tracked/untracked/removed paths. ACE still hashes exact bytes it cites.

If live notification is later useful, use a maintained watcher only as a **wake-up hint**. Correctness remains:

```text
notification -> refresh authoritative snapshot -> build/publish if identity changed
```

not:

```text
notification == proof nothing else changed
```

### Simplify `workspace-manifest.ts`

Do not maintain a second rename detector merely for retrieval correctness. Rename is an optimization label; delete+add with identical content is correct.

Keep at most:

- normalized file identity;
- scope/config identity;
- deterministic snapshot hash;
- equality check.

Remove custom rename inference unless a benchmark proves it materially improves work.

## 10. Migration E — delete redundant file caches

ast-grep parsing is local and fast. Qdrant holds vectors. Source files are authoritative.

Therefore:

1. first implement chunk-content vector reuse;
2. benchmark with and without `file-structural-analysis-cache.ts`;
3. benchmark with and without `file-code-candidate-cache.ts`;
4. delete each cache unless it produces a material end-to-end win.

Do not keep a custom cache because deleting it feels risky. The benchmark decides.

The desired steady-state reuse hierarchy is:

```text
unchanged source bytes
 -> same ast-grep chunk bytes
 -> same embeddingKey
 -> vector reuse
 -> no model inference
```

not multiple independent ACE file databases.

## 11. Routing simplification

Keep the source-coverage domain model, but remove hidden correctness dependence on English keyword routing.

Add explicit request contract:

```text
required_sources: [code | structural | documentation | memory]
optional_sources: [...]
```

Existing `include_*` booleans remain compatibility sugar.

The default agent may choose source obligations. A heuristic router may suggest them, but it cannot make a required source disappear while still allowing `complete=true`.

Do **not** add another routing model until agent benchmarks show that explicit obligations + native tool choice are insufficient.

## 12. Memory simplification

The earlier F-01/F-02/F-03 fixes remain valid because they protect the immutable archive boundary, not because ACE wants to become a graph database.

Keep:

- immutable exact original;
- admission state;
- durable projection intent;
- deletion fence protecting source-vs-derived invariants;
- provenance join from graph hit back to original.

Prefer Graphiti/FalkorDB for:

- graph storage;
- entity/fact retrieval;
- temporal graph behavior supported upstream;
- provider-side pagination/filtering.

Do not build a second ACE temporal search engine to compensate for a Graphiti limitation. If upstream cannot satisfy a required as-of completeness contract, either:
1. use another supported Graphiti API/path;
2. constrain the advertised capability;
3. change provider after evidence.

## 13. Test-portfolio cleanup

As each custom subsystem is removed:

- delete unit tests that only prove its internal lock/file/cache algorithm;
- retain or add one black-box contract per user-visible invariant;
- keep real provider race/crash tests only for the architecture that will ship.

Examples:

**Delete eventually**
- filesystem lease lock implementation tests;
- custom Tree-sitter node-table tests;
- custom TS LanguageService host-version tests;
- file-cache serialization tests if those caches disappear.

**Keep**
- exact source bytes/ranges;
- current-vs-stale behavior;
- concurrent publication does not expose partial index;
- dirty-tree add/delete is reflected before `complete=true`;
- semantic definition/reference oracle;
- no unauthorized egress;
- natural agent benchmark.

Success is not “same number of tests after rewrite”. A smaller system should have fewer implementation tests.

## 14. Revised execution order

### Phase 0 — preserve evidence and stop expansion

- [x] Restore the accidentally corrupted remaining-work review from pre-PR92 history.
- [ ] Do not add more behavior to the custom Tree-sitter helper, Qdrant lease state or custom TS host.
- [ ] Mark those components migration-only / no-new-features until deleted.

### Phase 1 — structural replacement

- [ ] Add pinned ast-grep CLI/NAPI.
- [ ] Implement thin outline adapter.
- [ ] Pass TS/JS exact structural fixtures.
- [ ] Add minimal Python/Rust/Go outline fixtures.
- [ ] Delete Python structural helper + duplicate TS compiler span fallback + unused Python structural/LSP dependencies.

### Phase 2 — provider-native Qdrant lifecycle

- [ ] Implement immutable snapshot collections and current alias.
- [ ] Add atomic-switch/crash/concurrent-builder E2E.
- [ ] Add content-hash embedding reuse.
- [ ] Remove filesystem snapshot state/leases/GC.
- [ ] Rebenchmark cold/warm/change-only.

### Phase 3 — real LSP lifecycle

- [ ] Generic LSP client boundary using maintained protocol library.
- [ ] TS/JS via maintained tsserver/LSP server.
- [ ] Pass existing 9/9 oracle.
- [ ] Delete custom TS LanguageService host.
- [ ] Add another-language server only when a real polyglot benchmark needs it.

### Phase 4 — cache deletion / live worktree

- [ ] Reduce workspace manifest to identity only.
- [ ] Measure and remove structural/candidate file caches if they do not materially improve end-to-end latency.
- [ ] Long-lived dirty-tree E2E: add/delete/rename/edit after MCP startup.
- [ ] Optional maintained watcher only if refresh latency needs it.

### Phase 5 — benchmark before further architecture

- [ ] Run the first natural-use Harbor native-vs-ACE smoke.
- [ ] Freeze multi-repository holdout.
- [ ] Compare quality/tokens/latency for the simplified architecture.
- [ ] Only then decide whether hybrid reranking, extra caches, watcher/Merkle optimization or extra semantic infrastructure is justified.

### Phase 6 — full providers/release

Then continue the still-valid production work:

- Qwen3:14b local Graphiti lifecycle/recovery;
- Vertex synthetic import/citation;
- K3S-10 containment;
- provider selection/approval;
- DBC/release/resource/supply-chain evidence.

These are not prerequisites for proving the de-bespoked code retrieval architecture.

## 15. Pull-request slicing

Do not land this as one giant rewrite.

### PR A — ast-grep structural adapter

Expected net effect: remove custom parser code and Python dependencies, add one maintained structural dependency.

### PR B — Qdrant aliases

Expected net effect: **large negative LOC**. The new alias adapter must be materially smaller than `file-qdrant-snapshot-state.ts` + its lease/GC test portfolio.

### PR C — LSP process provider

Expected net effect: replace TS-specific semantic lifecycle with a generic adapter and external server configuration.

### PR D — delete redundant caches / simplify manifest

Benchmark-driven deletion PR.

Each PR must report **net production LOC added/deleted**. A migration that claims to remove a bike but increases custom coordination code needs explicit justification.

## 16. Deletion gate

A replacement is not done when the new path exists.

It is done only when:

1. new maintained provider path passes the old observable contract;
2. production composition uses it;
3. old production path is deleted;
4. old dependencies are removed;
5. old implementation-specific tests are removed;
6. docs/runtime configuration no longer advertise the old path.

No permanent dual stack “for safety”.

## 17. Immediate backlog classification

| Item | Class | Why |
|---|---|---|
| Restore corrupted review | **NOW** | Repository truth is broken |
| ast-grep outline replacement | **NOW** | Deletes custom language-specific parser path and unlocks polyglot structure |
| Qdrant alias publication | **NOW** | Deletes the largest custom concurrency/lifecycle subsystem |
| generic LSP process provider | **NOW** | Deletes custom TS project lifecycle and enables polyglot semantics |
| first natural Harbor smoke | **NOW / parallel** | Product efficacy must be measured before more architecture |
| explicit source obligations | **NEXT** | Small correctness simplification |
| custom Merkle tree | **DO NOT BUILD** | No measured need |
| custom filesystem watcher framework | **DO NOT BUILD** | Use maintained watcher only if measured need |
| new semantic graph/CPG | **DEFER** | No measured need |
| custom routing LLM | **DEFER** | No measured need |
| Rust rewrite | **DEFER** | No measured need |
| Amplifier | **PLAN B** | Not normal Harbor/Graphiti path |
| Qwen3:14b Graphiti | **PRODUCTION TRACK** | Existing owner decision, independent from code-index cleanup |

## 18. Definition of Done for the cleanup

The code-retrieval path is considered de-bespoked when:

- no ACE-maintained per-language AST node table exists;
- no Python runtime is required merely for structural TS/JS parsing;
- structural support is delegated to ast-grep/Tree-sitter language support;
- semantic project lifecycle is delegated to real language servers;
- Qdrant publication uses provider-native atomic alias switching;
- no filesystem lease database coordinates Qdrant readers/GC;
- embedding reuse is content-addressed at chunk level;
- redundant derived file caches are removed unless benchmark evidence justifies them;
- dirty-tree/current-source black-box contracts still pass;
- natural agent quality/tokens are measured after simplification.

The desired end state is **less ACE code, fewer state machines, fewer failure modes, more languages, and the same or stronger externally observable correctness**.
