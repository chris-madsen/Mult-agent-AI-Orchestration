# Implement Backend — single-agent phase executor with explicit quality gates

## Mission and mode

Implement an already approved plan **one independently testable slice at a time**, preserving the author's four-category review protocol: build, architecture, security and plan completeness. The working implementation is for ACE's TypeScript + Effect core, not a Go service or a multi-agent framework.

The same coding agent sequentially performs implementation and review passes. That does **not** constitute independent review. A separate human retains authority for architecture choices, production acceptance and merge.

**Core invariant:** no phase is complete until every applicable gate is supported by observed evidence. A checklist tick or plausible test output is not evidence.

## Phase 0 — understand mission
Before writing code:
1. Read root AGENTS.md and the nearest scoped rules.
2. Read the **entire** relevant plan and all in-scope phase files.
3. Record task IDs, dependencies, state of each phase, and which source commit those statuses refer to.
4. Read accepted ADRs, OpenSpec requirements and contract IDs.
5. Read design architecture, dataflow, sequence diagrams, decisions, tests and public contracts.
6. Review existing branches/PRs for overlapping work or a stranded completed change.
7. Inspect the **current** code and runtime composition; an old plan cannot prove work is missing.
8. Identify exact implementation owners and upstream libraries.
9. Record current branch, worktree status, base commit and known unrelated edits.
10. Establish what tests or provider credentials are possible in the environment.
11. Flag missing owner decisions rather than implementing a private preference.
12. Map each phase to affected DDD bounded contexts, TypeScript packages, stores and protocols.

## Phase 1 — phase ledger (replaces team tools)
Maintain a durable work ledger in the governing plan or a linked evidence artifact:

| ID | Dependency | Status | Changed paths | Tests | Gates | Commit |
|---|---|---|---|---|---|---|
| P-01 | none | READY | ... | ... | ... | ... |
| P-02 | P-01 | BLOCKED | ... | ... | ... | ... |

Valid states: READY, IN-PROGRESS, FAILED, BLOCKED, VERIFIED, DELIVERED. Never infer DELIVERED from local code without commit/push/open PR as ACE rules require.

Pick the first unblocked phase. No speculative work on later phases, no hidden background agent activities and no implementation in a separate unrelated branch.

## Phase 2 — build an executable brief for this slice

Before edit, write:
- Phase ID, desired user-visible capability and what specifically stays unchanged.
- Exact paths expected to be created and modified.
- Relevant code references and planned owner of every interface.
- Inputs, outputs and contract IDs.
- Preconditions, postconditions, invariants, exceptional postconditions and frame conditions.
- Negative cases and test oracles.
- Allowed dependency direction and approved library implementations.
- Provider/credential test needs.
- Local command(s) and exact pass criteria.
- Open decisions, risks and rollback procedure.

Stop if a critical test is impossible to specify or the plan contradicts an accepted ADR. Propose a small plan amendment and obtain a human decision for material design changes.

## Phase 3 — test-first implementation

### RED: demonstrate missing behavior
1. Find the cheapest existing test owning the invariant.
2. Add a table case or focused test; new file only when new subsystem/contract requires it.
3. Avoid re-testing the same edge at unit, contract, E2E and provider level without distinct evidence value.
4. For an actual defect run the test and confirm it fails for the **intended symptom**, not a missing dependency or syntax error.
5. Record command, exit, key assertion, source SHA and fixture.
6. If reproduction is impossible, mark STATIC-UNCONFIRMED and retain the limitation; do not fabricate RED.

