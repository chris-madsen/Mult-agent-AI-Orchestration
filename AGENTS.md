# AGENTS.md — Permanent ACE engineering rules

These instructions apply to **all work in this repository** (`src/`, `test/`, `scripts/`, `docs/`, `benchmarks/`, and native code). Nested AGENTS.md files may add path-specific rules, but must not weaken these invariants.

**This is a durable rules document, not a sprint plan, task queue, progress report, or a substitute for OpenSpec.** Do not add a current milestone, one-time execution instructions, dated status updates, checklists to complete this week, or links directing the agent to execute one particular change. Put those in the relevant OpenSpec `proposal.md` / `design.md` / `tasks.md` or a separate execution plan.

## 1. Mission and source of authority

- ACE is an **agent-neutral Adaptive Context Engine**, exposed through one logical MCP facade. Codex is the first client, not the only supported client.
- Optimize accurate **end-to-end context delivery and task success**. The target of **at least 5× fewer agent tokens per accepted task** is a hypothesis to measure against a strong unmodified baseline, **never an assumed achievement**. Protect correctness, confidentiality, total cost and latency.
- Respect the accepted PRD and ADRs as architecture decisions. The relevant OpenSpec capability specs and Meyer contracts define observable acceptance. Implementation notes, spikes, review reports and execution plans contain evidence or work instructions; they do **not** override accepted ADRs.
- If decisions conflict, the current explicit owner decision and accepted ADR take precedence; record a proposed ADR for any material unresolved or changed choice. **Never silently settle an open production provider choice.** Experimental implementation is allowed when scoped, labeled and safe; production promotion needs evidence and owner approval.

## 2. Architecture and build-versus-buy

- Maintain **one TypeScript + Effect modular monolith** and DDD bounded contexts, with supporting external infrastructure rather than a microservice per context. Use Rust only when benchmarks justify it.
- Prefer proven maintained engines, libraries and official protocols to custom replacements. Any proposal to build a parser, embedding algorithm, vector database, memory graph, MCP transport, benchmark orchestrator or other mature infrastructure must have an owner-approved ADR with a measurable reason.
- Use the official maintained **MCP TypeScript SDK** for the production transport. Keep experimental compatibility transports outside the production composition unless a separately approved ADR and conformance suite justify them.
- Keep adapters and provider DTOs outside the domain; use typed ports, explicit runtime composition and provider-specific conformance tests.
- Honor the **selected roles**, without conflating them: Qdrant for local code retrieval candidates; Tree-sitter/ast-grep for structural facts; an **evidence-selected** language-service provider for semantic facts; Vertex AI RAG for authorized documentation; immutable original session archive plus local-first Graphiti/FalkorDB for temporal memory; Harbor for agent-level evaluation.
- No particular local embedding **model or model-serving wrapper** is mandated. **Do not add Ollama as a required/default ACE dependency.** Use genuine, measured embeddings from maintained candidate implementations; do not portray SHA-256/hash-derived test vectors as semantic retrieval. Keep embedding provider/model, inference runtime and vector store separate decisions.
- Where accepted ADRs prescribe a comparison between candidate providers, compare them on matched, reproducible fixtures before recommending a final production choice. A provider already implemented is not automatically the winner. Do not turn an open comparison into an arbitrary selection.
- Jev remains an optional experimental strategy selector until explicitly approved. Avoid speculative dashboards, full observability stacks, full call-graph/CPG platforms and new services outside agreed scope.

## 3. Source truth, retrieval and context completeness

- **Current verified source bytes outrank index payload and derived documentation.** For each code citation retain workspace, path, digest/revision, exact range, evidence mechanism, freshness and uncertainty.
- Structural symbols require **real parsed spans**; a regex-identified name mapped to the whole file is not a symbol-precise result. Semantic references/definitions require validated language-service evidence; identical names and write accesses are not sufficient proof of definition identity.
- Return **relevant, concise initial context**, not a whole file per match. At the same time preserve lossless authorized expansion of complete originals, including very large source and generated artifacts. Never silently truncate or impose a fixed mandatory output-token ceiling.
- Revalidate selected source against the working tree; if it changes during the request, re-read and verify, or label the result stale/changed. Never mark obsolete evidence current.
- Determine `complete` from **coverage of all required sources in the authorized retrieval plan**, source verification and honest dependency statuses. Missing or failed required providers mean a partial/not-ready result, even if the surviving snippets are fresh.
- Failure paths must distinguish `unavailable`, `stale`, `not_ready`, `policy_denied` and `not_required`. Optional providers are queried only when relevant and permitted. Test doubles and degraded fallback must be explicitly identified and cannot satisfy real-provider acceptance gates.
- Keep filesystem hot paths efficient: prioritize indexed candidates and targeted verification; benchmark any unavoidable workspace-wide scan or reindexing.

