# Agent-neutral AI-assisted SDLC for ACE

**Scope:** Durable operator workflow, usable by ONE coding agent through any supported client. Accepted ADRs, OpenSpec and root AGENTS.md outrank this workflow. Its research source and full evidence map live in [docs/research/sdlc/](../research/sdlc/README.md); details in [ACE-SINGLE-AGENT-SDLC.md](../research/sdlc/ACE-SINGLE-AGENT-SDLC.md). This file **does not authorize production readiness**.

## Entrypoint / routing
Classify a change by **risk**, not line count:
- **T0:** docs, formatting, mechanical small change: inspect owner and applicable CI; no artificial diagrams/research.
- **T1:** local defect: fact-only research, reproduce RED when possible, short design/plan, GREEN and checks.
- **T2:** new feature, architecture, public contract, data policy, source/persistence ownership, concurrency/critical failure: full Research, Design, Plan, phased Implementation, owner decisions and applicable real E2E.

Before editing: check branch and active PRs for duplicate work; read root AGENTS.md, accepted ADR/OpenSpec, current code/test composition and source version. Follow repository rules for focused commit, push, PR, exact check status and no direct-to-main writes.

## Research (fact-only)
Read directly implicated files completely; start at actual runtime entrypoints, follow imports and provider injections. Record commit, question, path:line evidence, dataflow and unresolved unknowns. Do not propose changes in the Research artifact. Reuse recent verified research if still accurate, otherwise refresh it. See [research_codebase.md](../research/sdlc/source/commands/research_codebase.md).

## Design (risk-proportionate)
Separate verified current system from proposed design. In the **existing** OpenSpec change design file (or small bugfix PR description), add the applicable portions of:
- C4 / boundary and DI graph;
- DFD / sequence for success **and error** behavior;
- decisions, alternatives, owner choices and risks;
- requirement-to-test/negative-case mapping;
- events, persistence mapping, standards, API/MCP/projection contracts ONLY when relevant.

Do not create duplicate docs for their own sake; extract linked longer sections only if necessary. Accepted architecture changes require explicit owner decision.

## Plan
Use the existing OpenSpec `tasks or the governing docs/plans execution plan, not two sources of truth. Each slice: goal, prerequisite, exact create/modify paths, invariant/contract, tests and failure path, review evidence and exit criterion. Narrow phases with real dependencies are preferred over a long implementation prompt.

## Implement one slice, review four times
- Implement minimal approved slice, obtain deterministic RED for reproducible defects where practical.
- Run `npm run test:affected` in the inner loop; do not run full suite after every edit.
- Perform **four separate self-audits** with evidence:
  1. **BUILD:** commands actually run, exits, typecheck/lint/unit/contract and relevant provider-E2E.
  2. **ARCHITECTURE:** DDD and Effect boundaries, accepted design, actual DI, no bespoke duplicate algorithms.
  3. **SECURITY:** authorization, untrusted provider data, safe errors, secrets, cloud egress, side effects, retries.
  4. **PLAN:** exact requirements, file map, tests and error contracts all accounted for.
- FAIL returns to same slice and the full set of applicable checks repeats; UNKNOWN is not PASS. An agent cannot certify its own review as independent human/agent review.
- When ready for handoff run `npm run verify:pr`. The CI is scope-aware; provider/k3s/Harbor acceptance is independent of deterministic PR checks.
- Focused commits, push, PR to main and exact head SHA / check statuses are required by root AGENTS.md.

## Final cross-phase and context checkpoints
Review end-to-end behavior, integration wiring, error/status consistency, orphan/duplicate code, rollback and relevant real provider acceptance. Owner reviews architectural choices and merges. Checkpoint at phase boundaries and before context compaction: branch, SHA, PR, plan, completed checks and logs, next step, blocked decisions. Video's percentage thresholds are **optional heuristic** because not every agent exposes context usage.

## Report format
| Phase / gate | PASS / FAIL / UNKNOWN / N/A / NOT-RUN | Exact evidence (SHA, command, CI, file:line) | Gaps |
|---|---|---|---|
| Research | ... | ... | ... |
| Design + owner decisions | ... | ... | ... |
| Plan | ... | ... | ... |
| Build/test/lint | ... | ... | ... |
| Architecture | ... | ... | ... |
| Security | ... | ... | ... |
| Plan completeness | ... | ... | ... |
| Integration/E2E | ... | ... | ... |
| Final owner review | ... | ... | ... |

Report explicit blockers, real vs mock evidence and tests NOT RUN. For production: no false source freshness, no unauthorized private-code cloud egress, no inferred 5× reduction, no claim Bifrost provider-wire from MCP-only tests.

## Start prompt
“Follow docs/operations/ai-assisted-sdlc.md as a single agent, read root AGENTS.md first, classify task T0/T1/T2, show research/design/plan artifacts only when needed, run four separate check passes with evidence, create a PR with exact SHA and keep unapproved decisions open.”
