# implement frontend

## Procedure
Read the approved plan and design; implement small dependency-ordered phases; run unit/component/integration checks, accessibility, lint/build, security and plan-completeness reviews sequentially; correct and rerun. Report exact tested revision.

**Inputs:** user goal; code and existing test evidence; accepted constraints; target runtime. **Outputs:** smallest necessary design/plan/diff and verified evidence report.

## Procedure
This section is **not** attributed to the original video's prompt. It is a usable substitute with explicit inputs/outputs.

**Inputs:** user goal, scope, current implementation, accepted design (if relevant), exact branch/commit, risk tier.

**Process:** Read approved frontend feature design and phase dependencies. Implement one phase, run frontend build/typecheck/unit, browser checks when available, accessibility/security and complete design coverage. On any failed gate return to same phase. Complete with end-to-end smoke and exact PR/CI evidence.

**Deliverable:** Summary, Change plan, Code/test evidence, Four-gate review table, Open decisions/blockers, PR SHA and next action.
