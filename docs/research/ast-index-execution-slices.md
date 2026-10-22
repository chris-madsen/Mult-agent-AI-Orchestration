# ast-index adoption: one-pass execution slices

> **For agentic workers:** REQUIRED SUB-SKILL: use Superpowers `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Each task is a separate review gate and normally a separate PR.
>
> **Source spec:** [ast-index-adoption-plan.md](./ast-index-adoption-plan.md)
>
> **Purpose:** turn the research roadmap into slices small enough for one Codex implementation pass. This file does **not** change architecture authority: current owner decisions, Accepted ADRs, OpenSpec and `AGENTS.md` still win.

**Goal:** determine whether a symbol/reference graph materially improves ACE, then add only the smallest graph capabilities that earn their keep.

**Architecture:** preserve current hybrid retrieval and exact-source/LSP verification. Graph data is derived, snapshot-bound evidence used after hybrid seed retrieval; it never becomes source truth.

**Tech stack:** TypeScript/Node.js, Effect, current ast-grep/LSP adapters, Qdrant, Harbor.

## Global constraints

- Before every slice, inspect current `main`, open PRs and applicable ADR/OpenSpec; skip or narrow work already implemented.
- One mechanism per PR. Do not combine graph work with Roo chunking, memory changes, Vertex/Graphiti work or unrelated Harbor changes.
- Default ACE retrieval behavior must remain unchanged until an experiment explicitly promotes a feature.
- Current verified source bytes and required LSP proof outrank graph state.
- Every experiment pins source/task SHA, model/runtime identity and raw evidence.
- Use `npm run test:affected` in the edit loop and `npm run verify:pr` once before handoff when source changes.
- If a prerequisite provider/runtime is missing, return `BLOCKED`; do not replace it with a mock and call the slice complete.

## Review focus

1. Graph identity must not survive a source digest change as if current.
2. Ambiguous references must never become high-confidence/direct edges.
3. Expansion must be bounded for high-degree hubs.
4. Graph-added candidates must retain the same exact-source freshness checks as ordinary retrieval.
5. Benchmark wins must be attributed to one graph mechanism, not bundled changes.

---

### Slice AI-01: External ast-index baseline fixture

**Depends on:** current ACE feedback harness only.

**Files:**
- Create: `scripts/ast-index-baseline.ts`
- Create: `test/ast-index-baseline.contracts.test.ts`
- Create/update evidence only outside versioned raw-trace storage as required by repository policy.

**Interfaces:**
- Consumes: pinned repository/task manifest and an explicitly pinned ast-index executable/config.
- Produces: normalized per-task artifact containing task id, source SHA, ast-index commit/config identity, tool calls, returned paths/symbols, latency and raw-artifact digests.

- [ ] Write a failing contract test that rejects missing source SHA, ast-index identity or raw artifact digest.
- [ ] Implement only the normalizer/runner boundary; do not add graph code to ACE.
- [ ] Run the focused test and one smoke invocation when the external tool exists.
- [ ] Record `BLOCKED` rather than synthetic success when ast-index is unavailable.
- [ ] Commit and open a PR.

**Done when:** one honest native/ACE/ast-index-comparable artifact can be produced or the exact external blocker is retained.

**OUT:** SymbolGraph types, PageRank, Qdrant changes.

---

### Slice AI-02: Graph domain identities and snapshot contract

**Depends on:** AI-01 may be blocked; implementation can proceed only if owner still wants the prototype, but no adoption claim follows.

**Files:**
- Create: `src/domain/symbol-graph.ts`
- Create: `test/symbol-graph.contracts.test.ts`
- Read: `src/domain/retrieval.ts`

**Interfaces:**
- Produces: `SymbolNode`, `SymbolEdge`, `SymbolGraphSnapshot`, edge-confidence/status types, stable validators and IDs.
- Node identity binds repository/workspace identity, path, source digest, exact range, kind and symbol name.
- Snapshot identity binds source snapshot digest, builder version and provider identities.

- [ ] Write failing tests for stable IDs, malformed ranges, cross-snapshot edges and stale snapshot classification.
- [ ] Implement pure domain constructors/validators only.
- [ ] Verify no runtime/retrieval composition changes.
- [ ] Run focused tests, then commit.

**Done when:** graph facts cannot exist without explicit source/snapshot provenance.

**OUT:** graph storage, traversal, AST/LSP resolution.

---

### Slice AI-03: In-memory graph store and bounded traversal

**Depends on:** AI-02.

**Files:**
- Create: `src/application/symbol-graph.ts`
- Create: `src/adapters/in-memory-symbol-graph.ts`
- Create: `test/symbol-graph-traversal.contracts.test.ts`

**Interfaces:**
- Consumes: validated nodes/edges/snapshot.
- Produces: one-hop neighbor lookup with edge-type quotas, global node budget, deterministic ordering and explicit dropped-count metadata.

- [ ] Write RED tests for depth=1, degree caps, ambiguous-edge exclusion and deterministic ordering.
- [ ] Implement the smallest in-memory store/traversal.
- [ ] Verify stale snapshots are rejected before traversal.
- [ ] Run focused tests and commit.

**Done when:** a graph can be queried safely without persistence or retrieval integration.

**OUT:** PPR, PageRank, SQL, MCP tools.

---

### Slice AI-04: Structural relation extraction without semantic promotion

**Depends on:** AI-02.

**Files:**
- Modify: `src/adapters/ast-grep-structural.ts`
- Create: `src/application/symbol-graph-builder.ts`
- Test: extend `test/ast-grep-structural.contracts.test.ts`
- Test: create `test/symbol-graph-builder.contracts.test.ts`

**Interfaces:**
- Consumes: current structural symbols and exact source bytes.
- Produces: unresolved/structural relation candidates with evidence path/range; no `lsp_confirmed` edge.

- [ ] Add fixtures for calls/imports/contains plus same-name ambiguity.
- [ ] Extract only relations the existing structural provider can evidence.
- [ ] Keep unresolved/ambiguous states explicit.
- [ ] Run affected tests and commit.

**Done when:** AST-derived candidates are source-linked but never mislabeled semantic truth.

---

### Slice AI-05: LSP edge resolver

**Depends on:** AI-04 and current `src/adapters/lsp-semantic.ts`.

**Files:**
- Create: `src/application/symbol-edge-resolver.ts`
- Modify only if necessary: `src/adapters/lsp-semantic.ts`
- Create: `test/symbol-edge-resolver.contracts.test.ts`
- Extend real LSP fixture only where it proves unique wiring.

**Interfaces:**
- Consumes: unresolved edge candidates + semantic anchors + current source snapshot.
- Produces: `lsp_confirmed | import_resolved | qualified_scope | unique_name | ambiguous | unresolved`.

- [ ] RED-test duplicate names, wrong scope, imports/reexports and provider-unavailable behavior.
- [ ] Resolve with LSP first; degrade explicitly, never silently.
- [ ] Verify a changed source digest invalidates prior resolution.
- [ ] Run contract tests and the smallest real TS-LSP integration test, then commit.

**Done when:** false-resolution tests stay negative and confirmed edges point to exact target nodes.

---

### Slice AI-06: Snapshot freshness gate

**Depends on:** AI-02 and AI-05.

**Files:**
- Extend: `src/domain/symbol-graph.ts`
- Create or modify: `src/application/symbol-graph-freshness.ts`
- Test: `test/symbol-graph-freshness.contracts.test.ts`

**Interfaces:** `assessGraphSnapshot(currentManifest, graphSnapshot) -> current | partial | stale | unavailable`.

- [ ] Write tests for branch/source changes, resolver identity changes and partial builds.
- [ ] Implement fail-closed freshness classification.
- [ ] Verify stale graph cannot be used as current evidence.
- [ ] Commit.

**Done when:** graph lifecycle cannot weaken ACE source freshness.

---

### Slice AI-07: Opt-in one-hop retrieval expansion

**Depends on:** AI-03, AI-05, AI-06.

**Files:**
- Modify: `src/domain/retrieval.ts` only if a new experimental strategy/trace field is required.
- Modify: `src/adapters/qdrant-context-provider.ts`
- Create: `test/qdrant-graph-expansion.contracts.test.ts`

**Interfaces:**
- Adds an **experimental, default-off** one-hop expansion stage after hybrid RRF seeds.
- Every added candidate records seed id, edge type/confidence and drop/budget reason.

- [ ] RED-test default behavior unchanged.
- [ ] RED-test node/edge quotas and ambiguous-edge exclusion.
- [ ] Implement one-hop expansion only; no PPR.
- [ ] Ensure final exact reread/LSP/source coverage still runs.
- [ ] Run affected tests and commit.

**Done when:** `hybrid_rrf` is byte-for-byte behaviorally unchanged by default and the opt-in path is bounded/auditable.

---

### Slice AI-08: Graph retrieval trace and diagnostic report

**Depends on:** AI-07.

**Files:**
- Modify: `src/adapters/retrieval-benchmark-trace.ts`
- Modify: `scripts/retrieval-quality-report.ts` or create a narrow graph report script if separation is cleaner.
- Test: extend `test/retrieval-benchmark-trace.contracts.test.ts`

**Produces:** seeds, considered neighbors, accepted/dropped edges, confidence, stale reasons, final delivered candidate IDs and bytes.

- [ ] Add failing serialization/round-trip tests.
- [ ] Implement trace fields without dumping source bodies.
- [ ] Produce one human-readable failure explanation from a fixture.
- [ ] Commit.

**Done when:** one failed graph query can be diagnosed without reading raw provider logs.

---

### Slice AI-09: Frozen hybrid-vs-one-hop ablation

**Depends on:** AI-07 and AI-08.

**Files:**
- Modify only benchmark scripts under `scripts/` and retained benchmark artifacts under `benchmarks/` as repository policy allows.
- No production ranking changes.

- [ ] Freeze/pin the task manifest before running.
- [ ] Run hybrid-only and hybrid+one-hop on identical source/model/runtime.
- [ ] Report Recall/MRR, graph-rescued gold, distractors, bytes and latency.
- [ ] Decide `ADOPT_NEXT`, `NO_GAIN` or `INCONCLUSIVE`.

**Done when:** the graph has a measured contribution or a documented rejection. Negative result is success for this slice.

---

### Slice AI-10: Impact/dependency domain query API

**Gate:** only if AI-09 shows useful graph edges.

**Files:**
- Extend: `src/application/symbol-graph.ts`
- Create: `test/symbol-impact.contracts.test.ts`

**Produces:** bounded `dependents`, `dependencies`, `impact`, `paths` application calls. No MCP exposure yet.

- [ ] RED-test cycles, max depth, max paths and high-degree caps.
- [ ] Implement pure bounded queries.
- [ ] Commit.

**Done when:** blast-radius queries are deterministic and safe independently of transport.

---

### Slice AI-11: Graph MCP/context surface

**Gate:** AI-10 plus owner choice of surface after inspecting current OpenSpec.

**Files:**
- Modify: applicable OpenSpec change first.
- Modify: `src/transport/mcp-sdk-stdio.ts` and gateway/application wiring only after the contract exists.
- Add transport contract tests.

- [ ] Specify either `ace_context(intent="impact")` or a narrowly justified graph tool; do not add both.
- [ ] Test schema, cancellation, partial/stale status and compact output.
- [ ] Implement transport mapping.
- [ ] Commit and PR.

**Done when:** a real MCP client can request impact data without bypassing source freshness.

---

### Slice AI-12: PPR/RWR ablation

**Gate:** AI-09 says one-hop improves recall but ordering remains a measured problem.

**Files:**
- Create: `src/domain/graph-rank.ts`
- Create: `test/graph-rank.contracts.test.ts`
- Wire behind an experimental option only after pure tests.

- [ ] RED-test restart distribution, confidence weights and deterministic normalization.
- [ ] Implement PPR/RWR pure function.
- [ ] Run frozen one-hop vs PPR ablation.
- [ ] Keep only if measurable gain exceeds added cost.

**OUT:** default promotion.

---

### Slice AI-13: Related-test relation

**Gate:** retrieval traces show repeated “find tests” loops.

**Files:**
- Create: `src/application/test-relation.ts`
- Create: `test/test-relation.contracts.test.ts`

- [ ] Model separate confidence for path convention, imports, LSP/reference and build metadata.
- [ ] Never label path naming alone as direct proof.
- [ ] Add relation to graph only behind existing experimental graph flag.
- [ ] Measure reduction in extra search/read calls.

---

### Slice AI-14: Branch-delta signal

**Gate:** review/regression tasks show missing changed-file context.

**Files:**
- Extend working-context domain/adapters rather than graph truth.
- Tests: extend `test/working-context.contracts.test.ts`.

- [ ] Capture merge-base/base/head and changed paths.
- [ ] Apply as boost only, never hard filter.
- [ ] Paired eval on review/regression tasks.

---

### Slice AI-15: Persistent/incremental graph prototype

**Gate:** graph is useful and rebuild cost is measured as material.

**Files:**
- New adapter selected by evidence; do **not** choose SQLite merely because ast-index does.
- Keep domain/application ports from AI-02/03.
- Add crash/concurrency/rebuild tests.

- [ ] Benchmark full rebuild first.
- [ ] Add persistence with snapshot identity.
- [ ] Add incremental reuse keyed by content digest/snapshot.
- [ ] Prove crash/restart and concurrent publication safety.
- [ ] Retain only if performance gain is material.

---

### Slice AI-16: Git-history ranking experiment

**Gate:** change-planning traces show ambiguity among equally relevant implementations.

**Files:** new history collector/rank feature + isolated tests; no correctness proof changes.

- [ ] Collect commit/churn/age signals locally with pinned revision.
- [ ] Produce percentile features.
- [ ] Run ablation on change-planning tasks.
- [ ] Reject if history displaces semantically relevant code.

---

### Slice AI-17: One-ecosystem module graph

**Gate:** actual cross-package failures remain after symbol graph.

**Files:** one ecosystem adapter only (for example npm workspaces), plus tests.

- [ ] Model module nodes/edges and provenance.
- [ ] Resolve only one ecosystem from real benchmark demand.
- [ ] Measure cross-package rescue before adding another ecosystem.

---

## Dependency DAG

```text
AI-01 external baseline

AI-02 domain ──┬─> AI-03 traversal ─────┐
               └─> AI-04 AST ─> AI-05 LSP ─> AI-06 freshness
                                         │       │
                                         └───────┴─> AI-07 one-hop
                                                        │
                                                   AI-08 diagnostics
                                                        │
                                                   AI-09 ablation
                                                        │
                 ┌──────────────────────────────────────┼───────────────┐
                 v                                      v               v
              AI-10 impact                          AI-12 PPR        AI-13/14 signals
                 │
              AI-11 MCP

AI-15 persistence, AI-16 history, AI-17 module graph are evidence-gated after AI-09.
```

## Self-review

- **Spec coverage:** A0/A1/A2/A4/A5/A11/A12 plus conditional PPR, tests, branch signal, persistence, history and module graph are represented. Multi-root/external stubs/debug UI stay intentionally deferred until a concrete failure justifies them.
- **One-pass size:** no slice mixes domain model, provider resolution, runtime wiring and benchmark adoption.
- **Causality:** Roo hierarchical chunking must not be introduced in the same PR as AI-07/09.
- **Handoff rule:** execute exactly one READY slice per Codex run/PR unless two adjacent steps are purely documentation/evidence and share no production code.
