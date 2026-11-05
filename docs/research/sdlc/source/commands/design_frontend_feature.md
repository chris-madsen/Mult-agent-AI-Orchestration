# design frontend feature

## Procedure
For a frontend change, map routes, components, state flow, accessibility, security, API contracts, loading/error/empty states and testing; write architecture, behavior, decisions and test mapping. Never transplant backend-specific Go rules or assume framework.

**Inputs:** user goal; code and existing test evidence; accepted constraints; target runtime. **Outputs:** smallest necessary design/plan/diff and verified evidence report.

## Procedure
This section is **not** attributed to the original video's prompt. It is a usable substitute with explicit inputs/outputs.

**Inputs:** user goal, scope, current implementation, accepted design (if relevant), exact branch/commit, risk tier.

**Process:** Locate UI entrypoint, component ownership, state, routes, backend contract, auth, accessibility and responsive behavior. Map success/loading/empty/error states; document interaction/sequence and failure handling; define unit/component/browser assertions. Keep frontend-specific techniques conditional, never assume Go/backend structure.

**Deliverable:** Summary, Change plan, Code/test evidence, Four-gate review table, Open decisions/blockers, PR SHA and next action.
