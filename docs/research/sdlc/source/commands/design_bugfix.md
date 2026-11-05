# Design Bugfix

## Inputs
Reported symptom, reproduction or failed test, affected repository and commit, owner requirements, relevant architectural rules.

## Procedure
1. Confirm the observable failure. Document actual and expected result and obtain a deterministic RED fixture if practical.
2. Trace the call path from entrypoint to the first violated invariant. Read relevant code and tests completely; cite `path:line`.
3. Identify root cause, downstream effects and other affected callers. Mark uncertain findings explicitly.
4. Compare smallest feasible fixes, side effects, backwards compatibility and rollback. Avoid unrelated refactoring.
5. Define the minimum design: scope, non-goals, changed boundary, success/failure behavior, security and state integrity requirements.
6. Write a small plan with file create/modify map, tests (positive and negative) and owner decisions. For architecture or public contract changes use the existing accepted specification workflow.
7. Do not begin implementation until material decisions are approved.

## Output
Reproduction evidence, root-cause map, minimal design, risk analysis, one or more dependent implementation phases, requirement→test mapping, unresolved decisions.
