# ACE staged SDLC — skill pipeline and review-overlap PR contract

**Route:** `.agents/skills/ace-stage-handoff/SKILL.md` orchestrates sequential skill handoffs within one active agent session. **Status:** proposed one-agent procedure for operator-initiated work. This is a **skill-led** stage handoff, not an autonomous daemon. It cannot execute across disconnected sessions unless the active agent host itself provides a continuing execution loop. Canonical authority remains root `AGENTS.md` → accepted ADR/OpenSpec and current owner decisions → current source and tests. **No automatic merge, branch protection or enforced GitHub approvals** (owner decision of 2026-11-12).

## Entry to existing work at any stage (do not replay R → X)

The following stage diagram describes **production of new artifacts**, not an obligatory first-stage startup for each agent turn. Apply [universal harness-neutral stage entry/resume](implementation-entry-resume.md). The explicit user request determines **R/S/A/P/X/I/V**; "continue" resumes **any** existing stage, its stacked PR, inputs and verified progress (not necessarily implementation). For example, with existing accepted requirements "continue architecture" enters A and reuses S; with an existing DAG "detail C02" enters X and reuses P; with an approved executable brief "implement C02" enters I. Do not regenerate dual-plan A/B/C unless a *new or materially changed* T2 planning case specifically needs it. For stale inputs repair only the owning stage and impacted descendants. A new unresolved T2 G02 decision blocks only the dependent edit; an explicit owner implementation request for a current canonical phase authorizes in-scope offline code without repeated G02. Incomplete dependencies block live integration/acceptance. No generic fallback to Research for an already existing stage.
## One change, staged artifacts, existing architecture first

| Stage | Mandatory skill / canonical command | Deliverable | May progress before parent merge? | Hard implementation gate |
| --- | --- | --- | --- | --- |
| R: verified Research | `ace-sdlc` + `research_codebase.md` | Fact-only source SHA memo; inspect existing modules, provider wiring, previous PRs | Yes | None; no code |
| S: Requirements | `ace-sdd-prepare` Requirements mode + `to-spec`, OpenSpec CLI | Existing/new `proposal.md` and `specs/**/spec.md` with IDs and tests | Yes, once source facts reviewable | No new architecture assumptions |
| A: Architecture | `ace-architecture-design` + pinned `codebase-design` / `domain-modeling` | `design.md` AS-IS/TO-BE, minimal delta, Event Storming, Functional DDD, optional FSM, Effect, DbC/TypeSpec and G02 crosswalk | Yes, as a **provisional** design if upstream Requirements is not approved | New material G02 choices require approval; existing planned offline implementation follows an explicit owner instruction |
| P: To-tickets | `ace-to-tickets` | One canonical `tasks.md` DAG with ACs, RED/GREEN, ~1000 changed handwritten LOC including tests | Yes if A is coherent; mark unapproved decisions provisional | No source edits |
| X: Executable plans | `ace-phase-plan` → `ace-plan-refinement` (semantic A/B synthesis into C) | `phases/<ID>.md` per chunk linked in `tasks.md`, using `phase-template.md` | Yes while A/P PRs reviewed; SHA-checked | Only edits requiring a new unresolved material choice are blocked; independent offline work can proceed |
| I: Implementation | `openspec-apply-change` constrained to **one phase**, `tdd`, `implement_backend.md` | Source changes, actual RED/GREEN, 4 review gates, PR per chunk | Owner-directed independent offline code may run parallel to incomplete predecessor acceptance; defer dependent integration | Explicit owner request + current phase; new material G02 only for changed design; separate egress for real calls |
| V: Verify/accept | `openspec-verify-change` + final cross-phase review | Complete AC/provider/agent/Harbor evidence; owner decision | Reviewable as findings arrive | Never claim production from mocks or CI alone |

For T0 use the short existing `ace-sdlc` path. For T1 use focused Research→Design→Plan→Implement and only relevant stages. For T2 domain/policy/provider/concurrency/contracts use the full architecture/model/DbC sequence. **Reuse the existing accepted DDD context map and runtime composition**; deepening a module must remove or consolidate ownership rather than leave shadow wrappers. No microservice-per-context, second Gateway, new event bus/FSM framework by default. These are rules, not a rewrite mandate.

## Source and artifact boundaries

