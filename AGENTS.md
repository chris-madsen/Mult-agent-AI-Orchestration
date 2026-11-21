# AGENTS.md — Permanent ACE engineering rules

These instructions apply to **all work in this repository** (`src/`, `test/`, `scripts/`, `docs/`, `benchmarks/`, and native code). Nested AGENTS.md files may add path-specific rules, but must not weaken these invariants.

**This is a durable rules document, not a sprint plan, task queue, progress report, or a substitute for OpenSpec.** Do not add a current milestone, one-time execution instructions, dated status updates, checklists to complete this week, or links directing the agent to execute one particular change. Put those in the relevant OpenSpec `proposal.md` / `design.md` / `tasks.md` or a separate execution plan.

## Repository language policy

- **Write all new or edited repository-maintained prose in English**, including Markdown, ADR/OpenSpec, SDLC instructions, code comments, user-facing messages, GitHub issue/PR titles and bodies, and review discussion. The language of the owner's chat request does not change the language required in GitHub.
- Translate meaning and technical nuance manually; do not use machine transliteration or mechanically rename established identifiers, Git object references, API fields, command names or external quotations.
- Preserve immutable benchmark evidence, third-party vendored content, and exact Unicode/i18n test fixtures when altering them would invalidate their provenance or tests. Explain such exceptions in the relevant review rather than concealing them.
- During language-only changes, keep decisions, acceptance statuses, IDs, links, code blocks and historical context intact. Do not silently turn a historical proposal into a current implementation instruction.

## 1. Mission and source of authority

- ACE is an **agent-neutral Adaptive Context Engine**, independent of external LangGraph multi-agent orchestration. For configurable-endpoint agents, **Bifröst is the sole approved ACE context delivery architecture**. The Go connector and local Gateway Projection API exist. The owner authorizes controlled real Hermes Native Responses provider trials through Bifröst for G11 C03–C05 (decision recorded 2026-11-19), subject to verified per-send admission, exact destination/data policy and explicit `store:false`. This permission is not a blanket production route certification and does not grant alternate generation protocols or a direct-provider bypass. **Bifröst is the sole agent-facing ACE integration; model-invoked context tools are prohibited by owner decision (2026-11-14).** The legacy native bridge is not a second supported agent-facing route. Codex remains a comparison client.
- Optimize accurate **end-to-end context delivery and task success**. The target of **at least 5× fewer agent tokens per accepted task** is a hypothesis to measure against a strong unmodified baseline, **never an assumed achievement**. Protect correctness, confidentiality, total cost and latency.
- Respect the accepted PRD and ADRs as architecture decisions. The relevant OpenSpec capability specs and Meyer contracts define observable acceptance. Implementation notes, spikes, review reports and execution plans contain evidence or work instructions; they do **not** override accepted ADRs.
- Resolve conflicting guidance in this order: **current explicit owner decision → Accepted ADR → applicable OpenSpec capability/acceptance contract → repository/nested AGENTS.md → current implementation and tests as evidence of what exists → execution plans/reviews/spikes as historical or temporary guidance**. If an unresolved material architecture choice remains, propose an ADR rather than deciding silently.
- **Owner's explicit Responses-only boundary:** ACE agent-facing generation MUST be provider-native Responses through Bifröst, preserving Hermes' multi-turn tool/reasoning/stream agent loop. OpenAI Chat Completions, Chat-only translation, Chat fallback and a second direct-provider path are **not supported ACE routes**, regardless of historical Gateway v1 schemas or earlier G11 planning. Existing immutable v1 files are migration evidence, not permission to use that route. Do not relabel a Chat payload as Responses. Ordinary model generation remains disabled until the exact native Responses route, privacy-safe final-send boundary and supported agent loop are certified. A separate disposable, source-redacted, explicitly owner-authorized C03–C05 live probe MAY run under an implemented and tested per-physical-send guard plus transmission-time provider/model/data policy while readiness still reports `not_certified`; never treat a probe permit as production readiness or a fallback. This directive supersedes earlier Chat-first plans; future G11 design/phase evidence must be reconciled, not used as accepted authority.
- **Never infer current implementation status solely from an old plan, unchecked task, review, handoff or progress note.** Inspect the current code, runtime composition and retained evidence before deciding that something is missing or complete.
- **Owner-authentication correction (2026-11-21):** Hermes uses its configured ChatGPT/Codex **subscription OAuth only**. ACE MUST NOT implement a second OAuth validator, gate each physical send on the Bifröst credential-source-provenance signal, or substitute API-key billing. The model provider validates the subscription bearer. Still require an exact configured provider/model/destination, approved source data classes, preserved `store:false`, valid source/receipt/attempt, and no silent fallbacks. The pinned Bifröst includes ChatGPT subscription passthrough; validate the **ACE hook on that exact route** and the real final-wire request before E2E claims.
- **Single-Gateway integration (owner decision 2026-11-21):** Bifröst handles Hermes-facing HTTP, subscription bearer forwarding, routing, retry, streaming and responses. ACE's local TypeSpec v3 HTTP operations are an **internal context computation + exact-source policy boundary**, NOT a second LLM proxy or a new OAuth service. Extend Bifröst through the maintained post-auth HTTP plugin and per-physical-send hook on `/chatgpt_passthrough/backend-api/codex/responses`; never send a second provider request from ACE or translate the subscribed request to an API-key endpoint.
- **Never silently settle an open production provider choice.** Experimental implementation is allowed when scoped, labeled and safe; production promotion needs evidence and owner approval.

