# AGENTS.md — Permanent ACE engineering rules

These instructions apply to **all work in this repository** (`src/`, `test/`, `scripts/`, `docs/`, `benchmarks/`, and native code). Nested AGENTS.md files may add path-specific rules, but must not weaken these invariants.

**This is a durable rules document, not a sprint plan, task queue, progress report, or a substitute for OpenSpec.** Do not add a current milestone, one-time execution instructions, dated status updates, checklists to complete this week, or links directing the agent to execute one particular change. Put those in the relevant OpenSpec `proposal.md` / `design.md` / `tasks.md` or a separate execution plan.

## 1. Mission and source of authority

- ACE is an **agent-neutral Adaptive Context Engine**, exposed through one logical MCP facade. Codex is the first client, not the only supported client.
- Optimize accurate **end-to-end context delivery and task success**. The target of **at least 5× fewer agent tokens per accepted task** is a hypothesis to measure against a strong unmodified baseline, **never an assumed achievement**. Protect correctness, confidentiality, total cost and latency.
- Respect the accepted PRD and ADRs as architecture decisions. The relevant OpenSpec capability specs and Meyer contracts define observable acceptance. Implementation notes, spikes, review reports and execution plans contain evidence or work instructions; they do **not** override accepted ADRs.
- Resolve conflicting guidance in this order: **current explicit owner decision → Accepted ADR → applicable OpenSpec capability/acceptance contract → repository/nested AGENTS.md → current implementation and tests as evidence of what exists → execution plans/reviews/spikes as historical or temporary guidance**. If an unresolved material architecture choice remains, propose an ADR rather than deciding silently.
- **Never infer current implementation status solely from an old plan, unchecked task, review, handoff or progress note.** Inspect the current code, runtime composition and retained evidence before deciding that something is missing or complete.
- **Never silently settle an open production provider choice.** Experimental implementation is allowed when scoped, labeled and safe; production promotion needs evidence and owner approval.

## 2. Technology baseline

- **TypeScript / Node.js** is the primary implementation language and runtime. Keep core domain, application and runtime-composition logic in the existing TypeScript architecture unless a measured need and an approved architecture decision justify otherwise.
- **Effect** is the primary application/runtime composition framework. Preserve typed effects, explicit dependencies and typed failure semantics rather than introducing ad-hoc hidden global state.
- Use the official maintained **MCP TypeScript SDK** for production MCP client/server transport and protocol integration.
- **Python is allowed at explicit tooling/provider boundaries** where mature libraries are materially better suited, including embedding/model workers, Tree-sitter-related helpers, experiments and benchmark tooling. Do not move core ACE domain/application logic into Python without an architectural reason.
- Treat every Python/native subprocess as a real provider boundary: use a typed/versioned protocol, effective runtime/model identity, bounded timeouts, cancellation, safe stderr/logging and explicit failure semantics.
- **Shell scripts** are for reproducible bootstrap, orchestration and evidence collection, not core business logic.
- **Docker + Kubernetes/k3s** are the deployment/infrastructure layer. Do not create a new service merely to mirror a DDD bounded context.
- **Qdrant** supplies local vector retrieval; **Tree-sitter/ast-grep** supplies structural facts; semantic code intelligence comes from an **evidence-selected language-service provider**. The current evaluated semantic candidates include direct TypeScript Language Service and Serena; neither wins by implementation inertia.
- **Vertex AI RAG** is the selected provider role for authorized project documentation under the data-policy constraints.
- **Graphiti + FalkorDB** provide local-first derived temporal/project memory; immutable archived originals remain authoritative.
- **Harbor** is the agent-level evaluation/benchmark orchestration layer.
- **Rust/native code is not a default implementation language.** Introduce it only when profiling/benchmarks show a material need and the architecture change is approved.
- Do not introduce another implementation language or runtime when the task can be solved cleanly inside the existing TypeScript architecture.
- Keep exact dependency and runtime versions in manifests, lockfiles, images and retained evidence rather than freezing fast-changing version numbers in this file.

## 3. Architecture and build-versus-buy