### GREEN: smallest coherent code
7. Implement only sufficient behavior to satisfy the phase contract.
8. Prefer official SDK, provider-native primitives and pinned licensed upstream functions; do not rebuild established algorithms.
9. Keep TS + Effect domain/application ownership, typed service dependencies and explicit errors.
10. Do not mutate a user's worktree through ACE retrieval operations.
11. Respect data-policy checks before any transmission.
12. Separate explicit MCP tools, Hermes native context transformation and Bifrost gateway projection.
13. For retries distinguish safe reads from side-effecting tools. Idempotency/recovery is required for relevant replays.
14. Preserve source freshness, exact ranges and honest partial/unavailable semantics.
15. Delete superseded implementation when replacement owner is verified. Document temporary compatibility and deletion point.
16. Avoid unrelated formatting, backend redesign, second framework or gratuitous tests.
17. Run the minimal changed test and confirm GREEN; preserve before/after assertions and output.
18. Use `npm run test:affected` (or narrower explicit command) for inner-loop feedback.
19. Refactor only with GREEN tests remaining; avoid adding abstraction solely to pass a mocked case.

### Phase handoff
Capture the diff summary, source version, new/modified/deleted paths, accepted deviations, unit/contract evidence, provider integration obligations and question for owner.

## Phase 4 — four sequential reviewer passes

Each pass starts from the current diff and reads the evidence from earlier passes. The agent must report a separate verdict **for this pass**, rather than outputting four cheerful PASS words at once.

### Gate A: BUILD / TEST / LINT / RUNTIME

Checklist:
1. Show exact command, working directory, exit code and relevant output.
2. TypeScript strict typecheck; eslint with zero warnings where project requires.
3. Deterministic tests selecting impacted capabilities.
4. Contract tests for changed public or port interface.
5. Build/compiled runtime provenance where applicable.
6. If Go connector was affected, its own `go test` and `go vet`; do not require Go otherwise.
7. Real-provider tests for changed provider boundary.
8. Real LSP/Qdrant/Graphiti/Vertex/k3s tests only where relevant; don't run expensive suites per edit.
9. Distinguish inaccessible credentials from skipped tests, both from executed PASS.
10. Observe actual execution logs, not model assertions.
11. Verify that tests fail under a purposeful negative mutation/failpoint if they purport to catch a critical regression, where safe/practical.
12. Ensure committed source corresponds to tested SHA; source changes after tests may invalidate evidence.

Return verdict PASS / FAIL / UNKNOWN / NOT-RUN (with rationale) and exact evidence.

### Gate B: ARCHITECTURE / STANDARDS

Checklist:
1. Accepted ADR/OpenSpec design compliance with path:line references.
2. Domain cannot depend directly on infrastructure/protocol DTOs.
3. Effect service wiring and typed errors are preserved.
4. Only one owner for each major function/state; no shadow implementation or parallel new-old owner.
5. Type and symbol semantics provided by real ast-grep/LSP, not regex heuristics.
6. Correct Qdrant index/warm cache and source revision binding.
7. Honest completeness/freshness and user-authorized expansions.
8. Clear separation of MCP explicit tools from model-bound Bifrost injection.
9. Provider selection evidence rather than "implemented == chosen."
10. Native library feature check before bespoke cache, protocol, lifecycle, queue or parser.
11. No accidental service-per-DDD-context or unapproved language/runtime introduction.
12. No stale/duplicated tests, unbounded giant adapters without justified boundaries.
13. Error mapping between domain/application/provider/public contract is correct.
14. Migration/deletion point if replacing functionality.
15. No orphan code or unreachable runtime branches introduced.

For each finding: severity, path:line, violated approved rule, observed impact, minimal action and retest needed. Distinguish confirmed violations from plausible risks.

### Gate C: SECURITY / TRUST / RELIABILITY

