# ACE hybrid context: targeted static code review

**Date:** 2026-10-21
**Reviewed revision:** `2aa9804c4ce1287318f7b8dbc6dc9623ded16405` (`main`)
**Scope:** MCP context-delivery/receipt behavior, delivery metrics, benchmark trace durability, selected runtime wiring, corresponding contract tests, and architecture/documentation consistency.
**Evidence level:** source inspection and existing test inspection only; no test execution, external provider, real MCP process, or Harbor benchmark was run in this review.

## Product/architecture boundary

ACE is an **agent-neutral, Cursor-inspired, multi-layer hybrid context/RAG engine exposed over MCP** for agentic software development; **not** a multi-agent task scheduler. Its local code pipeline combines structural units (ast-grep), dense embeddings, sparse/BM25 retrieval and Qdrant RRF, optional evidence-gated reranking, real LSP enrichment, verified current worktree reads, progressive delivery, and exact expansion. **Vertex AI RAG is a separately authorized cloud source for project documentation**; Graphiti/FalkorDB and an immutable archive serve temporal memory. Source classes must not be silently interchanged. Codex is the first MCP client, not a core dependency.

This is the target established by [ADR-014](../docs/references/ADR-014-hybrid-context-engine.md) and implemented in part by the current runtime. The target of 5× fewer agent tokens **per accepted task** remains an unproven hypothesis until quality-gated paired evaluation.

## Findings (ordered)

### ACE-CR-01 — P1 — stable evidence cannot be reused across a changed bundle

