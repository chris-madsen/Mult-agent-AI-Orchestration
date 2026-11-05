# Fix Backend Bug — controlled root-cause-to-PR workflow

## When to invoke
A backend/runtime/integration defect has a report, failed regression, incident trace or reliable unexpected behavior. This is NOT a license to rewrite subsystem architecture. If root cause is unknown, start with diagnosis and preserve evidence.

## Inputs and boundaries
- Report: expected/actual behavior, impact, severity and environment.
- Exact repository/branch/HEAD and worktree state.
- Reproduction (CLI, request, fixture, trace or failing test).
- Relevant accepted contract and error semantics.
- Applicable permissions for real provider calls.
- Affected service/port and any existing incident or open PR.

If the report is incomplete, try a bounded investigation; only ask for irreducible details. Do not invent reproduction or run potentially destructive production tests.

## Phase A: establish an observable failure
1. Reproduce the reported case on an isolated suitable fixture.
2. Record exact command/inputs, selected config/provider/runtime and output.
3. Verify the failure is the expected symptom, not bad test setup.
4. Capture a RED regression test when practical; prefer adding a case to the existing test owner.
5. Identify request/correlation ID for asynchronous/provider flows.
6. Check whether a recent code change, configuration change or provider version changed.
7. Distinguish flaky environmental failure from deterministic code behavior; do not silence it with retries.
8. If reproduction requires inaccessible data or production state, mark NOT-REPRODUCED and preserve a static hypothesis only.

## Phase B: root-cause trace
1. Locate executable entry point, transport schema and auth principal.
2. Follow the call chain through domain/use case/adapter/provider.
3. Trace typed error causes, retries, timeouts and cancellation.
4. Capture invariant at each boundary and the first violation.
5. Check data ownership and session state (current source vs cache/index/derived memory).
6. Confirm the actual runtime chooses the suspected implementation.
7. Identify duplicate deliveries/replays, idempotency and crash windows when relevant.
8. For a suspected race, use deterministic synchronization and state assertions.
9. Separate root cause from secondary exception, misleading log or partial cleanup.
10. Form at least one alternative hypothesis and test it if evidence supports it.
11. Locate tests that should have prevented regression and explain why they did not.
12. Record what exact evidence remains missing.

## Phase C: blast radius
Inspect:
- all callers and type/export users;
- other ports/adapters implementing the same interface;
- retry/fallback paths and client version compatibility;
- persisted data/schema/migration and archive records;
- API/MCP/gateway outward error contracts;
- auth/data policy/egress and sensitive logging;
- LSP/Qdrant/Graphiti/Vertex/Harbor where affected;
- deployment configs and release gates;
- tests that must remain unchanged.

Report confirmed direct effects and potential unknown effects separately.

## Phase D: choose minimal repair
1. Enumerate smallest realistic fixes, including reuse of maintained providers/libraries.
2. Compare correctness, scope, rollback and effect on contracts.
3. Preserve accepted ADR/OpenSpec and user-visible semantics unless explicit owner decision authorizes change.
4. Define RED test, GREEN oracle, negative path and real-provider proof obligation.
5. Write a concise plan with exact files and dependency order; one slice by default.
6. Define stop criteria: a new architecture decision, policy egress change or unbounded scope triggers escalation.
7. Prefer negative diff when replacing broken custom machinery.
8. Do not introduce an all-purpose wrapper or duplicate cache to hide one defect.

## Phase E: implementation
1. Make only approved changes in the current feature branch.
2. Keep changed files focused and preserve unrelated edits.
3. Run the original RED test, verify specific failure, then implement fix.
4. Run GREEN and adjacent regression scope.
5. Verify that invalid input, provider outage, partial persistence and cancellation do not report success.
6. Use typed errors with stable public mapping.
7. Avoid catch-and-ignore, unbounded retry and a synthetic empty response on failure.
8. Confirm source revision and runtime build identity match observations.
9. Capture diff and test outcomes.

## Phase F: four gate review
Apply all four passes from [Implement Backend](implement_backend.md), not a one-line assertion:
- Build/typecheck/lint/contract and relevant real integration.
- Architecture/DDD/Effect, no duplicate implementation.
- Security, privacy, trust boundaries and side effects.
- Plan, accepted behavior, file mapping and regression tests.

For every FAIL correct and repeat. UNKNOWN ≠ PASS; blocked provider verification is not concealed by green unit tests.

## Phase G: manual QA specification
For changed backend API/tool/protocol record a concrete manual test flow:
- Environment and source SHA, port/URL, credential method (never actual secret).
- Setup instructions with disposable fixture.
- Positive request: full method/headers/body.
- Expected response: status, schema and side effects.
- Unauthorized/invalid/missing/conflicting/repeat requests.
- Dependency unavailable, timed out and cancelled.
- Idempotent retry after partial success.
- Observability fields and correlation identifiers.
- Data cleanup/rollback procedure.
- Which commands **actually ran** and their results.

Template:
```markdown
# Manual QA: <feature>
Revision:
Setup:
Request:
```bash
curl -i -X POST <endpoint> -H 'Content-Type: application/json' -d '<payload>'
```
Expected:
Actual result:
Negative case:
Security assertion:
Result: PASS | FAIL | NOT-RUN
```
Use the concrete storage for test evidence designated by ACE; do not introduce a competing directory solely to mirror a different Go repository.

## Phase H: handoff and release discipline
- Run the applicable full PR verification once when ready.
- Commit small, push branch, verify PR targets main and contains commit.
- Record source SHA, CI statuses, real provider tests performed or skipped, remaining limitations.
- Do not silently mark production gate accepted.
- Obtain owner review for required decisions and merge.
- Save checkpoint if context may be compacted; on resume re-open source and plan.

## Bugfix report
```markdown
# Bugfix report: <id>
Symptom:
Expected:
Reproduced at SHA:
Root cause with code references:
Blast radius:
Changed files:
RED / GREEN commands:
Gate A / B / C / D with evidence:
Real provider:
Manual QA:
PR and HEAD:
Risks and owner decisions:
```

## Completion contract
A bug is **fixed** only if the original observable failure was corrected under the target conditions and appropriate regression tests pass. A promising diff, green typecheck or speculative root cause is insufficient.
