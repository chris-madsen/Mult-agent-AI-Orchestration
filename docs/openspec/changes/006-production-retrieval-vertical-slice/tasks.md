# Tasks — Production retrieval vertical slice

**State: PARTIAL.** Real exploratory Qdrant/embedding/AST/LSP E2E is implemented;
the remaining production, agent, memory and Harbor gates stay unchecked until
their evidence exists. Prior port-level `[x]` markers do not satisfy those gates.

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
- [x] DBC-02 2000-line/25-line exact AST span and exact expand (`npm run test:real-provider`, commit evidence report).
- [ ] DBC-03 behavior-driven semantic retrieval vs lexical distractor and real embeddings. **Experimental sub-gate passed:** real FastEmbed/Qdrant/AST/LSP surfaced all 3 tiny-fixture targets, but the semantic retriever is not owner-approved and top-1 quality is not sufficient for normative closure.
- [ ] DBC-04 same-name symbols and correct definition/write semantics. **Provider sub-gate passed:** direct TS LS and Serena distinguished the fixture symbols, but ADR-004 comparison is still partial and no semantic provider is owner-approved.
- [x] DBC-05 mid-request edit D1→D2, no false-current (`npm run test:real-provider-race`, commit evidence report).
- [x] DBC-06 source failure completeness / degraded truthful response (`npm run test:real-provider-outage`: unavailable Qdrant yields `complete=false`, `partialSources=["code","qdrant"]`, current local evidence and explicit outage warning).
- [x] DBC-07 policy denial outbound count zero and safe audit (`npx tsx --test test/provider-and-multiprocess-contracts.test.ts`: Vertex adapter and gateway composition make zero HTTP calls; existing audit contract verifies redacted safe decision record).
- [x] DBC-08 byte-identical original and generated 2000+ line content (`npm run test:real-provider` plus the >2000-line Unicode/mixed-newline artifact round-trip contract).
- [ ] DBC-09 official MCP SDK conformance with **Codex**, cancellation/error paths. **SDK sub-gate passed:** the official TypeScript MCP client covers handshake/list/call/error/concurrency and now interrupts the underlying Effect on cancellation; actual Codex invocation remains required.
- [x] DBC-10 stable Codex historical episode IDs after append and replay (`npm run test:memory-process`: separate export workers preserve the first episode ID after append; archive import/replay remains idempotent).
- [ ] DBC-11 shared digest archive delete and derived purge correctness.
- [ ] DBC-12 realistic Harbor attribution and quality gate.
- [x] DBC-13 restart with stale index and dirty worktree (`npm run test:real-provider-restart`, generation 1→2 and D1→D2 digest evidence).
- [ ] DBC-14 docs-vs-code conflict disambiguation. **Logic sub-gate passed:** a test DocumentationPort preserves both claims and emits a structured conflict, but the normative scenario still needs real approved Vertex documentation with citations versus current code.

## Performance and exit
- [ ] Run paired Harbor retrieval-demanding tests (at least more than one fixture task), count ACE calls and external provider costs, include failed trials; never claim 5× from trivial/zero-call smoke.
- [ ] Run OpenSpec CLI strict validation, typecheck, lint, unit, real-provider integration and Codex agent E2E; attach outputs or label unknown.
- [ ] Owner reviews actual provider trace, benchmark and all mandatory contracts before declaring `production-ready`; no `controlled exception` can close a failed mandatory gate.

## Decision vs test-gate clarification — 2026-10-19

The owner **permits exploratory integration and benchmarks immediately**. Unchecked production gates above must remain unchecked until their actual proof, but their incompleteness **does not freeze development**. In particular:

- [x] Owner explicitly approved ADR-012 (six acceptance rules) on 2026-10-19; approval is separate from demonstrating success or 5×.
- [ ] Codex evaluates real local embedding model/runtime candidates without requiring Ollama, then recommends a measured production choice (ADR-013 evaluation protocol Accepted; final model pending).
- [ ] Codex completes the Serena vs direct TypeScript Language Service comparison in Accepted ADR-004 before designating one as approved.
- [ ] Codex runs Vertex IAM/corpus/citation probes via existing host `gcloud` login. The owner-authorized `ace-europe-stage2` corpus exists and must be retained; real citation retrieval remains open. Private-document transmission remains separately permissioned.
- [ ] Codex verifies local-first Graphiti + FalkorDB ingestion/extraction/recall/deletion with no unapproved cloud dialogue transfer. **No owner model-selection wait:** Codex is authorized to choose/install a supported local-only experimental inference backend and proceed.
- [ ] Codex actually executes Harbor paired retrieval-intensive trials, preserving failures, costs, ACE call counts and quality. **5× is a measurement hypothesis, not an entry condition**.

## Authoritative next execution plan

Codex must begin with [`CODEX-EXECUTION-PLAN.md`](CODEX-EXECUTION-PLAN.md), then use this task list and the two normative spec deltas as acceptance gates. Owner approval of ADR-012 is complete; **all real-provider / agent / Harbor contract tests remain unchecked until executed and evidenced**.