## 4. Security, privacy and lifecycle

- **Source code and raw dialogues stay local by default.** Cloud transfer requires documented workspace/data-class opt-in and a destination-specific authorization check **at transmission time**. Authenticated cloud credentials by themselves do not authorize an upload, resource creation or billable operation.
- Vertex documentation may use the available supported Google credentials (including an already authenticated host `gcloud` CLI where applicable); never assume credentials, IAM, a RAG corpus or ADC exist everywhere. Do not print, commit or retain access tokens in logs or fixtures. Use minimally scoped, short-lived credentials where possible.
- Graphiti + FalkorDB are **local-first**. Confirm not only database locality but also LLM extraction, embeddings and reranking egress. Unapproved cloud inference on private session data is forbidden.
- Original Codex sessions remain authoritative, byte-exact and source-citable; Graphiti extracts **derived claims**, not automatically owner-approved engineering decisions. Preserve history, status, contradictions and source pointers.
- Import/replay, background projections, queue acknowledgements, tombstones, cleanup and deletion must be idempotent and recovery-safe. No deletion may destroy shared original blobs still referenced by another episode. Cross-process and crash consistency must be tested under the actual storage semantics.
- ACE is read-only with respect to the user's worktree. Policy denial and secret leakage fail closed, with safe diagnostics. Technical outages may degrade **truthfully**, never by silently switching to a forbidden destination.

## 5. Bertrand Meyer design-by-contract and quality gates

For changes affecting a user-visible capability, define **observable**:
- **Preconditions (`require`)**: schema-valid, authorized input, registered workspace, required capability and fixtures.
- **Postconditions (`ensure`)**: correct cited response and actual required provider invocations, verified source/freshness, authorized expansion or an explicit typed failure.
- **Invariants**: no invented evidence, false freshness, fake semantics, unauthorized egress, corrupt archival state or unapproved decision promotion.
- **Frame conditions**: user worktree, original bytes, protected branches and immutable benchmark holdouts remain unchanged by the capability.
- **Exceptional postconditions**: distinguish provider outage, policy denial, stale/raced inputs, cancellation and retries without false success.

Use `docs/docs/architecture/07-architecture-fitness-contracts.md` and applicable OpenSpec capability specs for contract IDs and scenarios. **A domain port, adapter file, pure mock test, green compiler or passing protocol smoke is not proof of agent-facing production behavior.** Verify the runtime entrypoint calls real configured providers through the actual MCP client.

Keep evidence stages separate: `contract-designed` → `adapter-implemented` → `real-provider-tested` → `agent-E2E-tested` → `benchmark-evaluated` → `owner-approved`. Unpassed mandatory checks remain unchecked; a controlled exception explains a blocker but never closes a production gate.

## 6. Benchmarks and reporting

- Use Harbor for **paired, pinned, retrieval-demanding real agent tasks** against a strong native Codex baseline. Verify actual ACE MCP call counts and attributed provider usage; zero ACE calls cannot establish ACE-caused benefit.
- Compare accepted task quality first, then total input/output/cached tokens without double counting, external embedding/LLM/indexing costs, latency, source integrity and failures. Preserve raw trials and independent holdouts; do not tune on frozen holdouts.
- A measured result below 5× (or a regression) must be reported honestly; **the performance target is not a prerequisite to running experiments or benchmarks**. Do not assert savings from a forced trivial task.
- Do not fabricate test runs, relax assertions to hide defects, suppress failed provider attempts, or mark a production criterion passed from mock-only evidence.

## 7. Repository change discipline

- Work in reviewable branches and PRs; do not push directly to `main` unless the owner explicitly authorizes that operation. Preserve unrelated edits.
- For affected capabilities run typecheck, lint, unit/contract tests, OpenSpec validation, real-provider integration, SDK conformance and agent E2E **as applicable**. Report precisely what was run, skipped, unavailable and why.
- Keep normative requirements and acceptance tasks in **OpenSpec**, durable architecture choices in **ADRs**, past observations in `docs/reviews/`, benchmark evidence in `benchmarks/`, and temporary stage-by-stage instructions in a separate **execution plan**. Do **not** paste an execution plan into AGENTS.md or make one sprint's plan a permanent agent instruction.
- Promote production capability only after applicable real evidence, security/permission checks, reproducible evaluation and explicit owner review. If a provider needs credentials or external services unavailable to the current runner, record a specific blocker rather than inventing success.