## 2. Technology baseline

- **TypeScript / Node.js** is the primary implementation language and runtime. Keep core domain, application and runtime-composition logic in the existing TypeScript architecture unless a measured need and an approved architecture decision justify otherwise.
- **Effect** is the primary application/runtime composition framework. Preserve typed effects, explicit dependencies and typed failure semantics rather than introducing ad-hoc hidden global state.
- **TypeSpec is the selected source language for new and migrated public/versioned ACE wire contracts** (ADR-019; Gateway Projection API; only approved Gateway HTTP messages). Use pinned emitters/codegen and explicit adapter validation, not duplicate hand-written protocol types. Keep OpenSpec as behavioral requirements and ADRs as architectural rationale; do not treat planned codegen as already installed.
- **Functional DDD is the default modeling style** (ADR-019): start T2 domain design with Event Storming, use immutable ADTs/read-only data and cohesive pure domain functions for invariants/transitions, and Effect for application orchestration, I/O and resource/cancellation ownership. An aggregate is a consistency boundary, not a mandatory OO class or service. See `docs/research/sdlc/ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md` for the target architecture and staged adoption.
- **Never introduce an optional model-invoked ACE tool server or client.** Gateway projection is automatic for accepted model requests; preserve the internal retrieval engine and source correctness.
- **Internal provider transport is not model tool calling.** ACE may use Codebase Memory's long-lived stdio Model Context Protocol as an application-owned, explicitly allowlisted RPC interface. ACE, not Hermes or the model, chooses and invokes every provider operation. Never expose CBM tool descriptions, tool calls or provider transport to the agent or Bifröst generation request. No model-visible fallback if the provider fails; return NOT_READY until source/index freshness is re-established. Gateway-only means a single agent-facing delivery route, not a ban on internal upstream RPC.
- **Python is allowed at explicit tooling/provider boundaries** where mature libraries are materially better suited, including embedding/model workers, Tree-sitter-related helpers, experiments and benchmark tooling. Do not move core ACE domain/application logic into Python without an architectural reason.
- Treat every Python/native subprocess as a real provider boundary: use a typed/versioned protocol, effective runtime/model identity, bounded timeouts, cancellation, safe stderr/logging and explicit failure semantics.
- **Shell scripts** are for reproducible bootstrap, orchestration and evidence collection, not core business logic.
- **Docker + Kubernetes/k3s** are the deployment/infrastructure layer. Do not create a new service merely to mirror a DDD bounded context.
- **Codebase Memory v0.12.1** is the current sole native structural/graph engine for code (Tree-sitter AST, dependency graph, built-in semantic/BM25 discovery). **Qdrant** remains a separately deployed *current runtime* dense/sparse code-search provider, with overlapping discovery responsibilities; its retention versus CBM-only requires independent comparable benchmarks and an owner architecture decision. A separate maintained **LSP** currently verifies exact symbols/definitions and its non-overlapping value must be evidenced. **ast-grep is used for SDLC architecture linting, not ACE runtime parsing.**
- **Vertex AI RAG** is the selected provider role for authorized project documentation under the data-policy constraints.
- **Graphiti + FalkorDB** provide local-first derived temporal/project memory; immutable archived originals remain authoritative.
- **Harbor** is the agent-level evaluation/benchmark orchestration layer.
- **Rust/native code is not a default implementation language.** Introduce it only when profiling/benchmarks show a material need and the architecture change is approved.
- Do not introduce another implementation language or runtime when the task can be solved cleanly inside the existing TypeScript architecture.
- Keep exact dependency and runtime versions in manifests, lockfiles, images and retained evidence rather than freezing fast-changing version numbers in this file.

