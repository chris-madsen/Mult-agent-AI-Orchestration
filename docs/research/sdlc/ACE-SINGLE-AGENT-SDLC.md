# ACE Single-Agent AI-assisted SDLC — process specification
**Status:** process specification for ACE. Supporting commands and templates are in this directory.

## Design principle
Transfer the **rules inside the source prompts**, not just Research → Design → Plan → Implement. Do not copy Claude TeamCreate/TaskCreate/Delegate, Go conventions, or mandates for four agents. ONE agent handles sequential modes, while human approves material decisions and merge. The agent may imitate four REVIEW CHECKLISTS, but cannot claim four independent reviewers.

## Source instructions → ACE mapping
| Source | Rule preserved | ACE location |
|---|---|---|
| source/commands/research_codebase.md and codebase-researcher.md | Describe present code only; read directly cited files fully; capture exact file:line and commit; track entrypoints, dependencies and data flow; unknowns explicit | Existing OpenSpec research or one docs/research report |
| source/commands/design_feature.md | Research only when needed; C4, DFD, sequence, decisions, testing coverage; conditional events/persistence/standards/API | Existing openspec/changes/<id>/design.md, link to ADR where needed |
| source/examples/user-avatar/01-architecture.md | proposed vs current context/container/component and DI boundaries | Design architecture section only when boundaries change |
| 02-behavior.md | normal, error and async sequences | Design behavior section |
| 03-decisions.md | options, rationale, risks, unanswered owner choices | ADR if material, otherwise design table |
| 04-testing.md | requirement / error / invariant → exact test mapping | OpenSpec specs and tasks |
| 05-events.md, 06-repo-model.md, 08-api-contract.md | conditional artifacts: events, mapping and external contract | Include only if changed; explain N/A |
| 07-standards.md, prompts/be/ | project-specific rules for implementer and reviewers | Refer to ACE root AGENTS.md + Accepted ADRs; DO NOT import Go rules |
| plan/README.md, phase-01..08 | dependency-ordered small implementation slices, exact create/modify file map, verification and completion conditions | Existing OpenSpec tasks.md OR governing docs/plans file: one canonical plan |
| implement_backend.md | phase gating; build/test/lint, architecture, security, plan completion; reject/rework; final cross-phase smoke | four sequential, separately reported self-check passes |
| progress/checkpoint | persist state before compaction | brief report with SHA, PR, phase, outcomes, blocker and next action |

## Change risk tiers
- **T0:** documentation/simple mechanical edits. No forced research or C4. Read owner rules; apply relevant checks; PR evidence.
- **T1:** isolated bugfix. Fact-only mini-research, reproducible RED when feasible, minimal design, one small phase, GREEN plus four gates. For crash/race use deterministic failpoints instead of sleep.
- **T2:** feature, architecture, public protocol, permissions, state ownership or egress. Full Research → Design → Plan → human decision → phases → gates → cross-phase review → real E2E where applicable → PR/CI/owner approval.

A one-line policy or authorization edit can be T2. Complexity is determined by risk, not diff size.

## One-agent workflow contract
1. INSPECT: root AGENTS, relevant accepted ADR/OpenSpec, existing code/tests, open PRs and exact HEAD; preserve unrelated edits.
2. RESEARCH: only AS-IS facts with verified path:line; follow code entrypoints and full relevant reads, record gaps. NO unsolicited refactoring advice in this stage.
3. DESIGN: distinguish observed AS-IS from intended TO-BE. Document necessary C4/dataflow/sequence, success/failure paths, alternatives, and impact on state/security/contracts. Human approval for new architectural owner choices.
4. PLAN: smallest dependency-ordered phases with exact create/modify file map; tests and stop conditions for every phase. Use existing OpenSpec tasks or approved execution plan; do not create a duplicate parallel tracker.
5. IMPLEMENT one unblocked slice: obtain RED for bug when practical, code minimal change, run affected tests.
6. REVIEW same slice with four **separate prompts / passes**:
   - G1 Build: record commands, exit status, lint/typecheck/tests and runtime evidence. No PASS without execution.
   - G2 Architecture: typed boundaries, DDD direction, Accepted ADR, no shadow implementation, actual dependency injection.
   - G3 Security: source trust, auth, input validation, secrets, privacy/egress, tool side effects, retries and error handling.
   - G4 Plan: each requirement, named file, negative test, decision and contract mapped to delivered code/test.
   Any FAIL → fix and re-run; UNKNOWN ≠ PASS. Record N/A with reason.
7. COMMIT / PR: focused commit, push branch, verify PR head and CI. Before handoff use project npm run verify:pr once; during edits prefer npm run test:affected. Required external acceptance tests selected by affected capability.
8. FINAL: combined cross-phase review, DI/wiring, orphan/dead code, API/error consistency, real provider smoke where relevant, docs and owner review. Do not merge or claim production readiness based on mocked tests.

## Evidence contract
Each stage carries: source SHA, change identity, status, exact commands and exit, fixture/provider identity where relevant, file:line proofs, PR and CI links, limitations and owner decision. One agent's self-review is **not independent review**. A green deterministic CI is not real Graphiti, Vertex or Bifrost production acceptance.

## ACE-specific invariants
- Verified current source outranks Qdrant index, Graphiti derived memory and docs.
- Policy denial fails closed; no unauthorized private-code cloud egress.
- MCP tool access is NOT model-bound Bifrost gateway injection.
- Provider timeout, stale digest and malformed responses must never become false complete/current.
- No claimed 5x token savings without paired, quality-gated actual agent measurements.

## Context handling without Claude dependency
If token usage is available, the video's 40/60/80% advice can guide when to prepare/commit a checkpoint. If not, checkpoint every phase boundary and before any handoff/compaction. Save branch, HEAD, PR, accepted design and plan, completed tests, statuses, outstanding blockers and next exact action. Re-read actual source after resuming.

## No extra machinery
No new agent runner, second framework, mandatory .claude folder, extra microservices, per-repo copy of 10 Go standards or separate duplicate spec tree. Start with docs/operations/ai-assisted-sdlc.md and existing ACE governance.
