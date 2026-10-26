# ACE code retrieval: why a ready-made Qdrant + Tree-sitter stack became difficult to operate

**Date:** 2026-10-26
**Review type:** repository-level, source-backed root-cause analysis (static inspection + retained historical trial artifacts).
**Examined main:** `b0484c7b189e2fd0b505430e8448f7560489e7df`. This is **not** a new provider run. Observations about user-host runtime failures remain hypotheses unless their logs are captured.
**Disposition:** **STOP expanding integration infrastructure until one current, reproducible end-to-end search is green and an actual Hermes pair has been measured.**
**Related:** [Issue #171](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/issues/171), [economics review](2026-10-26-ace-hermes-token-economics-and-benchmark-bloat-review.md).

## Executive answer

The hard part was **not** getting Qdrant to store/search vectors or Tree-sitter to parse a file. Both have already worked in earlier *real-provider* experiments. The project attempted to build **all future invariants around those primitives at once**: versioned source snapshots, crash/concurrency fencing, exact file provenance, hybrid dense/sparse embedding, language-server verification, request-local context projection, multi-source coverage, Cloud/Graphiti lifecycle, Harbor measurements, cross-process workflows and future Bifrost wire proof.

Some of those protections are valuable when accepting a production-ready source-truth service. Their **simultaneous presence is not justified as a prerequisite to the first useful code search**. More importantly, green deterministic tests and historical synthetic E2Es repeatedly substituted for a **current end-to-end agent task with actual provider usage**. This creates a large codebase and continued inability to answer the user's central question: "Does ACE help Hermes on a real task?"

## Evidence: what has worked, and what has not been proven

1. `docs/reviews/2026-10-19-real-provider-e2e.md` and `benchmarks/reports/real-provider-e2e-current-2026-10-20.json` retain real local Qdrant/FastEmbed/**Python Tree-sitter**/TS Language Service retrieval runs, including exact reads, 2,000-line code fixture, outage, race and warm-index reuse. They support **historical real-provider functionality**, not today's pipeline being healthy on the user's host.
2. `benchmarks/reports/real-semantic-retrieval-e2e.json` describes three synthetic semantic queries, `recall@6 = 1` and **top-1 accuracy = 2/3**. Useful exploratory evidence, not an accuracy/quality approval.
3. **Provider implementation switched on 2026-10-20**: commit `cb316ebb` replaced the Python Tree-sitter helper with maintained `@ast-grep/cli`. Current `src/adapters/ast-grep-structural.ts` invokes `ast-grep outline`. The old file `scripts/tree-sitter-structural.py` **no longer exists**. Therefore the earlier archived real-provider results **do not themselves validate this exact current AST implementation**. `docs/reviews/2026-10-19-real-provider-e2e.md` still prints a reproduction command with the removed helper: documentation drift.
4. The saved 10,000-file old-provider scale run (`benchmarks/reports/index-scale-real-provider-current-10000-2026-10-20.json`) measured **938,616 ms cold** (15m39s), **22,310 ms warm**, **31,710 ms after changing one file**. This is historical hardware/runtime data; do not attribute the full delay to one function or transfer it as a current measurement.
5. GitHub CI (`.github/workflows/ace-contracts.yml`) runs TypeScript/Python **deterministic tests**, typecheck, lint, build, and Bifrost Go tests. It **does not start Qdrant, FastEmbed in a real search trial, Docker/Harbor, or Hermes OAuth to check an agent task**. Its Python Tree-sitter installation is left over from an earlier integration and does not prove that `ast-grep outline` works against current provider/Qdrant. Green CI ≠ live functional integration.
6. `benchmarks/reports/ace-retrieval-paired-3x3-final-indexkey.json`: **older Codex**, not Hermes, 9/9 vs 9/9 tasks, native **891,950** vs ACE **1,571,768** tokens (**+76.2%** ACE), $0.0569132 vs $0.08538924 (**+50.0% ACE cost**). The nominally better natural Codex smoke has **0 successful ACE context calls in both arms** (`ace-local-smoke-natural-paired-repeat5.json`). The present Hermes request-time optimization remains unmeasured in saved provider usage.

## Specific root causes and remediation candidates

### R1 — P0: too many capabilities must initialize before simple search

**Code:** `src/bin/ace-mcp.ts` (~52 KB of runtime composition).

The real search is guarded by `ACE_ENABLE_EXPERIMENTAL_QDRANT=true`; otherwise code/unified context are explicitly `not_ready`. With it enabled, startup needs reachable Qdrant, dense embedding process, sparse embedding process, ast-grep executable, source index/snapshot publication and potentially LSP initialization. `ACE_CONTEXT_BRIDGE_MODE` rejects startup if no `context` provider was built. None of this establishes whether a **simple dense top-k retrieval** would work first.

**Concrete complexity defect:** `sparseEmbeddings.probe()` is run and its failure makes the entire code retrieval `not_ready` **even when `ACE_RETRIEVAL_STRATEGY=dense`**, where query-time retrieval correctly skips sparse embeddings. This should be corrected to allow a minimal dense mode. Do not silently weaken the requirements of `hybrid_rrf` mode.

**Action:** narrow first trial to Qdrant + one dense embedder + ast-grep; LSP semantics and sparse fusion are separately selectable/verified. A working search tool is not a production approval.

### R2 — P0/performance: a quadratic in-memory index builder atop a per-file subprocess

**Code:**
- `src/adapters/local-code-index.ts::buildLocalCodeIndex` iterates source files serially and calls `options.structural.extract(...)` for each eligible file, then `indexCandidate(index, candidate)` for each parsed symbol.
- `src/adapters/ast-grep-structural.ts::run` calls `spawn(ast-grep, ['outline', '--stdin', '--lang', ...])` on **every** extraction, causing one CLI process per file.
- `src/domain/retrieval.ts::indexCandidate` calls `index.candidates.some(...)` and `[...index.candidates, candidate]` on **every** candidate.

For **N candidates**, independent repeated scanning and copying is **O(N²)** work and potentially large allocations; per-file process startup is additional overhead. This is visible from the implementation. The 10K-file timing above cannot apportion which fraction came from those effects without profiling, but they are concrete avoidable costs.

**Action:** collect candidates with a mutable local array and `Set<candidateId>` during the build, validate/build immutable `CodeIndex` **once**, keeping the external immutable index contract. For AST extraction, test bounded parallelism/batching or maintained ast-grep API/CLI batch modes **on a measured fixture**; do not guess that an API is faster without profiling.

### R3 — P1: homegrown Qdrant transport/lifecycle exceeds the primitive needed

**Code:** `src/adapters/qdrant-context-provider.ts` (~62 KB) + `src/adapters/http-provider-boundaries.ts` (~24 KB). They implement Qdrant HTTP requests, collection schemas, alias inspection/switching, point counting/scrolling, vector replay/reuse, rank fusion, retry/readiness and source snapshot identities. `package.json` does **not** depend on official `@qdrant/js-client-rest`.

**Nuance:** Qdrant itself does not solve Git snapshot truth, confidentiality or filesystem race semantics. Those boundaries are product requirements, not pure reimplementation. But writing/validating Qdrant endpoint JSON by hand is optional: the official JS/TS client already handles collection, upsert and query APIs. Before replacing the adapter, measure whether the handwritten transport is actually causing errors; replacing a functioning interface just for elegance adds migration risk.

**Action:** define a **minimal** 3-operation Qdrant seam (create-if-missing/upsert/query) using supported official SDK or existing stable adapter, and defer alias/snapshot lifecycle to a later reliability slice. Migrate only after a small conformance trial proves equivalent behavior.

### R4 — P1: "tests passed" tracks unit/contracts, not use by an agent

**Code:** `.github/workflows/ace-contracts.yml`; `package.json` scripts; `src/application/context-transform-service.ts`; Hermes plugin `integrations/hermes/ace_context_engine/engine.py`.

The test matrix checks many contracts but does not exercise the complete path: source code -> current ast-grep -> embeddings -> Qdrant -> ACE verified context -> **real Hermes outbound LLM request** -> accepted task -> token usage. `providerRequestId` in ACE bridge receipts identifies an internal retrieval operation, not a verified outbound Hermes model request. The current `not_beneficial/no_op` behavior also means a valid ACE call may **not inject context or reduce tokens**.

**Action:** one controlled code-location query through actual MCP is the **first** gate; one real Hermes native-vs-ACE pair with accepted task quality and provider usage is the **second**. A receipt without LLM egress proof is not the second gate.

### R5 — P1: architectural scope switched faster than acceptance could close

**Repository:** `src/` 116 files (~1.0 MB), `scripts/` 102 (~704 KB), `test/` 98 (~664 KB), `docs/` 133 (~1.28 MB), plus 184 benchmark files at this snapshot. Besides live code search, code and plans cover Graphiti, Vertex, Harbor multiple generations, Kubernetes lifecycle, source archives and a future Bifrost gateway. Those are different release horizons. Large numbers alone prove no defect; the **sequencing** is defective when actual user-facing integration has no current accepted run.

The tracked docs themselves say some tasks are blocked, provider approvals are pending and historical artifacts cannot be promoted. `README.md`, `AGENTS.md`, OpenSpec and older plans are not necessarily aligned on *which* implementation is actually current. A week of PRs completing isolated contracts can produce many green checkmarks without an approved single vertical slice.

**Action:** freeze feature expansion and declare a narrow integration owner + one observable acceptance gate. Archive or defer optional capabilities in planning, do not drop source-security requirements or erase historic data.

## Smallest recovery plan — not another framework

### Phase A: isolate the primitive (one working call; no Hermes)

- [ ] On the actual execution host, check that `ast-grep --version` and `ast-grep outline --stdin --lang TypeScript --json=stream --items all --view expanded` return symbols for one test file. Verify the **current** CLI's output against the current parser.
- [ ] Check local Qdrant health and single collection create/upsert/query using official SDK or a known-working current adapter. Confirm vectors have the correct dimension and results return the expected path/span.
- [ ] Run `npm run test:real-provider` against a **small** 2–3-file source fixture and retain actual `ace_workspace_status`, `ace_context`, exact source citation and any `NOT_READY` reason. This requires a real Qdrant + embedded model; **do not** replace with a mock and mark PASS.
- [ ] If the current startup cannot complete in explicitly configured **dense** mode without a sparse worker, fix that **single dependency bug** with one targeted regression.
- [ ] If index initialization is slow, fix O(N²) candidate accumulation, then profile the per-file ast-grep process startup before proposing other changes.

**Phase A exit:** one current E2E result demonstrating real parser -> embedding -> Qdrant -> verified code candidate and exact source check, with pinned SHA/provider versions. **No Graphiti, Vertex, Bifrost, Harbor, LSP approval, production Kubernetes or token savings required.**

### Phase B: establish real agent integration (one task, two arms)

- [ ] With Phase A green, run **one** paired native Hermes vs Hermes+ACE task from existing `benchmarks/harbor/ace-retrieval-impact`; identical model/reasoning/task/tool access. Keep real Hermes OAuth in its dedicated auth store.
- [ ] Record provider-measured tokens (cached input separate), attempts, tool turns, task verifier, cost/latency and evidence of **ACE_APPLIED vs NO_OP** on outbound model requests. `UNKNOWN` is acceptable when evidence is missing, savings is not.
- [ ] Fix only the first observed failure; do not create new runner/collector/gate files unless the current code provably cannot do it.

### Phase C: remove redundant infrastructure, *after* Phase B

- [ ] Use Issue #171 for dependency-backed removal/consolidation of old Harbor three-/four-arm code and tests. Keep historical Codex records, accepted ADRs and any required compatibility paths.
- [ ] Prefer an actual negative-line-count cleanup PR. Targeted tests while editing, one full deterministic gate at handoff.

## Bottom line

**Qdrant and ast-grep are not the fundamental blocker.** Their base features are available, and earlier Qdrant + Python Tree-sitter runs did pass. The reason this feels like reinventing the wheel is **premature composition and validation complexity**: mandatory multiple workers for dense-only search, per-file subprocesses, quadratic candidate accumulation, custom Qdrant lifecycle and a CI process that does not prove the real end-to-end scenario. A historically passing pipeline is not proof of the migrated current one.

**Unverified hypothesis:** the owner's actual host may also have environment-specific Qdrant/embedding/OAuth failures. Repository inspection cannot identify those without current stderr, health checks or Harbor raw results. Do not present those as observed causes.
