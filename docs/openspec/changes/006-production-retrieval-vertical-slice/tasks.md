# Tasks — Production retrieval vertical slice

**State: NOT IMPLEMENTED. All checkboxes intentionally unchecked.** Prior port-level `[x]` markers do not satisfy these end-to-end acceptance criteria.

## Architecture/approval
- [x] Owner approved ADR-012's six acceptance rules on 2026-10-19. **Separate open approvals remain:** production embedding model/runtime, exact LSP winner, cloud data handling and provider license/version evidence.
- [ ] Establish valid Codex/official MCP SDK integration and conformance contract; remove homemade transport from production bootstrap after migration.
- [ ] Pin real Qdrant, semantic embedding, Tree-sitter grammar and selected LSP; no SHA256 vector as semantic provider.

## Vertical slice
- [ ] Wire production `ace_context` through actual configured Qdrant retrieval and source digest verification.
- [ ] Materialize AST-exact symbol ranges (not whole file per regex name); LSP same-name refs/types validated with real language service.
- [ ] Return relevant ContextBundle with complete/partial based on required route coverage; preserve full exact expansion bytes and source-worktree frame conditions.
- [ ] Keep outages, denied policy and stale source distinct; instrument safe provider invocation evidence without logging secrets.
- [ ] Ensure documentation/temporal providers are conditional, explicitly unavailable until approved, and never fabricate ready status.

## Bertrand Meyer contracts (real integration or agent E2E)
- [ ] DBC-01 production composition, no fallback-only passing.
- [ ] DBC-02 2000-line/25-line exact AST span and exact expand.
- [ ] DBC-03 behavior-driven semantic retrieval vs lexical distractor and real embeddings.
- [ ] DBC-04 same-name symbols and correct definition/write semantics.
- [ ] DBC-05 mid-request edit D1→D2, no false-current.
- [ ] DBC-06 source failure completeness / degraded truthful response.
- [ ] DBC-07 policy denial outbound count zero and safe audit.
- [ ] DBC-08 byte-identical original and generated 2000+ line content.
- [ ] DBC-09 official MCP SDK conformance with Codex, cancellation/error paths.
- [ ] DBC-10 stable Codex historical episode IDs after append and replay.
- [ ] DBC-11 shared digest archive delete and derived purge correctness.
- [ ] DBC-12 realistic Harbor attribution and quality gate.
- [ ] DBC-13 restart with stale index and dirty worktree.
- [ ] DBC-14 docs-vs-code conflict disambiguation.

## Performance and exit
- [ ] Run paired Harbor retrieval-demanding tests (at least more than one fixture task), count ACE calls and external provider costs, include failed trials; never claim 5× from trivial/zero-call smoke.
- [ ] Run OpenSpec CLI strict validation, typecheck, lint, unit, real-provider integration and Codex agent E2E; attach outputs or label unknown.
- [ ] Owner reviews actual provider trace, benchmark and all mandatory contracts before declaring `production-ready`; no `controlled exception` can close a failed mandatory gate.

## Decision vs test-gate clarification — 2026-10-19

The owner **permits exploratory integration and benchmarks immediately**. Unchecked production gates above must remain unchecked until their actual proof, but their incompleteness **does not freeze development**. In particular:

- [x] Owner explicitly approved ADR-012 (six acceptance rules) on 2026-10-19; approval is separate from demonstrating success or 5×.
- [ ] Codex evaluates real local embedding model/runtime candidates without requiring Ollama, then recommends a measured production choice (ADR-013 evaluation protocol Accepted; final model pending).
- [ ] Codex completes the Serena vs direct TypeScript Language Service comparison in Accepted ADR-004 before designating one as approved.
- [ ] Codex runs Vertex IAM/corpus/citation probes via existing host `gcloud` login. Corpus write/import and private-document cloud transmission require separate explicit authorization.
- [ ] Codex verifies local-first Graphiti + FalkorDB ingestion/extraction/recall/deletion with no unapproved cloud dialogue transfer.
- [ ] Codex actually executes Harbor paired retrieval-intensive trials, preserving failures, costs, ACE call counts and quality. **5× is a measurement hypothesis, not an entry condition**.

## Authoritative next execution plan

Codex must begin with [`CODEX-EXECUTION-PLAN.md`](CODEX-EXECUTION-PLAN.md), then use this task list and the two normative spec deltas as acceptance gates. Owner approval of ADR-012 is complete; **all real-provider / agent / Harbor contract tests remain unchecked until executed and evidenced**.
