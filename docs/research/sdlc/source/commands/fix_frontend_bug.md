# Fix Frontend Bug

## Input
Defect report, expected behavior, reproduction steps, browser/device context, affected frontend application, branch and commit. Treat UI and API observations as evidence; don't invent screenshots or browser results.

## Procedure
1. Reproduce the defect in the affected component or route; document expected vs actual behavior. Capture a deterministic RED test if practical.
2. Trace the entire relevant component tree, state transitions, API client and backend contracts; inspect the owning code and its tests.
3. Identify the first broken invariant or state transition. Search for related known regressions and open PRs.
4. Assess the blast radius: other callers, shared components, navigation, error/loading/empty states, authorization, accessibility and compatibility.
5. Choose the smallest fix that preserves accepted architecture and public API behavior. Obtain a human decision for a material design change.
6. Implement the fix in a focused slice; run targeted tests, typecheck/lint/build as applicable, and browser or component checks when the environment supports them.
7. Run separate review passes: BUILD (observed command results), ARCH (component/state/API ownership), SEC (auth, input, XSS, untrusted content), PLAN (requirements and regression cases).
8. If a pass fails, repair the same slice and repeat the applicable checks.
9. Save an exact PR HEAD, CI outcomes, manual verification evidence and open limitations. Do not claim that a browser test ran if it did not.

## Output
Root cause, changed files, RED/GREEN evidence, tests run and not run, four-gate report, PR link/commit, remaining issues. Human approval controls merge.