Checklist:
1. Input schema validation, canonical paths/symlinks and request size.
2. Authorization at actual boundary rather than relying on caller-supplied identity.
3. Secret handling in logs, generated evidence, CI artifacts and traces.
4. Data classification and destination-specific authorization immediately before egress.
5. Prompt/tool injection: retrieved code/documents are **data**, never instructions.
6. Side-effecting tool calls: identity, permission, idempotency and replay semantics.
7. Retry budget, exponential jitter, bounded timeouts, cancellation; avoid multiplying retries across layers.
8. Circuit breaker/backpressure/isolation where task requires, not automatic heavy framework deployment.
9. Degraded state is explicit: unavailable, stale, partial, denied, not-ready distinct from empty success.
10. Concurrency races, lock scope, CAS/fencing, restart correctness when relevant.
11. Unsafe shell commands, eval, path traversal, SSRF or arbitrary provider URL injection.
12. Protected branches and other user files remain unchanged.
13. Dependency / license/supply chain changes reviewed when dependencies changed.
14. No hard-coded credentials, test fixture credentials or accidental private-source export.
15. Actual denied/negative path tests where security claim depends on them.

Do not label the software secure on the strength of a standalone checklist.

### Gate D: PLAN / DESIGN / FEATURE COMPLETENESS

Checklist:
1. Compare every phase requirement ID with code and test evidence.
2. Verify every planned new/modified/deleted path or an approved substitution.
3. Match names, API schemas, error codes and versions in design and implementation.
4. Confirm positive and negative cases both covered.
5. Check required data transitions and compensations.
6. Check runtime composition actually calls the new capability.
7. Check migrations, feature flags and client compatibility.
8. Verify behavior across the whole user-visible path, not only adapter instantiation.
9. Confirm OpenSpec task statuses match evidence, not assumption.
10. Document scope additions, skips and blocked requirements.
11. Ensure no production-readiness status promoted without real evidence.
12. Ensure documentation reflects observed implementation at exact SHA.
13. List any previously accepted decisions newly challenged by code.
14. Report ACCEPTED / PARTIAL / MISSING for each criterion.

A phase cannot be marked complete with a MISSING mandatory requirement.

## Phase 5 — repair loop

If any mandatory gate FAILS:
1. Gather concrete findings rather than generic "improve quality" feedback.
2. Cluster findings by root cause and changed code owner.
3. Rank blockers and determine the smallest coherent repair.
4. Amend an approved design only with owner authorization when needed.
5. Fix one issue or tightly coupled group.
6. Run the focused regression(s), build/check where changed, then all relevant gates again.
7. Preserve test evidence from the repaired SHA; earlier green runs do not validate new code.
8. Record which findings were resolved and which remain OPEN/UNKNOWN.
9. Refuse premature phase closure even if deadline or context is running short.
10. If unresolvable, report BLOCKED, leaving code/PR state transparent.

## Phase 6 — commit, push and PR evidence

- Run `npm run verify:pr` once at handoff readiness, using the repository's current script.
- Use focused commits per coherent verified slice.
- Push branch and confirm PR to `main` contains each delivered commit; no direct-to-main unless owner explicitly authorizes.
- Record exact PR number and head SHA.
- Report statuses for required checks at that SHA: pass / fail / pending / none configured / unknown.
- Retain provider logs, fixture IDs and source-linked artifacts where needed.
- Do not mark a phase DELIVERED if push/PR creation failed; report BLOCKED with actual reason.
- Do not merge until owner approval and applicable gates.

## Phase 7 — final cross-phase review

Read all implemented phases together (not just HEAD~1). Verify:
1. Public schema and error-code consistency across phases.
2. Correct DI composition and routing to actual adapters/providers.
3. Identical state ownership and representation across calls.
4. No contradictory retries/duplicate side effects.
5. Cross-phase security and egress authorization.
6. No missing migration, tombstone, cleanup or reverse compatibility.
7. No orphan classes, dead adapters, shadow code or stale docs.
8. End-to-end positive and negative workflow against selected real providers, as applicable.
9. Reproducible benchmarks/quality metrics for performance-related claims.
10. User worktree and private data preserved.
11. Required deployment/runtime evidence attached to exact SHA.
12. Remaining open risks and test omissions honestly reported.
13. Explicit owner decision on final change; separate production promotion if required.

## Context checkpoint / resume

