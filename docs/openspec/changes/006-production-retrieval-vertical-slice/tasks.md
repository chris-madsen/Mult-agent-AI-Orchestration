# Tasks — Production retrieval vertical slice

**State: REAL PROVIDER + FORCED-USE HARBOR DIAGNOSTIC; DBC-12 NOT CLOSED.** The
configured retrieval path has real-provider evidence, but per-request provider correlation,
natural agent choice, amortized warm retrieval, and total local infrastructure costs have not been verified. Semantic-quality, cross-source and owner-approval gates remain
explicitly open; prior port-level `[x]` markers do not satisfy those gates.

## Architecture/approval
- [x] Owner approved ADR-012's six acceptance rules on 2026-10-19. **Separate open approvals remain:** production embedding model/runtime, exact LSP winner, cloud data handling and provider license/version evidence.
- [x] Establish valid Codex/official MCP SDK integration and conformance contract; remove homemade transport from production bootstrap after migration. Official SDK client and Codex Harbor calls are evidenced; cancellation/error contracts pass.
- [x] Pin real Qdrant, semantic embedding, Tree-sitter grammar and selected LSP; no SHA256 vector as semantic provider. Final production approval remains owner-gated.

## Vertical slice
- [x] Wire production `ace_context` through actual configured Qdrant retrieval and source digest verification.
- [x] Materialize AST-exact symbol ranges (not whole file per regex name); LSP same-name refs/types validated with real language service.
- [x] Return relevant ContextBundle with complete/partial based on required route coverage; preserve full exact expansion bytes and source-worktree frame conditions.
- [x] Keep outages, denied policy and stale source distinct; instrument safe provider invocation evidence without logging secrets.
- [x] Ensure documentation/temporal providers are conditional, explicitly unavailable until approved, and never fabricate ready status.

## Bertrand Meyer contracts (real integration or agent E2E)
- [ ] DBC-01 production composition. **Real-provider composition sub-gate passed**, but the normative fixture requires the embedding/LSP stack to be approved; provider approval is still open.
- [x] DBC-02 2000-line/25-line exact AST span and exact expand (`npm run test:real-provider`, commit evidence report).
- [ ] DBC-03 behavior-driven semantic retrieval vs lexical distractor and real embeddings. **Experimental sub-gate passed:** real FastEmbed/Qdrant/AST/LSP surfaced all 3 tiny-fixture targets, but the semantic retriever is not owner-approved and top-1 quality is not sufficient for normative closure.
- [ ] DBC-04 same-name symbols and correct definition/write semantics. **Provider sub-gate passed:** direct TS LS and Serena distinguished the fixture symbols, but ADR-004 comparison is still partial and no semantic provider is owner-approved.
- [x] DBC-05 mid-request edit D1→D2, no false-current (`npm run test:real-provider-race`, commit evidence report).
- [x] DBC-06 source failure completeness / degraded truthful response (`npm run test:real-provider-outage`: unavailable Qdrant yields `complete=false`, `partialSources=["code","qdrant"]`, current local evidence and explicit outage warning).
- [x] DBC-07 policy denial outbound count zero and safe audit (`npx tsx --test test/provider-and-multiprocess-contracts.test.ts`: Vertex adapter and gateway composition make zero HTTP calls; existing audit contract verifies redacted safe decision record).
- [x] DBC-08 byte-identical original and generated 2000+ line content (`npm run test:real-provider` plus the >2000-line Unicode/mixed-newline artifact round-trip contract).
- [x] DBC-09 official MCP SDK conformance with **Codex**, cancellation/error paths. The official TypeScript client covers handshake/list/call/error/concurrency/cancellation, and Harbor proves actual Codex→MCP→ACE calls.
- [x] DBC-10 stable Codex historical episode IDs after append and replay (`npm run test:memory-process`: separate export workers preserve the first episode ID after append; archive import/replay remains idempotent).
- [ ] DBC-11 shared digest archive delete and derived purge correctness.
- [ ] DBC-12 realistic Harbor attribution and quality gate. A 3-task × 3-repeat **forced-use diagnostic** found 9/9 quality per arm and 0.567× raw-token ratio; provider operations were not correlated with individual MCP requests, local compute costs were not measured, and natural agent choice was not tested. Do not count this as normative attribution closure.
- [ ] DBC-13 restart/index persistence. **Implementation sub-gates now include warm reuse, per-file snapshot identity, delta vector reuse, structural/candidate caches, stale-snapshot truth and snapshot/exact-read race rejection.** The normative gate remains open until real changed/delete/rename/untracked + interrupted-writer/restart/performance evidence is retained on the selected provider stack.
- [ ] DBC-14 docs-vs-code conflict disambiguation. **Logic sub-gate passed:** a test DocumentationPort preserves both claims and emits a structured conflict, but the normative scenario still needs real approved Vertex documentation with citations versus current code.

## Performance and exit
- [ ] Run paired **natural-use** Harbor retrieval-demanding tests on a frozen larger repository/workload, count observed/complete/failed ACE calls, attribute provider traces to requests, meter end-to-end local and agent costs, and preserve failures. The existing forced-use 3×3 trial is diagnostic evidence, not the full required test.
- [x] Run OpenSpec CLI strict validation, typecheck, lint, unit, real-provider integration and Codex agent E2E; attach outputs or label unknown.
- [ ] Owner reviews actual provider trace, benchmark and all mandatory contracts before declaring `production-ready`; no `controlled exception` can close a failed mandatory gate.

## Decision vs test-gate clarification — 2026-10-19

The owner **permits exploratory integration and benchmarks immediately**. Unchecked production gates above must remain unchecked until their actual proof, but their incompleteness **does not freeze development**. In particular:

- [x] Owner explicitly approved ADR-012 (six acceptance rules) on 2026-10-19; approval is separate from demonstrating success or 5×.
- [x] Codex evaluates real local embedding model/runtime candidates without requiring Ollama, then recommends a measured production choice (ADR-013 evaluation protocol Accepted; FastEmbed/ONNX wins the current frozen exploratory comparison; final production approval pending).
- [ ] Codex completes the Serena vs direct TypeScript Language Service comparison in Accepted ADR-004 before designating one as approved.
- [ ] Codex runs Vertex IAM/corpus/citation probes via existing host `gcloud` login. The owner-authorized `ace-europe-stage2` corpus exists and must be retained; real citation retrieval remains open. Private-document transmission remains separately permissioned.
- [ ] Codex verifies local-first Graphiti + FalkorDB ingestion/extraction/recall/deletion with no unapproved cloud dialogue transfer. **No owner model-selection wait:** Codex is authorized to choose/install a supported local-only experimental inference backend and proceed.
- [ ] Codex completes **natural-use** Harbor paired retrieval-intensive trials. The forced-use 3×3 diagnostic already ran and is preserved, but does not prove attributable savings. **5× is a measurement hypothesis, not an entry condition**.

## Authoritative next execution plan

Codex must begin with [`CODEX-EXECUTION-PLAN.md`](CODEX-EXECUTION-PLAN.md), then use this task list and the two normative spec deltas as acceptance gates. Owner approval of ADR-012 is complete; **all real-provider / agent / Harbor contract tests remain unchecked until executed and evidenced**.