- `OpenSpec` owns **behavior/acceptance**; `design.md` owns proposed architecture/accepted decisions; accepted ADRs own architectural rationale; `TypeSpec` owns *selected new or migrated public wire*; code owns observed current behavior. Don't describe a design proposal as observed execution.
- A stage-specific Requirements PR may contain only the *currently complete* `proposal.md` and `specs/**/spec.md`. OpenSpec's `openspec-propose` standard skill normally produces all artifacts **in one call**: for stage PRs use the **pinned OpenSpec CLI** (`context`, `new change` / `status` / `instructions`) to author just the current schema-ready artifacts. Do not commit placeholders as if architecture/plan were accepted. The existing all-in-one `ace-sdd-prepare` remains available when individual stage PRs were not requested.
- Research and architecture may iterate: Event Storming can discover a missing requirement. Update the existing specs in the source stage, then mark dependent design/plan PRs **STALE** until reconciled. No duplicate change for the same capability.
- Architecture (T2) maps commands/events/policies/hot spots, strategic DDD ownership, immutable ADT and pure transition rules, FSM only when essential, Effect orchestration, TypeSpec where public, Meyer require/ensure/invariant/frame/exceptional, and real provider tests. `G02` still governs actual **new material architectural choices**, not repeated signatures for already specified phase code. An explicit owner implementation request does not grant new architecture or external egress approval.
- `tasks.md` is the **single task graph and checkbox ledger**. `phases/<ID>.md` are executable briefs: no second phase completion checkboxes. Use existing `docs/research/sdlc/source/templates/phase-template.md` headings. Full plans must specify exact changed file/test owners, contract inputs/outputs, deterministic RED/GREEN commands and expected observable results, security negatives, rollback/STOP, runtime provider oracles and accepted architecture decisions.
- The planned size of **~700–1,200 changed handwritten lines** incl. tests is a flexible forecast, not a hard refusal to handle a 200-line security seam. If architecture changes cost, automatically reslice the affected unfinished frontier without repeating the owner's granularity interview.

## Dual-plan generation and post-X semantic synthesis

For material **T2 dual-plan** work, use [ACE Plan Refinement](../../.agents/skills/ace-plan-refinement/SKILL.md) at **two checkpoints**. After R/S, freeze one neutral source/requirements bundle. Generate **A: free-form** architecture, dependencies and detailed implementation plan in an isolated fresh agent context, retaining A as private disposable evidence, **not another permanent OpenSpec task ledger or PR**. In a separate fresh context, B performs the usual skills-led A/P/X stages from the **same pinned inputs**, without seeing A. This keeps one agent active at a time and preserves the existing five PR stages. If context isolation cannot be demonstrated, record INDEPENDENCE_NOT_ATTESTED; do not market correlated output as an independent result.

After B's complete X phase inventory, compare A and B by *decisions and source evidence*, not document size, phase count or mechanical Markdown concatenation. Use A, B, a compatible hybrid, a third evidence-backed choice, UNRESOLVED or NO_CHANGE per decision. Synthesize one **C** in canonical `design.md`, `tasks.md` and `phases/*.md`, returning corrections to their owning S/A/P/X stage branches. Changed upstream decisions make descendants STALE and require restack/fingerprint refresh, full phase checking and owner G02 review where material. Preserve findings and candidate hashes in the existing X PR/checkpoint, not an extra task tracker. For T0 skip dual planning; T1 is opt-in/risk-based. Do not imply the Markdown skill itself spawns new sessions or approves G02/egress.

## Stacked PR handoff (not blocked on reviewer latency)

1. **Before branch:** fetch current `main` and inspect overlapping PRs. Run `npm run sdlc:preflight -- --tier T2 --stage design --json` (correct stage/tier), `npm run worktree:preflight -- --task-id <stage-id> --json` and start an isolated worktree through the existing lifecycle. Never write directly to main.
2. **First stage:** branch from fresh `origin/main`. Complete one stage, run its relevant tests/checkers, commit and open an **ordinary Ready-for-review PR** to `main`. Its body gives stage, source/base HEAD, upstream specs/design Git blob fingerprints, evidence, skipped checks and next allowed stage.
3. **Next planning stage while PR is pending:** create a new task branch **from the latest HEAD of the preceding stage branch**, not the older main. Open its PR **against the preceding stage branch**. Its diff should contain only its stage-specific files. This is a **stack**; no duplicate PRs to main for the same OpenSpec artifacts. Continue sequentially while the operator reads the prior PR. Do not claim parallel subagent execution.
4. **On reviewer comment or changed ancestor:** compare the exact *file blob hashes*/spec fingerprints and relevant AC/ADR decisions. A changed source that matters makes descendants `STALE`. Reconcile only affected files/seams, update design/spec hash records and tests, re-run stage checks, and refresh child PR. Keep pending child PR explicitly PROVISIONAL until its parent inputs are stable.
5. **When parent merges:** inspect actual merge base/content (squash merges alter commit ancestry), restack/rebase descendant onto current `main` or surviving parent branch without losing its isolated changes, then **retarget the child PR base**; inspect the three-dot diff so it still shows only its own stage. Never merge a descendant before unmerged ancestor is actually included in the target branch.
6. **Advancement:** reviewable S/A/P/X proposals may trigger the **next planning stage** without waiting for human merge when no dependent hard decision is invented. New unresolved material G02 decisions and live provider/model/egress approval are **hard stops only for their dependent edits/external actions and V acceptance**, never a blanket veto on existing-phase offline code. Implementation also needs an explicit new implementation request under ACE's planning boundary. Publishing a regular Ready-for-review planning PR does not grant G02 approval, implementation authority, production release or provider egress.
7. **Host boundary:** if the currently running Hermes/Codex/other agent supports continuing execution, advance to the next permitted stage in that same authorized task with a fresh context + saved checkpoint as needed. A repository skill or GitHub PR alone cannot resume after the session ends. Do not promise unattended background operation; leave a handoff with exact next command and blocker.