**Observed:** `suppressKnownEvidence` returns all bodies unchanged unless `receiptMatchesBundle` is true. The caller sets that flag only if `knownBundleId === bundleId`. Therefore `known_evidence_ids` alone does nothing, and when one evidence item changes, an otherwise unchanged evidence item is re-sent. [`src/domain/context-delivery.ts:199-215`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/src/domain/context-delivery.ts#L199-L215); [`src/domain/context-delivery.ts:250-259`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/src/domain/context-delivery.ts#L250-L259).

**Contract impact:** ADR-014 permits `known_bundle_id` **and/or** `known_evidence_ids` and calls for unchanged evidence bodies to be represented as compact references even when fresh evidence is delivered. Whole-bundle equality makes delta delivery effectively identical-bundle reuse only, so ordinary incremental changes defeat the central token-saving goal.

**Existing test gap:** [the portability tests](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/test/context-receipt-portability.contracts.test.ts#L93-L139) cover identical bundles, one changed item, and stale receipts, but not a **mixed bundle with one unchanged and one changed item**, or a valid evidence-only receipt.

**Proposed fix:** define a strict, versioned per-evidence receipt invariant (source class, workspace, exact range/digest, delivery projection, provenance/freshness). Permit body omission only for individually identical and revalidated evidence; do not allow a stale or caller-forged receipt to suppress new content. Preserve `ace_expand` and explicit supersession semantics. Add mixed-change and cross-client/process MCP contract tests. Because the current whole-bundle guard may be intentional defense in depth, introduce tests and review the receipt trust model *before* changing it.

**Acceptance:** if one of N evidence items changes, only that item is retransmitted; changed/stale/unknown identities never hide bytes; distinct MCP clients produce identical answers, and exact expansion remains lossless.

### ACE-CR-02 — P1 — delivery duplicate-byte metric conflates distinct code spans

**Observed:** `deliveryMetricsFor` keys `uniqueContent` on `item.sourceDigest ?? item.content` and takes **the maximum** byte length for a digest. Multiple distinct snippets from one source file share its file digest, so they are counted as a single unique snippet; `duplicateContentBytes = newContextBytes - uniqueContentBytes` can report false duplication. [`src/domain/context-delivery.ts:18-45`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/src/domain/context-delivery.ts#L18-L45).

**Minimal counterexample:** two different 100-byte verified function spans in one unchanged file have the same `sourceDigest`. The current formula reports `newContextBytes=200`, `uniqueContentBytes=100`, `duplicateContentBytes=100` even if the bodies do not overlap. That is a **measurement error**, not 100 saved bytes.

**Existing test gap:** the main [progressive delivery fixture](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/test/progressive-context-delivery.contracts.test.ts#L16-L43) assigns a digest derived from each body; it does not represent two different spans from the *same file*. Current tests merely assert nonnegative duplicate bytes.

**Proposed fix:** measure deduplicated delivery at exact evidence/span identity (or byte-identical body identity where appropriate), not whole-file digest. Define distinct fields for bytes removed by in-bundle exact dedupe, bytes omitted by known receipts, bytes hidden by locate projection, and bytes still delivered. Do not present any of these as **agent-token savings** without actual agent usage counters.

**Acceptance:** distinct same-file spans yield zero false duplicate bytes; truly identical repeated spans count once; repeat receipts, locate mode, and `ace_expand` are reported separately and exactly.

### ACE-CR-03 — P2 — benchmark trace writes can silently fail or remain pending

**Observed:** in the real MCP bootstrap, `benchmarkTrace.record()` appends asynchronously through a promise chain whose rejection is converted into success with `.catch(() => undefined)`; the `record` contract returns `void`, with no flush/close acknowledgement in this path. [`src/bin/ace-mcp.ts:253-267`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/src/bin/ace-mcp.ts#L253-L267); [`src/domain/retrieval-benchmark.ts:20-26`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/src/domain/retrieval-benchmark.ts#L20-L26).

**Impact:** a permission/disk/write error can lose stage-rank records without surfacing failure at the recording boundary; normal process exit can race queued writes. That undermines reproducibility/attribution in H6 experiments even if release gates ultimately reject missing evidence. **No actual lost event was observed** in this review.

**Proposed fix:** use a bounded, explicit trace-sink lifecycle with `flush/close` and terminal error state (or synchronous, measured writes for critical runs). Make benchmark tasks verify expected stage/request counts and fail if trace persistence failed. Capture fatal write failures without leaking query/source bodies in diagnostics.

**Acceptance:** deterministic unwritable-path and shutdown-before-drain tests; no benchmark evidence reported complete when expected stages are missing.

### ACE-CR-04 — P2 — repository onboarding/status documents drifted from runtime

**Observed:** root README still describes an early `Tree-sitter structural` real-provider path and advertises `ACE_TREE_SITTER_HELPER` / `ACE_TREE_SITTER_PYTHON` bootstrap variables, while current bootstrap wires maintained `ast-grep`, sparse embeddings and generic LSP. [`src/bin/ace-mcp.ts:242-250`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/src/bin/ace-mcp.ts#L242-L250); [`src/bin/ace-mcp.ts:469-489`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/src/bin/ace-mcp.ts#L469-L489). The 2026-10-21 hybrid completion plan labels [PR #116](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/pull/116) “in progress” even though it has been merged; follow-up PRs through [#122](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/pull/122) are also merged.

**Fix in this documentation PR:** clarify actual MCP architecture and config, update the plan's status header and link this review. Do not rewrite historical evidence or claim production readiness.

## Reviewed safeguards (not findings)

- A single official MCP SDK tool surface exports `ace_context`, `ace_expand`, `ace_workspace_status`, and `ace_memory_search`: [`src/transport/mcp-sdk-stdio.ts:37-111`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/src/transport/mcp-sdk-stdio.ts#L37-L111).
- Verified code evidence re-reads current files, checks source digest and exact structural bytes, and performs a final read to mark races rather than declaring stale content current: [`src/adapters/qdrant-context-provider.ts:1040-1085`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/src/adapters/qdrant-context-provider.ts#L1040-L1085) and [`src/adapters/qdrant-context-provider.ts:1299-1324`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/src/adapters/qdrant-context-provider.ts#L1299-L1324).
- `known_bundle_id` and `known_evidence_ids` are validated at the MCP gateway boundary: [`src/gateway/mcp-gateway.ts:131-144`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2aa9804c4ce1287318f7b8dbc6dc9623ded16405/src/gateway/mcp-gateway.ts#L131-L144).
- Current implementation is **not** equivalent to production release approval; explicit real-provider, MCP E2E, Harbor quality/cost, Graphiti/Vertex, k3s and signed owner gates remain.

## Next action

Follow the prioritized, scoped queue in [the existing hybrid-context completion plan](../plans/2026-10-21-cursor-like-hybrid-context-completion-plan.md). For a bug-fix PR, first add a deterministic RED case to the existing owning test file, then make the smallest fix and run `npm run test:affected` during iteration and `npm run verify:pr` before handoff, with real-provider/Harbor evidence when the changed capability requires it. Do not mark an unrun integration as passed.