- Maintain **one TypeScript + Effect modular monolith** and DDD bounded contexts, with supporting external infrastructure rather than a microservice per context. Use Rust only when benchmarks justify it.
- Prefer proven maintained engines, libraries and official protocols to custom replacements. Any proposal to build a parser, embedding algorithm, vector database, memory graph, MCP transport, benchmark orchestrator or other mature infrastructure must have an owner-approved ADR with a measurable reason.
- Use the official maintained **MCP TypeScript SDK** for the production transport. Keep experimental compatibility transports outside the production composition unless a separately approved ADR and conformance suite justify them.
- Keep adapters and provider DTOs outside the domain; use typed ports, explicit runtime composition and provider-specific conformance tests.
- Honor the **selected roles**, without conflating them: Qdrant for local code retrieval candidates; Tree-sitter/ast-grep for structural facts; an **evidence-selected** language-service provider for semantic facts; Vertex AI RAG for authorized documentation; immutable original session archive plus local-first Graphiti/FalkorDB for temporal memory; Harbor for agent-level evaluation.
- No particular local embedding **model or model-serving wrapper** is mandated. **Do not add Ollama as a required/default ACE dependency.** Use genuine, measured embeddings from maintained candidate implementations; do not portray SHA-256/hash-derived test vectors as semantic retrieval. Keep embedding provider/model, inference runtime and vector store separate decisions.
- Where accepted ADRs prescribe a comparison between candidate providers, compare them on matched, reproducible fixtures before recommending a final production choice. A provider already implemented is not automatically the winner. Do not turn an open comparison into an arbitrary selection.
- Jev remains an optional experimental strategy selector until explicitly approved. Avoid speculative dashboards, full observability stacks, full call-graph/CPG platforms and new services outside agreed scope.

## 4. Source truth, retrieval and context completeness

- **Current verified source bytes outrank index payload and derived documentation.** For each code citation retain workspace, path, digest/revision, exact range, evidence mechanism, freshness and uncertainty.
- Structural symbols require **real parsed spans**; a regex-identified name mapped to the whole file is not a symbol-precise result. Semantic references/definitions require validated language-service evidence; identical names and write accesses are not sufficient proof of definition identity.
- Return **relevant, concise initial context**, not a whole file per match. At the same time preserve lossless authorized expansion of complete originals, including very large source and generated artifacts. Never silently truncate or impose a fixed mandatory output-token ceiling.
- Revalidate selected source against the working tree; if it changes during the request, re-read and verify, or label the result stale/changed. Never mark obsolete evidence current.
- Determine `complete` from **coverage of all required sources in the authorized retrieval plan**, source verification and honest dependency statuses. Missing or failed required providers mean a partial/not-ready result, even if the surviving snippets are fresh.
- Failure paths must distinguish `unavailable`, `stale`, `not_ready`, `policy_denied`, `not_required` and a **successful empty result**. Optional providers are queried only when relevant and permitted. Test doubles and degraded fallback must be explicitly identified and cannot satisfy real-provider acceptance gates.
- **An error, timeout, malformed provider response, parse failure or unverified acknowledgement is never evidence of absence or successful deletion.** Fail closed or return an explicit partial/unavailable result; do not convert failure into an empty successful result.
- Keep filesystem hot paths efficient: prioritize indexed candidates and targeted verification; benchmark any unavoidable workspace-wide scan or reindexing.

## 5. Security, privacy and lifecycle