## 3. Architecture and build-versus-buy

- Maintain **one TypeScript + Effect modular monolith** and DDD bounded contexts, with supporting external infrastructure rather than a microservice per context. Use Rust only when benchmarks justify it.
- Prefer proven maintained engines, libraries and official protocols to custom replacements. Any proposal to build a parser, embedding algorithm, vector database, memory graph, model-invoked tool transport, benchmark orchestrator or other mature infrastructure must have an owner-approved ADR with a measurable reason.
- **Named-upstream-first is a pre-code gate, not a style preference.** If an approved plan names a particular implementation (for example pinned Aider RepoMap or a licensed Claw LSP module), inspect its real functions/tests and licensing before editing ACE. In the PR describe pinned commit/file/functions, whether the code is directly adopted, wrapped, or faithfully translated, exactly which implementation details are retained, the upstream behavioral oracle, and which superseded ACE functions were deleted. An implementation written from a prose description of the upstream algorithm does **not** count as reuse.
- **No shadow implementation without explicit owner decision.** Before writing custom graph ranking, process management, protocol framing, model tokenization, cache or scheduling logic, prove why both the named original implementation and already installed provider-native/standard components fail a stated ACE invariant. A language mismatch alone is not permission to re-invent behavior: assess a small, traceable port of licensed working functions with their tests and attribution. Do not add a new Python/Rust runtime just to avoid a small licensed port without comparing operational cost.
- **Respect source provenance.** Apache/MIT permission must be checked for the exact upstream files/commit copied or adapted; preserve notices and attribution. A leaked or reconstructed proprietary Claude/Anthropic source dump is not automatically licensed merely because it is hosted on GitHub. Use independently licensed Claw modules where rights are clear; otherwise use architectural guidance and public APIs without copying protected implementation.
- **Enforce replacement as a negative diff.** A new wrapper that leaves the former algorithm, parser, transport, graph builder, or lifecycle reachable is not architectural cleanup. The PR must list removed symbols/tests and explain any temporary compatibility with a concrete deletion point. Reviewers should reject unsupported claims of upstream parity based solely on ACE-written tests.
- Before adding custom caching, incremental-index, lifecycle, publication, locking, lease, garbage-collection or language-project machinery, inspect and use provider-native primitives first (for example atomic vector-store publication, maintained structural extractors, real language-server lifecycle and source-control/worktree state). Custom coordination is allowed only when a concrete observable ACE invariant cannot be met by those primitives and that gap is evidenced.
- Use the **Bifröst LLM Gateway** and ACE context engine Projection HTTP API as the sole agent-facing transport. No fallback to model-selected context tools or raw native agent bridge.
- Keep adapters and provider DTOs outside the domain; use typed ports, explicit runtime composition and provider-specific conformance tests.
- Honor actual source roles: CBM for code AST/graph plus native semantic/BM25 discovery; currently Qdrant for additional code dense/sparse retrieval (pending A/B necessity decision); maintained LSP for independent exact-symbol confirmation where required; Vertex AI RAG for authorized documentation; immutable originals plus Graphiti/FalkorDB for temporal memory; Harbor and upstream external benchmarks for agent-level evaluation. Do not invent a Qdrant role in documentation or project memory to preserve an unnecessary dependency.
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

Use `docs/docs/architecture/07-architecture-fitness-contracts.md` and applicable OpenSpec capability specs for contract IDs and scenarios. **A domain port, adapter file, pure mock test, green compiler or passing protocol smoke is not proof of agent-facing production behavior.** Verify each selected integration end to end: Bifröst ingress, ACE context projection and verified **final provider egress** for model-bound delivery. Tool-call success is not proof of automatic context injection.

Keep evidence stages separate: `contract-designed` → `adapter-implemented` → `real-provider-tested` → `agent-E2E-tested` → `benchmark-evaluated` → `owner-approved`. **Never collapse these states into one `done` flag.** Unpassed mandatory checks remain unchecked; a controlled exception explains a blocker but never closes a production gate.

Evidence used to close a gate must identify, as applicable, the **source commit, fixture/input digest, provider/runtime identity, exact command/procedure, request/correlation IDs, retained artifacts, observed result and limitations**. Evidence from one commit/configuration must not silently be relabeled as evidence for another.

## 7. Benchmarks and reporting

