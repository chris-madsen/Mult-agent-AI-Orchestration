# Design Frontend Feature — conditional client/UI workflow

## Purpose
Design a UI-facing feature where routes, state transitions, accessibility and API integration are real responsibilities. This file is reusable outside ACE; ACE's current TS/Effect core is not itself a frontend application. **Do not invoke this merely because ACE has TypeScript files.**

## Inputs
User journeys, screens, accessibility and browser support requirements, current frontend framework, API contracts, source revision, design system and accepted project rules.

## Investigate existing UI
1. Locate exact route and page entry point.
2. Identify component tree, state ownership, caches and data loaders.
3. Inspect auth/session and client-side authorization assumptions.
4. Trace frontend→backend requests and response validation.
5. Identify existing design tokens, layout patterns and component library.
6. Map error/empty/loading/offline states.
7. Determine keyboard/focus/screen-reader and localization needs.
8. Locate current tests, UI snapshots and E2E tools.
9. Separate observed behavior from desired redesign.
10. Determine whether research is needed for unfamiliar integrations.

## Produce architecture
- Component ownership and interfaces.
- State machine for user interaction and async requests.
- Public API version, error mapping and retry behavior.
- Route/link/navigation/deep-link semantics.
- Performance: rendering, caching, large results, cancellation.
- Trust and security: injected HTML, URL, auth and secrets.
- Accessibility: semantic markup, focus, contrast, keyboard and error feedback.
- Responsive behavior and browser support.
- Integration/DI boundaries if relevant.

## Behavior scenarios
For each feature:
1. Start state and user action.
2. Validation and authorized preconditions.
3. Fetch/mutation and cancellation.
4. Loading/progress feedback.
5. Success display and navigation.
6. Recoverable error and retry.
7. Permission denied.
8. Empty/stale response.
9. Network offline/timeout.
10. Back/forward/reload persistence and accessibility.
11. Race/double-submit avoidance.

## Decide and document
Write architecture, behavior, decisions, tests, API contract where changed. Record design-system reuse, alternatives, scope exclusions, mockups/visual references and owner review of material UX choices.

## Test matrix
At least:
- component state transitions;
- accessibility and focus;
- API schema/error boundary;
- authorization and invalid input;
- loading/offline/cancellation;
- double submission/idempotency when mutation is involved;
- desktop/mobile when required;
- browser E2E only when actually available.

## Plan handoff
Each slice produces user-visible behavior with tests, not "build all components" in one unchecked step. Include precise files, tests, expected UI states and boundary conditions.

## Final output
An approved design and plan, not implementation. If the repository is backend-only, mark NOT-APPLICABLE and use design_feature.md instead.