- **Source code and raw dialogues stay local by default.** Cloud transfer requires documented workspace/data-class opt-in and a destination-specific authorization check **at transmission time**. Authenticated cloud credentials by themselves do not authorize an upload, resource creation or billable operation.
- Vertex documentation may use the available supported Google credentials (including an already authenticated host `gcloud` CLI where applicable); never assume credentials, IAM, a RAG corpus or ADC exist everywhere. Do not print, commit or retain access tokens in logs or fixtures. Use minimally scoped, short-lived credentials where possible.
- Graphiti + FalkorDB are **local-first**. Confirm not only database locality but also LLM extraction, embeddings and reranking egress. Unapproved cloud inference on private session data is forbidden.
- Original Codex sessions remain authoritative, byte-exact and source-citable; Graphiti extracts **derived claims**, not automatically owner-approved engineering decisions. Preserve history, status, contradictions and source pointers.
- Import/replay, background projections, queue acknowledgements, tombstones, cleanup and deletion must be idempotent and recovery-safe. No deletion may destroy shared original blobs still referenced by another episode. Cross-process and crash consistency must be tested under the actual storage semantics.
- Publication, leases, cache reuse, reconciliation and deletion must be correct under **concurrent processes and crash/restart**, not only under single-process happy paths. Prefer explicit epochs/fencing/CAS or equivalent invariants over timing assumptions.
- ACE is read-only with respect to the user's worktree. Policy denial and secret leakage fail closed, with safe diagnostics. Technical outages may degrade **truthfully**, never by silently switching to a forbidden destination.

## 6. Bertrand Meyer design-by-contract and quality gates

For changes affecting a user-visible capability, define **observable**:
- **Preconditions (`require`)**: schema-valid, authorized input, registered workspace, required capability and fixtures.
- **Postconditions (`ensure`)**: correct cited response and actual required provider invocations, verified source/freshness, authorized expansion or an explicit typed failure.
- **Invariants**: no invented evidence, false freshness, fake semantics, unauthorized egress, corrupt archival state or unapproved decision promotion.
- **Frame conditions**: user worktree, original bytes, protected branches and immutable benchmark holdouts remain unchanged by the capability.
- **Exceptional postconditions**: distinguish provider outage, policy denial, stale/raced inputs, cancellation and retries without false success.

Use `docs/docs/architecture/07-architecture-fitness-contracts.md` and applicable OpenSpec capability specs for contract IDs and scenarios. **A domain port, adapter file, pure mock test, green compiler or passing protocol smoke is not proof of agent-facing production behavior.** Verify the runtime entrypoint calls real configured providers through the actual MCP client.

Keep evidence stages separate: `contract-designed` → `adapter-implemented` → `real-provider-tested` → `agent-E2E-tested` → `benchmark-evaluated` → `owner-approved`. **Never collapse these states into one `done` flag.** Unpassed mandatory checks remain unchecked; a controlled exception explains a blocker but never closes a production gate.

Evidence used to close a gate must identify, as applicable, the **source commit, fixture/input digest, provider/runtime identity, exact command/procedure, request/correlation IDs, retained artifacts, observed result and limitations**. Evidence from one commit/configuration must not silently be relabeled as evidence for another.

## 7. Benchmarks and reporting

- Use Harbor for **paired, pinned, retrieval-demanding real agent tasks** against a strong native Codex baseline. Verify actual ACE MCP call counts and attributed provider usage; zero ACE calls cannot establish ACE-caused benefit.
- Compare accepted task quality first, then total input/output/cached tokens without double counting, external embedding/LLM/indexing costs, latency, source integrity and failures. Cost components must be reported as **measured, estimated or unknown**; unknown is never zero and must not be called complete telemetry. Preserve raw trials and independent holdouts; do not tune on frozen holdouts.
- A measured result below 5× (or a regression) must be reported honestly; **the performance target is not a prerequisite to running experiments or benchmarks**. Do not assert savings from a forced trivial task.
- Do not fabricate test runs, relax assertions to hide defects, suppress failed provider attempts, or mark a production criterion passed from mock-only evidence.

## 8. Engineering workflow and change discipline

Before changing code:

1. inspect the **current implementation and runtime composition**;
2. inspect the applicable Accepted ADRs and OpenSpec contracts;
3. verify whether the requested behavior already exists;
4. identify the observable invariant / acceptance criterion;
5. for a defect, obtain a deterministic RED fixture or clearly mark the finding `static-unconfirmed` before changing production code when reproduction is practical.

Do not implement a requirement merely because an old execution plan says it is missing. Prefer the **smallest coherent change that restores the invariant** over speculative refactoring.