- Use Harbor for **paired, pinned, retrieval-demanding real agent tasks** against a strong native Hermes baseline for the current feedback loop, with the same underlying model/provider/reasoning identity across arms. Codex may remain a matched comparison harness. Verify actual model-bound ACE projection calls, receipts, provider egress and usage for the selected route; optional model-tool counts are not accepted as context delivery evidence.
- Compare accepted task quality first, then total input/output/cached tokens without double counting, external embedding/LLM/indexing costs, latency, source integrity and failures. Cost components must be reported as **measured, estimated or unknown**; unknown is never zero and must not be called complete telemetry. Preserve raw trials and independent holdouts; do not tune on frozen holdouts.
- A measured result below 5× (or a regression) must be reported honestly; **the performance target is not a prerequisite to running experiments or benchmarks**. Do not assert savings from a forced trivial task.
- Do not fabricate test runs, relax assertions to hide defects, suppress failed provider attempts, or mark a production criterion passed from mock-only evidence.

## 8. Engineering workflow and change discipline

**Harness-neutral intent-first entry / resume (all R/S/A/P/X/I/V stages):** For any coding harness/agent using ACE rules (currently Hermes), the **latest explicit owner request selects the entry stage**; a new session never implies starting R automatically. "Research" enters R, "write requirements" S, "architecture" A, "split tasks" P, "phase briefs/synthesis" X, "implement" I and "verify/review" V; "continue" resumes the **verified last active stage**, not always I. Check only the selected stage's prerequisite artifacts/source hashes and reuse valid upstream R/S/A/P/X outputs. A scoped input change triggers only owning-stage repair, never whole-pipeline recreation. **T2 G02 and provider-egress approval are binding at their dependent action**, not automatic vetoes on provisional planning and not supplied by a plan filename. An explicit implement request with accepted canonical tasks/phase enters I directly, with RED/GREEN and reviews, not a new Research/architecture/dual-plan run. Follow `docs/operations/implementation-entry-resume.md` and existing stage command skills; no extra orchestrator, automatic human approval, or model-provider bypass.

**PR publication (explicit owner decision, 2026-11-21):** For every work stage, source change, documentation change, security fix, research or implementation, **open GitHub PRs immediately in the ordinary Ready-for-review state**. Do not use preliminary PR states, defer review availability pending CI/G02/upstream dependencies, or change a reviewable PR back into a preliminary state. Clearly state missing evidence and blocked acceptance in the PR body; keep merge approval, provider egress and production release separately gated. Use standard `gh pr create` without preliminary-status options, or the equivalent normal GitHub PR creation flow. Historical plans and generic caution never override this rule.

**Owner-directed implementation (T2):** An explicit owner request to `implement <phase>` against a current canonical design, tasks DAG and executable phase brief authorizes **in-scope offline code, tests and an ordinary PR** without repeating G02 approval of already specified architecture. Record the owner instruction and reuse the existing crosswalk; plan existence alone is not permission. Generic `G02=REVIEW_REQUIRED` or unchecked predecessor checkboxes **do not block independent code authoring**. A **specific new unresolved material architectural decision** requires owner G02 *for the affected edit*; continue other in-scope work. DAG dependencies govern final integration, real-agent/provider testing and acceptance. Separate provider/model/data permissions and egress authorization remain mandatory for external calls. Offline code authorization never implies a security bypass, new architecture approval or production release.


**Operational SDLC for every repository change:** follow
`docs/operations/ai-assisted-sdlc.md`. Choose T0/T1/T2 by risk, route through
`docs/research/sdlc/PROMPTS-ACE.md` and read the complete stage command.
For material T2 changes, reuse the G02 Design Consistency crosswalk and explicit owner instruction for an existing phase; obtain a fresh G02 owner decision only before an edit introducing a **new unresolved material architecture choice**. For implementation perform
four distinct BUILD/ARCH/SEC/PLAN reviews backed by observed evidence.
This is the established one-agent process, not a new orchestrator or authority
over accepted ADR/OpenSpec. The optional local diagnostic
`npm run sdlc:preflight` records facts and possible blockers only;
it never certifies G02 approval, tests, CI or production readiness.

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
- `npm run verify:pr` is the **bounded PR gate**: typecheck, affected deterministic tests, lint, architecture and local SDLC checks, including the structural/process closure audit. `npm run check:sdlc-closure` may support a claim that the repository SDLC/structural refactor is integrated; it **never** certifies real provider bytes, real-agent behavior, retry/streaming, or benchmark economics. Do **not** silently escalate a PR (including a package/config/workflow change) to `npm test` or real Qdrant/LSP/agent E2E. For broad config edits use a small declared smoke set plus known affected tests and flag any untested risk. Run `npm run verify:full` and expensive real-provider suites in the **scheduled nightly/manual full scope**, not as an automatic per-PR or push-to-main requirement. Explicit capability-specific acceptance before release remains mandatory where relevant.
- The affected-test selector is an optimization, **not a completeness certificate**: source changes use reverse imports; script changes use direct references; build/config changes add bounded smoke tests. If no test is selected, print the missing-coverage limitation rather than claiming behavior is verified. Preserve exact SHA and report individual unrun or failing gates truthfully.
- **Owner decision (2026-11-12): no GitHub branch protection, rulesets, required status checks or mandatory PR approvals are to be configured for this repo.** Do not create owner-action tickets for them. CI is informational unless the owner separately chooses to enforce it. This does not waive accepted T2 G02 architecture decisions or truthful provider/release acceptance.
- In clean CI environments install locked dependencies **once** with `npm ci --ignore-scripts`. Do not rerun `npm ci` between test stages or after ordinary source edits in an already-installed workspace.
- Build/typecheck work must not be duplicated accidentally. Typecheck is a separate gate from `npm test`; TypeScript incremental state may be reused locally. When several expensive E2E commands exercise the same unchanged source, compile once or rely on the incremental build rather than intentionally forcing repeated clean rebuilds.

