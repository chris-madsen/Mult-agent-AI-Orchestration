# Implement Frontend — phased UI implementation with quality gates

## Entry conditions
Approved frontend feature design, explicit acceptance criteria, current component tree/API contract, execution plan, branch and source SHA. Only run when an actual frontend capability is being developed.

## Phase 0
- Read entire approved plan and all dependent phase instructions.
- Inspect related screen/components and real API contract.
- Read accepted design system and accessibility conventions.
- Locate tests, Storybook or browser harness if available.
- Confirm which state/route is produced by current runtime.
- Check open branches/PRs and preserve unrelated work.

## Phase loop
1. Select smallest unblocked vertical slice.
2. Record exact files to add/modify and required user journey.
3. Write or update relevant test/interaction assertion; RED when practical.
4. Implement minimal UI/state/API integration.
5. Re-run focused test and check actual runtime output.
6. Do not insert placeholder screenshots or claim visual comparison without evidence.
7. Verify empty, slow, denied, invalid and network error states.
8. Check keyboard and focus behavior with appropriate tools.
9. Avoid hiding backend errors behind a generic success toast.
10. Avoid duplicate submits and non-idempotent replay.
11. Record known browser/platform limitations.

## Four gates
### Build
Run project typecheck, lint, component/unit and applicable real/browser tests. Evidence includes command/output/exit and tested revision.

### Architecture
Read component ownership, state, data loading, API DTO separation and design-system reuse. Reject duplicated unrelated state or API wrappers.

### Security and accessibility
Review untrusted HTML/URLs, auth/cookies/tokens, CSRF/XSS, unsafe redirects, private data in logs, semantic UI/focus/keyboard labels and permission checks.

### Plan completeness
Walk each accepted UI state, screen, accessibility criterion and test case. Match implementation and explicit evidence. Missing required state fails the gate.

## On rejection
Fix same slice; rerun relevant checks. Record exceptions with owner decisions; no silent scope reduction.

## Final cross-phase pass
- Navigation and permissions work together.
- Backend error codes mapped consistently.
- Loading and cancellation state doesn't leave stale UI.
- All components are reachable and dead scaffolding removed.
- Accessibility/keyboard and responsive behavior meet acceptance.
- Browser testing and manual QA have observed results.
- Every issue/PR check binds to exact SHA.

## Handoff
Committed and pushed focused PR with CI statuses, evidence links, owner review and known gaps. A successful build alone is not proof that UI interactions or browser support work.