### Handoff data: a lightweight checkpoint, not another ticket tracker

Place the stage proof in the **PR body** and existing `progress-checkpoint.md`-shaped evidence when needed:

| Field | Required |
| --- | --- |
| Identity | change ID, stage ID, branch, parent PR + base/head SHA, current HEAD |
| Inputs | specs fingerprint, design Git blob, ADRs, accepted owner decisions, source/runtime SHA |
| Output | files changed, stage PR URL, AC coverage, child branch/dependency |
| Checks | exact commands, exit/CI checkout SHA, PASS/FAIL/NOT_RUN, mock vs real |
| Verdict | REVIEWABLE, PROVISIONAL, STALE or BLOCKED; **not** automatic OWNER_APPROVED |
| Handoff | one next permitted stage, missing G02/egress, any pending reviewer finding |

## Built-in read-only gates

- `npm run check:sdd-prepare -- --change <id> --tier T2 --json` checks the **full** proposal/spec/design/tasks chain when available and reports G02 review needed; it cannot approve owner decisions. Earlier partial stage PRs cannot claim this full checker PASS.
- `npm run check:ace-phase-plan -- --change <id> --phase <ID> --json` checks one linked phase, required sections, acceptance IDs, absence of duplicate task checkboxes and fresh **Git blob of design.md + SHA-256 fingerprint of sorted specs/**/spec.md sources**. Output `READY_FOR_PHASE_REVIEW` is structural/freshness only.
- `npm run test:ace-sdlc-pipeline` includes positive/negative fixtures (upstream design/spec changed, missing link, unsupported AC, symlink and duplicate trackers) and validates pinned `codebase-design` content.
- All applicable `npm run test:affected` / `npm run verify:pr`/CI and full OpenSpec validation remain necessary on changed scopes. These commands are never proof of live Skill invocation, semantic implementation, G02 acceptance or real provider/agent benchmark.

## Example with G11

Start from approved/accepted G11 capability requirements. Architectural stage must inspect pinned Bifröst hook order and actual ACE Effect/Go composition; proposed per-attempt FSM and pure domain authorization transitions live in `design.md`. Prepare full G02 crosswalk with explicit owner decisions and provider opt-in as required. **Only then** auto-size retries/fallback, streaming, real-agent, Harbor into a DAG, and fill one executable file per chunk. Existing PR #256 (8 blocks) and PR #258 (10 blocks) are **competing alternatives**, not two stack parents; choose/reconcile one before implementing G11. Neither proves G02 or real egress. This pipeline PR modifies SDLC guidance, not those G11 plans.

## Rollout proof and known limitations

Skill file presence + static contract tests prove **repository-level wiring** only. Before claiming fully operational end-to-end automation, run a **real local Hermes** dry-run through R→S→A→P→X creating actual stacked PRs, then exercise a changed parent PR and verify dependent STALE/reconciliation. A separate explicit owner approval must still control I and production promotions. If no host can keep the session running, record `NOT_OBSERVED` rather than inventing background progression.

## Continuous end-to-end stage-handoff trial

The offline R→S→A→P→X Git/trace regression test and the real Hermes operator procedure live in [sdlc-e2e-trial.md](sdlc-e2e-trial.md). Run npm run test:sdlc-stage-trial in CI. A deterministic fixture or normalized trace never certifies a real agent session or G02; inspect original Hermes tool calls separately.