- Work in reviewable branches and PRs; do not push directly to `main` unless the owner explicitly authorizes that operation. Preserve unrelated edits.
- **Every completed repository change MUST be delivered through a pull request targeting `main`**, including documentation, tests, benchmarks, configuration, infrastructure and evidence-only changes. A local commit or a pushed feature branch without a PR is not completed work; the completion report MUST include the PR number or URL.
- **After each small logically complete and verified slice, create a focused commit; before every progress or completion report to the owner, push the current branch and verify that an open PR targeting `main` contains the intended commit and files.** Report the PR number/URL, base/head branch, observed head SHA and each required check at that SHA as `pass`, `fail`, `pending`, `none configured` or `unknown` with the reason; use an explicit mixed summary when checks differ. Never leave a verified slice only in the working tree or report it as delivered from a local-only branch. Preserve unrelated user files and never force-push or hard-reset to satisfy this rule.
- When the owner names a governing plan for the work, progress and completion reports must identify its repository path and the stable task IDs, or exact plan labels/anchors when IDs do not exist, assigned to the current slice. Report those tasks as completed, open, blocked, deferred or not run after reconfirming them against current code and evidence. Link the remaining section and, if useful, label its unchecked count as plan-marked rather than current implementation status unless that scope was separately revalidated; do not reproduce an unbounded or stale unchecked backlog.
- Before starting unrelated work, inspect the remote branches and existing PRs. If a usable completed change is already stranded on a branch without a PR, create its PR to `main` before moving on. Do not leave completed work stranded or silently assume that another branch contains it.
- If PR creation is blocked by authentication, network, repository policy or another external dependency, report the work as `blocked`/`not_done` rather than claiming completion.
- For affected capabilities run typecheck, lint, unit/contract tests, OpenSpec validation, real-provider integration, SDK conformance and agent E2E **as applicable**. Report precisely what was run, skipped, unavailable and why.
- Promote production capability only after applicable real evidence, security/permission checks, reproducible evaluation and explicit owner review. If a provider needs credentials or external services unavailable to the current runner, record a specific blocker rather than inventing success.

### Git worktree lifecycle

- For task work that needs isolation, run `npm run worktree:audit` or `npm run worktree:preflight -- --task-id <task-id>` before creating or reusing a branch/worktree.
- Use `npm run worktree:start -- --task-id <task-id> --path <path>` instead of raw `git worktree add`. The task ID deterministically maps to one `codex/<task-id>` branch; an existing branch, worktree, or open PR must be reused rather than duplicated.
- New task worktrees must be based on `origin/main`. A dirty checkout, unresolved index entries, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, or `REBASE_HEAD` is a recovery state and must not be used as a creation base.
- `npm run worktree:audit` is read-only: it must not stop agents, switch branches, mutate existing worktrees, or remove legacy worktrees. Existing unregistered worktrees are reported as `legacy-unclassified` for owner review.
- Register progress with `npm run worktree:status -- --task-id <task-id>`. After a PR is merged, `npm run worktree:cleanup -- --task-id <task-id>` may remove only a verified clean worktree and its local branch. Never delete a remote branch automatically; never clean a dirty or conflicted worktree automatically.

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
- **delivery URL/state**: for repository work, include the verified PR and head-SHA check state required above;
- **plan coverage**: when the owner named a governing plan, include the current-slice task status and remaining-scope summary required above.

Never describe a capability as production-ready merely because its implementation exists. A missing external environment may justify `NOT_RUN` / `BLOCKED`; it never justifies a fabricated PASS.