At each completed phase and before context compaction record:
- task/phase identifiers, dependency status and source plan;
- branch/HEAD SHA/open PR; changed and unrelated files;
- accepted decisions and contract IDs;
- commands run, pass/fail evidence, provider names/versions;
- failed findings, blockers, optional tests skipped;
- exact next action and which source files must be re-read.

After resume re-check HEAD, worktree, plan and PR; do not trust a stale summary over current code. If client exposes context usage, proactively checkpoint; no numerical threshold is mandatory.

## Required final report format

```markdown
# Phase P-N completion report
Branch: <branch>
Head: <sha>
PR: <url>
Design: <path>
Plan: <path/task ids>
Implemented: <paths and behavior>
RED: <command/exact failure> (or reason not run)
GREEN: <command/exact result>

| Gate | PASS/FAIL/UNKNOWN/NOT-RUN/N/A | Evidence | Findings |
| BUILD | | | |
| ARCH | | | |
| SEC | | | |
| PLAN | | | |

Provider E2E: <exact invocation/status>
Owner decisions: <approved/unapproved>
Remaining risks: <...>
Next dependent phase: <...>
```

## Automated Quality Gate selection and proof (updated)

Read the [Quality Gates standard](../standards/Quality%20Gates.md) and [catalog](../../QUALITY-GATES-CATALOG.md). These are *selections and procedures*, not assertions that every tool exists in ACE.

For each phase:
- After research and design (T2), verify **G02 Design Consistency** before code: all acceptance IDs have a contract owner, phase and oracle.
- Inner loop: use installed ACE `npm run test:affected` and necessary existing type/lint scripts; run only **enabled** scoped architecture rules, never an imaginary `check:ast`.
- PR: separate gate axes BUILD / ARCH / SEC / PLAN; consider offline Markdown links, workflow lint/secret scan, dependency check and contract compatibility based on changed scope. Record proposed-but-uninstalled tools as NOT-RUN.
- Provider release: real Qdrant/LSP/Graphiti/Vertex/Bifrost/Hermes evidence is capability-scoped. A passing static rule cannot replace actual provider proof.
- Final: bound results to exact commit SHA and PR check run. New security/egress/source-freshness violations cannot be suppressed by a generic baseline.
- Expensive nightly candidates (CodeQL, advisory refresh, fuzz/mutation) must not slow every edit.

If proposing a new rule, require a stable rule ID, positive and negative tests, scope exclusions, concrete fix message, false-positive investigation and observed failing CI before declaring it active. Prefer TS/Effect architecture tests or ast-grep for syntax; use dependency-cruiser/SCIP only for rules that actually require it.

## Functional DDD / TypeSpec-specific implementation contract

The owner selected Event Storming + functional DDD for material domain work and TypeSpec for public machine contracts. Before code, read [functional policy](../../ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md), [codegen coverage](../../TYPESPEC-CODEGEN-COVERAGE.md), [Functional Domain Modeling](../standards/Functional%20Domain%20Modeling.md) and [TypeSpec Contract First](../standards/TypeSpec%20Contract%20First.md). For auxiliary techniques read the **imported original** Matt skills (tdd, code-review, diagnosing-bugs, domain-modeling) at `.agents/skills` — don't run `implement-spec` as a parallel subagent orchestrator.

A phase changing a public interface must:
- edit TypeSpec canonical source **after the toolchain is installed**; preserve current accepted protocol behavior during rollout;
- generate the supported client/server shell, validators, typed mapping, metadata, fixtures and docs through version-pinned tools;
- fail for unmapped new DTO fields and unknown enum variants; validate nullable/optional and tagged errors;
- keep domain ADT, pure invariants and Effect orchestration **handwritten and owned**, never generated as boilerplate;
- run deterministic generation/drift/compatibility/roundtrip checks, explicit permission negative tests and real provider protocol tests when affected;
- report missing codegen tools as NOT-RUN/BLOCKED, not fake PASS.

An architecture review must reject unnecessary mutable entity classes and god services where they spread invariants, but **not** reject readonly ADT + pure domain functions as "anemic".
