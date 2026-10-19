# AGENTS.md — ACE repository-wide implementation contract

This file applies to **every path in this repository**, including `src/`, `test/`, `docs/`, `benchmarks/`, `scripts/` and native code. Nested AGENTS.md files may add narrower instructions, never weaken the rules below. **The repository owner must approve material architecture/provider changes.**

## Mission and architectural truth

ACE is a **Codex-independent Adaptive Context Engine**, not a new multi-agent framework or a general-purpose MCP server collection. The target is **≥5× fewer end-to-end agent tokens per successfully completed task** against a strong unmodified Codex baseline, with non-inferior correctness. **5× is not achieved or claimed.** Quality and token/cost/latency are separate measured dimensions.

The accepted PRD/ADRs define intent; DDD/context maps are proposed design until reviewed. The goal is a **single logical MCP facade** atop **one modular monolith**, initially TypeScript + Effect; native Rust is optional and evidence-gated. A Bounded Context is **not** a deployment unit. Existing local Kubernetes only; no opportunistic microservices, observability stack, custom graph database, parser, embedding model or orchestration framework.

## Read before implementing

1. `docs/docs/references/PRD-v1.0.md`, Accepted ADR-000…ADR-012, and ADR-013 (Accepted for evaluation protocol only; model remains unselected).
2. `docs/docs/architecture/01-strategic-ddd.md` through `07-architecture-fitness-contracts.md`.
3. `docs/openspec/README.md`, the relevant change's `proposal.md`, `design.md`, `specs/` and `tasks.md`.
4. `docs/reviews/2026-10-18-architecture-failure-review.md` for known architectural failures. The review is evidence, not permission to modify unrelated source.

## Non-negotiable build-versus-buy and runtime rules

- **Selected production components:** Qdrant for local code candidate search; **Tree-sitter/ast-grep** for structural facts; approved **Serena or TypeScript Language Service** for LSP semantics; Vertex AI RAG Engine for authorized documents; Graphiti for derived temporal memory backed by exact original session archive; Harbor for evaluation. Their API integration must be real, approved and evidenced before stating a capability is production-ready.
- **Use a maintained, official MCP TypeScript SDK** for the production MCP transport. A hand-written JSON-RPC transport may exist as a quarantined compatibility experiment only; it is not an accepted production protocol implementation without a new ADR and conformance evidence.
- **Never implement a custom replacement for a selected mature engine or protocol** (parser, embeddings, vector DB, LSP, MCP server framework, memory graph, benchmarking orchestrator) merely to move a checklist forward. A temporary fallback/fixture **must** be marked `experimental` or `fallback`, default-off where it would silently displace the selected provider; it must not satisfy a production acceptance criterion.
- A SHA-256-derived vector is **not semantic embedding**. It is allowed only as a clearly labelled deterministic test double, never as a retrieval-quality proof or production embedder.
- Regex symbol detection is not AST resolution. An item with `symbolName` but an entire file as its range/content is **not** a symbol-granular candidate. Structural spans must come from parsed syntax; semantic relationships require an approved language service.
- Preserve original source and generated artifacts byte-for-byte. A 2000+ line file must remain fully retrievable via explicit, authorized expansion. Do not silently truncate or impose a mandatory token cap; **relevance ranking of initial excerpts** is required.
- File/source provenance includes workspace, path, digest/revision, exact range, freshness, evidence mechanism and explicit uncertainty. A stale source may be shown as stale but **never** as verified-current. Avoid workspace-wide snapshots in the hot path unless justified and benchmarked.
- Code stays local by default. Private code to cloud requires project opt-in; policy/auth/secret violations **fail closed** with safe logs; backend outages degrade truthfully. ACE cannot mutate the user's code tree.
- Raw Codex transcripts are authoritative memory source; extracted facts are projections, not automatically accepted human decisions. Session identity must survive append/replay, and deletion cannot destroy shared content still referenced by another episode.
- Jev stays an **opt-in experimental strategy selector**, not required production routing. Do not silently choose open provider questions or Kubernetes host-worktree transport; record spikes/ADR proposals.
- No dashboards, OTel stack or full static-analysis/CPG subsystem in current scope.

## Vertical-slice-first delivery and Meyer contracts

**A domain abstraction, adapter file, mocked unit test or green lint run is not evidence that a user capability works.** Work towards an actual **Codex → official MCP SDK → production composition → Qdrant candidate → AST span → approved LSP → current source verification → relevant ContextBundle / exact expansion** path before broadening the system. Documentation and Graphiti joins are conditional on need/policy, not mandatory on every request.

