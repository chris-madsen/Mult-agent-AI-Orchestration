# Design Bugfix — smallest correct repair before coding

## Mission
Propose a narrowly scoped correction to a proven or carefully qualified defect. Separate diagnosis of existing code from a proposed fix; do not start implementation here.

## Inputs
Original failure report; reproduction evidence; affected revision; accepted architecture and public contract; relevant logs/tests; explicit exclusions and security constraints.

## Step 1: clarify contract
1. Specify the exact user-visible expected behavior.
2. Identify preconditions and invalid inputs.
3. Identify actual behavior, timestamp and runtime/provider identity.
4. Find existing OpenSpec requirement or postcondition.
5. Specify whether failure is confirmed, intermittent, or static-unconfirmed.
6. Determine data and state that must remain unchanged.

## Step 2: trace cause
1. Read existing source and actual runtime DI.
2. Trace normal and failure paths, including fallback logic.
3. Identify the first violated invariant with code coordinates.
4. Check secondary and transitive symptoms.
5. Check history/related open PR to avoid duplicate fixes.
6. Identify exact missing or insufficient regression test.

## Step 3: alternatives
For each feasible option list:
- behavior restored;
- touched files/owners;
- compatibility and migration;
- technical and security risks;
- extra provider calls/resources;
- rollback and partial failure;
- existing library/provider-native mechanism;
- test cost and scope.

Prefer minimal scope; an attractive refactor is not automatically a repair.

## Step 4: repair design
Document:
- AS-IS with verified facts;
- TO-BE with allowed change boundary;
- changed call flow/sequence, including failure;
- updated typed errors and status mapping;
- expected state/side effects and no-change frame conditions;
- compatibility with older consumers;
- security and egress behavior;
- code owners and test fixture/oracle;
- migration/deprecation only if unavoidable;
- exact owner decisions requiring approval.

## Step 5: plan/handoff
1. Define one smallest coherent independent phase, or a few dependent phases when unavoidable.
2. Map each phase to exact new/modify/delete paths.
3. Write RED and GREEN test commands, expected failure/success.
4. Include negative/provider E2E obligations.
5. Include rollback/compatibility check.
6. Require all four gate categories as in implement_backend.md.
7. Stop for unresolved material design or data-policy decision.
8. Keep plan inside the existing canonical ACE OpenSpec or approved execution plan, not a duplicate.

## Acceptance and stop
READY when diagnosis is supported, repair is bounded, no implicit new architecture choice exists, and every expected behavior has an oracle. BLOCKED if root cause is unverified and risky action is proposed. No code changes in this mode.

## Document format
```markdown
# Bugfix Design <id>
Expected vs observed:
Evidence / source SHA:
First violated invariant:
Blast radius:
Alternatives and tradeoffs:
Chosen minimal repair:
Files/owners:
Error and negative paths:
Tests and real-provider proof:
Rollback:
Open owner decisions:
Ready/blocked verdict:
```
