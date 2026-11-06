# Fix Frontend Bug — reproduction, trace, minimal repair

## Inputs
Reproduction route, steps, expected and actual DOM/UI behavior, browser/device, screenshot or error trace if provided, API responses if relevant, source SHA.

## Diagnose
1. Reproduce the exact interaction with deterministic fixture where possible.
2. Record route, component state, user identity/permission and network conditions.
3. Confirm whether the error is frontend rendering, state update, navigation, API schema or backend response.
4. Trace the UI component tree and data ownership.
5. Inspect event handlers, asynchronous race, stale closures and cancellation.
6. Check browser console/network traces without exposing secrets.
7. Compare current API payload and accepted contract.
8. Check empty/loading/denied/error/offline cases.
9. Inspect recent related changes and open PRs.
10. Identify first invariant violated and the corresponding regression test.
11. If visual defect cannot be observed in available tool, say NOT-VERIFIED.

## Repair
1. Select the smallest state/component/API boundary change.
2. Avoid broad redesign or wholesale new state architecture.
3. Obtain approval for UX changes beyond defect contract.
4. Add RED test or reproducible manual assertion.
5. Implement minimal fix, run GREEN.
6. Check regression against nearby interactions.
7. Verify focus/keyboard and accessible feedback.
8. Check that authorization and privacy remain unchanged.
9. Test repeated requests, cancellation and failed network where relevant.
10. Run build/arch/security/plan passes individually.

## Manual verification record
- Browser/runtime and revision.
- Steps to reproduce before/after.
- Actual observed UI/DOM or screenshot reference when available.
- Response payload or mock/real distinction.
- Accessibility and keyboard findings.
- Required browser/platform checks not run.

## Handoff
PR/head SHA, tests and statuses, known limitations, owner review. Never claim screenshot or browser verification if only the source code was inspected.