Every change that affects a user-facing capability MUST identify and test:
- **Preconditions**: authorized workspace, valid input, approved/live dependencies, reproducible fixture.
- **Postconditions**: precise, source-cited expected behavior and actual provider invocations; required response semantics.
- **Invariants**: no false freshness, no invented result, no implicit cloud upload, no source-byte loss, no wrong symbol merges, no duplicate usage counting, no mistaken decision approval.
- **Frame conditions**: what may not change (user worktree, raw archive, `main`, holdout dataset).
- **Exceptional postconditions**: denied vs unavailable vs stale, failure evidence retained without false success.

See `docs/docs/architecture/07-architecture-fitness-contracts.md` and `docs/openspec/changes/006-production-retrieval-vertical-slice/`. Add **runtime composition tests** and **real-provider integration tests**, not only tests of pure domain models. Do not turn unchecked blocker requirements into `[x]` with a "controlled exception"; use `[ ]` and document why.

## Quality and benchmark proof

- Keep `main` untouched until owner reviews a PR. Prefer small commits in feature branches; do not edit unrelated user work.
- Run typecheck, tests, lint, OpenSpec validation and affected provider-integration/conformance tests. Report anything not run or unavailable exactly.
- Test failure/retry, race conditions, path escape, prompt injection and removal of secrets; validate runtime schemas and explicit lifecycle/cleanup. Prefer typed ports and standard components over bespoke wrappers.
- Harbor must compare a strong native Codex with Codex+ACE on paired, pinned **retrieval-demanding tasks**. Record actual ACE MCP invocation count, correct provider invocation/evidence, quality and total tokens plus external costs. A smoke requiring `TODO → DONE` cannot establish retrieval quality; a run with zero ACE calls cannot establish ACE savings. Preserve failed runs and raw evidence, and label exploratory vs frozen holdout.
- Don't hide failures, invent success, silently loosen tests, promote a spike into production, or claim improvements absent measurements. Prefer clear, small, independently reviewable changes.

## Definition of done

A change is `Implemented` only when all its normative scenarios and Meyer contracts pass against the stated runtime composition, or the feature is explicitly labelled **not ready** and its acceptance task stays unchecked. `Production-ready` additionally requires approved dependencies/security, conformance and E2E proof, independently repeated quality-gated benchmarks where performance is claimed, and **owner review**. `docs/openspec/changes/*` remain unarchived while blockers exist.

Never confuse repository/API availability with user authorization to expose private sources. Document unresolved decisions rather than guessing.

## Owner clarification — 2026-10-19 (binding implementation guidance)

- **Ollama is not a selected or required dependency. Do not install or restore it by default.** Qdrant is the selected code-vector store; the embedding model and inference implementation are intentionally separate decisions. Codex may benchmark established local inference candidates, such as Qdrant FastEmbed / ONNX, without a mandatory model-serving wrapper; see proposed ADR-013. SHA-256 pseudo-vectors cannot satisfy semantic retrieval.
- **ADR-004 requires an actual comparison: Serena vs direct TypeScript Language Service.** Codex must run both on matched fixtures, measure correctness, latency, integration complexity, license and agent-level performance, and recommend to the owner. Do not silently select either.
- **Graphiti + FalkorDB: local-first.** Original Codex dialogues and extraction inputs remain local by default; no implicit external model calls. Test actual local projection, temporal recall and deletion, and leave the capability not_ready where dependencies are missing.
- **Vertex: use the owner's already authenticated host gcloud CLI** for development probes: `gcloud config get-value project`, `gcloud auth print-access-token`, or `npm run probe:vertex`. Do not require a new interactive login merely to run a REST test. CLI auth and Application Default Credentials are different; containers need explicit safe credential access. Verify IAM and actual corpus before claiming E2E; never commit tokens or silently upload private documents or create billable resources.
- **Architecture decisions versus testing:** ADR-012 remains Proposed pending explicit owner sign-off of its six acceptance rules. Codex may conduct local provider experiments, integrate candidates on public/synthetic fixtures, and run honest exploratory Harbor tests now. Only **production promotion** and claims of accepted 5× need their respective evidence and approvals. A missing benchmark result is not permission to fabricate one, nor a reason to refuse to start a benchmark.

## Execution entrypoint after owner sign-off (2026-10-19)

The owner **explicitly approved all six rules in ADR-012** and the non-Ollama experimental protocol in ADR-013. No real provider, LSP winner, embedding model, 5× measurement or production readiness is implied. **Codex should follow [`docs/openspec/changes/006-production-retrieval-vertical-slice/CODEX-EXECUTION-PLAN.md`](docs/openspec/changes/006-production-retrieval-vertical-slice/CODEX-EXECUTION-PLAN.md)**. Stage 0–4 experiments are authorized on local/public/synthetic test data, but external private-data upload, new billable Vertex corpora and final production provider selection still need distinct approval.