For concurrency, crash, recovery and provider-boundary defects, prefer deterministic barriers/failpoints and explicit state assertions over sleep-based timing tests. Test both the pure parser/contract behavior and the actual provider/runtime path when the provider is available.

### Test execution and test-portfolio policy

- Treat tests as a **maintained portfolio, not an append-only log**. A bug does not automatically justify a new test file or the same assertion at unit, contract and E2E layers.
- Before adding a regression test, search for the existing cheapest test that owns the invariant. Prefer adding a focused table/case there. Keep a higher-level test only when it proves unique wiring, provider, process, crash or agent behavior that the lower layer cannot prove.
- It is valid and desirable for a change to **merge or delete redundant tests** when equivalent protection remains. Test count is not a quality metric.
- During the edit/fix inner loop use `npm run test:affected` (or an even narrower explicit test command). **Do not run the full suite after every edit.**
- Run `npm run verify:pr` once when the change is ready for handoff/PR, and let CI repeat that deterministic full verification. Expensive real-provider, scale, k3s and Harbor suites run only when their capability changed, their acceptance evidence is being refreshed, or a release gate requires them.
- The affected-test selector is intentionally conservative: broad build/test configuration changes fall back to the full deterministic suite; source changes use the reverse import graph; script changes use direct test references. A selector miss is a bug in the selector, not a reason to return permanently to full-suite inner loops.
- In clean CI environments install locked dependencies **once** with `npm ci --ignore-scripts`. Do not rerun `npm ci` between test stages or after ordinary source edits in an already-installed workspace.
- Build/typecheck work must not be duplicated accidentally. Typecheck is a separate gate from `npm test`; TypeScript incremental state may be reused locally. When several expensive E2E commands exercise the same unchanged source, compile once or rely on the incremental build rather than intentionally forcing repeated clean rebuilds.

- Work in reviewable branches and PRs; do not push directly to `main` unless the owner explicitly authorizes that operation. Preserve unrelated edits.
- **Every completed repository change MUST be delivered through a pull request targeting `main`**, including documentation, tests, benchmarks, configuration, infrastructure and evidence-only changes. A local commit or a pushed feature branch without a PR is not completed work; the completion report MUST include the PR number or URL.
- Before starting unrelated work, inspect the remote branches and existing PRs. If a usable completed change is already stranded on a branch without a PR, create its PR to `main` before moving on. Do not leave completed work stranded or silently assume that another branch contains it.
- If PR creation is blocked by authentication, network, repository policy or another external dependency, report the work as `blocked`/`not_done` rather than claiming completion.
- For affected capabilities run typecheck, lint, unit/contract tests, OpenSpec validation, real-provider integration, SDK conformance and agent E2E **as applicable**. Report precisely what was run, skipped, unavailable and why.
- Promote production capability only after applicable real evidence, security/permission checks, reproducible evaluation and explicit owner review. If a provider needs credentials or external services unavailable to the current runner, record a specific blocker rather than inventing success.

## 9. Documentation placement and status discipline

- Put **durable architecture decisions** in ADRs.
- Put **normative capability requirements and acceptance tasks** in OpenSpec.
- Put **temporary sequencing/current implementation work** in execution plans.
- Put **completed observations, audits and review findings** in `docs/reviews/`.
- Put **benchmark fixtures/results/evidence** in `benchmarks/`.
- Put **operational procedures and readiness/configuration guidance** in `docs/operations/`.
- Do not turn a dated bug finding, provider status, current PR number, completion percentage or sprint checklist into a permanent AGENTS rule.
- Historical documents must remain honest historical records. Prefer a new current status/evidence document over rewriting a negative or superseded result into success.

## 10. Completion reporting

When finishing a change, report separately:

- **what changed**;
- **which invariant/contract it fixes or implements**;
- **what was tested**;
- **what real-provider / agent-E2E / benchmark evidence was obtained**;
- **what was not run and why**;
- **what remains blocked or uncertain**;
- **whether any production, benchmark or owner-approval claim actually changed**.

Never describe a capability as production-ready merely because its implementation exists. A missing external environment may justify `NOT_RUN` / `BLOCKED`; it never justifies a fabricated PASS.
