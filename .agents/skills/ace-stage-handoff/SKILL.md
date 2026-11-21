---
name: ace-stage-handoff
description: Harness-neutral ACE stage entry, resume and handoff for any R/S/A/P/X/I/V stage; reuse existing PRs and immutable upstream inputs, preserving G02/egress owner gates.
---

# ACE Stage Handoff — review can overlap preparation

**Mode:** explicit one-agent stage transitions, not a daemon, subagent orchestrator or background runner. The active coding agent applies this after every completed stage when the owner's request authorizes continued planning. **Creating a PR is not merge, approval, production acceptance or permission to implement T2.**

## Enter or resume any requested stage (not always R)

For any compatible coding harness, apply [universal stage entry/resume](../../../docs/operations/implementation-entry-resume.md) **before** the default R→S→A→P→X chain. Stage-specific owner intent selects R, S, A, P, X, I or V. "Continue/продолжай" resumes the **verified current stage**, including an unfinished S/A/P/X PR, not automatically I. Reuse completed fresh input artifacts and existing stage branch/PR; **do not start at R** or regenerate A/B/C simply because the agent has a new context. A requested R stage does research, S updates OpenSpec requirements, A design, P tickets, X phase briefs, I one approved chunk, V verification; each loads only its own skill and necessary inputs. Missing/stale inputs require scoped predecessor repair and restack only affected descendants. Specific new material G02 choices, egress and dependency gates block affected design edits, external execution, integration or acceptance, **not owner-directed in-scope offline implementation**. A resumed stage is not an extra stage or duplicate PR.
## PR state — explicit owner preference (20 November 2026)

**For every R/S/A/P/X/I/V stage, publish an ordinary Ready-for-review GitHub PR as soon as the coherent change is committed, including stacked and provisional planning work.** Never turn an open reviewable PR into a preliminary status to express G02 REVIEW_REQUIRED, missing CI, blocked egress, unfinished upstream stages, unmerged dependencies or security review. Describe those conditions precisely in the PR body; retain merge, implementation and provider-egress controls. Review visibility is not approval, release or permission to send provider requests. Existing stage branches, input fingerprints and dependencies remain authoritative.

## Stage DAG and exit artifacts

1. **Research:** fact-only current-source evidence memo at exact SHA → PR; may run separately when existing verified research can be reused.
2. **Requirements:** `ace-sdd-prepare`'s bounded discovery + `to-spec` → canonical OpenSpec `proposal.md` + `specs/**/spec.md` → PR. For material T2, freeze the shared source/R/S input and run `ace-plan-refinement` PREPARE to generate a private free-form A candidate **before** Skills B sees any candidate output.
3. **Architecture:** `ace-architecture-design` → existing OpenSpec `design.md` (and proposed ADR only if needed) → PR; T2 G02 awaits independent owner decision. Do not promise owner-approved decisions in a provisional architecture proposal.
4. **Plan slicing:** `ace-to-tickets` uses the reviewable design → canonical `tasks.md` with AC/LOC/dependencies → PR. No blind code changes.
5. **Detailed planning:** `ace-phase-plan` expands and verifies every phase file under `phases/`, linked from `tasks.md`; then `ace-plan-refinement` SYNTHESIZE compares frozen private Free A against isolated skills-led B by *semantic decision*, routes the final C corrections through S/A/P/X, updates hashes and tests, and only then publishes the X-stage PR. This is **not a sixth stage**, extra final tracker or separate PR for A. Material upstream edits make descendants STALE and require restacking and fresh fingerprints. Can proceed from a self-consistent unmerged upstream plan **provisionally**.
6. **Implementation:** the owner's explicit instruction to implement an existing canonical phase authorizes **in-scope offline code and tests** without a fresh G02 signature. Use `openspec-apply-change` and full `implement_backend.md`; RED/GREEN + four reviews → **ordinary Ready-for-review PR**; human merge. A new unresolved material architecture choice still needs owner G02 before the affected edit. Incomplete predecessors block dependent integration/live trials and acceptance, not independent code on stable interfaces. Egress is separately authorized.
7. **Final integration:** `openspec-verify-change` plus ACE final cross-phase review and real provider/agent/Harbor tests where applicable → evidence PR/owner production decision. Never manufacture readiness from structural success.

## Safe nonblocking PR protocol

- Before writes: inspect actual remote `main`, current worktree/HEAD, open/merged PRs; run `sdlc:preflight` and `worktree:preflight` as appropriate. Use one task branch/worktree per stage; **never edit `main`**. Branch the first stage from main; for review-overlap, branch each following stage **from the exact prior stage branch HEAD** and set its PR base to that parent branch. This is a *stacked PR*, not several conflicting PRs to main. Keep upstream PR open while working; no automatic merge or branch deletion.
- After each stage: run its actual relevant validation; record source branch HEAD, PR base SHA/number, inputs (file Git blobs/requirements SHA fingerprint), skill invocation observed/not observed, G02/egress status and tests PASS/FAIL/BLOCKED/NOT_RUN. PR body lists prerequisites and explicit **PROVISIONAL** areas. All stage outputs must be reproducible from the recorded parent head.
- **Advance only reviewable, self-consistent planning.** Unresolved material owner choices may be documented and investigated, but never silently fixed by the next stage. A dependent design or phase plan remains `PROVISIONAL/BLOCKED` until the relevant choice is made. A checked box, existing G02 table or missing reviewer comment is not approval.
- **Upstream edits during review:** fetch parent PR head and compare exact input artifact hashes/ACs, not just branch names. If an upstream artifact changed, **mark descendants STALE**; identify affected decisions and repair/rebase the descendants onto the current parent, regenerate their hashes, rerun relevant checks and update PR descriptions. Untouched orthogonal evidence may be reused. Before merge, restack/rebase/retarget dependent PRs so a child diff contains only its own stage; never merge child into main with an unmerged parent.
- **Hard stops:** a specific new unapproved material G02 decision blocks only the dependent edit; missing provider/model/data permission blocks actual egress, not offline code; unsafe source drift blocks dependent execution; failing semantic acceptance blocks promotion. Agent may continue **independent** research/planning only. Do not configure GitHub required checks, branch protection, automated approvals or auto-merge (owner decision forbids them).
- The workflow is **sequential within a running authorized agent session**: after publishing reviewable PR, continue automatically to the next permitted planning stage **if the active host session supports it**. If host cannot keep running or lacks PR/write capability, write a durable `progress-checkpoint.md`-shaped handoff with exact next operation and honestly stop. A Markdown skill alone cannot schedule or spawn continued work.

## Minimal handoff ledger (PR body and existing checkpoint, NOT another tracker)

`Stage ID | OpenSpec change ID | input PR/base/head SHA | artifact blob hashes | output PR/head | verdict (REVIEWABLE/PROVISIONAL/STALE/BLOCKED) | G02 & external permission | actual checks/CI SHA | next stage`.

Progress/acceptance status belongs to **canonical `tasks.md`**, not the handoff note. Reopen the source and PRs on resume; a checkpoint is a pointer, never authority over Git.
