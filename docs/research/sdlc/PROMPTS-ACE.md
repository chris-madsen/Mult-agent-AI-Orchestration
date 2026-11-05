# ACE — prompt entrypoints for any coding agent

These are **entrypoints into full instruction files**, not five short substitutes for those files. Run with Codex, Claude Code, OpenCode, Gemini CLI, Cursor, Hermes or another agent that can read Markdown and edit a repository. No model-specific tool names are required.

## How to activate

1. Read repository root `AGENTS.md` and relevant nested policy.
2. Read `docs/operations/ai-assisted-sdlc.md` to classify T0/T1/T2 and determine the current stage.
3. Open the matching **complete command file** below. Follow its entire process and output contract, not only its heading.
4. Read only relevant standards under `source/standards/` and project-specific accepted ADR/OpenSpec.
5. Use existing OpenSpec/change/plan artifacts to record implementation, not a new duplicate spec.
6. Execute tests and report exact output rather than claiming hypothetical PASS.
7. If context is shrinking, save the detailed checkpoint template, then re-read files on resume.

## Canonical prompt modules

| User intent | Full command file | Read-only supporting procedure |
|---|---|---|
| Understand existing ACE code | `source/commands/research_codebase.md` | `source/agents/codebase-researcher.md` |
| Design a feature | `source/commands/design_feature.md` | architect/blast-radius procedures |
| Plan a change | `docs/operations/ai-assisted-sdlc.md` + approved OpenSpec tasks | phase template |
| Implement approved backend / ACE change | `source/commands/implement_backend.md` | standards applicable to changed layer |
| Investigate a defect | `source/agents/bug-tracer.md` + researcher | blast-radius analyzer |
| Design a backend correction | `source/commands/design_bugfix.md` | architect-reviewer |
| Fix a backend defect | `source/commands/fix_backend_bug.md` | implement_backend four gates |
| Design UI feature (actual frontend only) | `source/commands/design_frontend_feature.md` | architect/blast procedures |
| Implement UI feature | `source/commands/implement_frontend.md` | project UI testing rules |
| Fix frontend defect | `source/commands/fix_frontend_bug.md` | bug-tracer |
| Resume context | `source/templates/progress-checkpoint.md` | read current worktree again |
| Final verification | implement_backend final cross-phase | docs/operations/testing-strategy.md |

## Entrypoint R — fact-only research

```text
Task: research the following implementation question in ACE: <question>.
Use this repository's AGENTS.md and accepted OpenSpec/ADR as authority.
READ docs/research/sdlc/source/commands/research_codebase.md completely,
plus source/agents/codebase-researcher.md. Apply every listed evidence and
scope constraint. Begin with the actual runtime entrypoint and follow wiring,
not only symbol search. Read directly implicated files in full relevant context.
Make no design proposal or code change in this phase.

Record current branch and exact SHA. Investigate no more than four coherent
areas sequentially, with paths, dependency/dataflow, typed error paths,
and provider/mock distinctions. Write a durable fact-only report using
source/templates/research-output.md at the existing research location.
Finish with code references, open factual questions, source SHA and report path.
```

### Success conditions
- Factual statements tied to exact current code or observed runtime.
- No architectural proposal or recommendations mixed into research.
- Tested vs not-tested and simulated vs real clearly distinguished.
- Missing evidence, source drift and unknown runtime choices reported.

## Entrypoint D — feature design

```text
Design the following requested behavior in ACE: <goal>.
First read AGENTS.md, relevant approved ADRs/OpenSpec and current code.
Then READ the entire source/commands/design_feature.md. Use the required
decision about whether additional research is necessary. Reuse a current
verified research report or run the Research protocol above.

Produce appropriate C4, DFD, sequence, decisions and testing mapping;
explicitly consider events, persistence mapping, feature standards and
API/MCP/projection contracts, marking genuinely irrelevant ones N/A.
Separate observed AS-IS from proposed TO-BE. Show side effects, cancellation,
partial failures, egress authorization, versioning and negative tests.
Use existing OpenSpec design/specs, not a second parallel document tree.
List all material owner decisions, alternatives and evidence needed.
Do not implement code.
```

### Success conditions
- No change to accepted architecture without owner decision.
- Every acceptance criterion has design owner and test oracle.
- Error and trust-boundary sequences are included where needed.
- Required actual runtime wiring is planned, not assumed completed.

## Entrypoint P — implementation plan

```text
Given approved design and requirements for <task>, prepare an executable,
dependency-ordered implementation plan. Read the complete design,
the repo root AGENTS.md and source/templates/phase-template.md. Inspect
current code and open PRs before claiming any planned work is still missing.
Use existing openspec/changes/<id>/tasks.md or the named governing plan.

Every slice must specify: goal, dependency, exact create/modify/delete paths,
invariants and frame conditions, acceptance IDs, deterministic RED/GREEN test,
negative and real-provider checks, command/expected result, rollback,
review gates, and stop-for-owner-decision conditions.
Prefer small coherent independently reviewable changes and removal of
superseded paths. Produce a cross-slice dependency/compatibility check.
Do not implement until material decisions are approved.
```

### Success conditions
- No "write tests" without a specific behavior and oracle.
- No placeholder implementations or tests assumed to exist.
- Every requirement maps to an implementation step and verification.
- Exact providers/credentials/expensive tests identified as needed/not-run.

## Entrypoint I — implement one phase

```text
Read root AGENTS.md, the entire approved plan/design and the FULL
source/commands/implement_backend.md file. Implement only phase <ID>,
after checking current branch/HEAD, active PRs, dependencies, current
code and actual required test owner. Use ACE TypeScript + Effect rules,
and only relevant standards from source/standards/.

First get a deterministic RED regression when practical. Make the smallest
coherent change, run GREEN and affected tests. Then execute FOUR separate
review passes defined in implement_backend.md:
A build/tests/lint, B architecture, C security/trust/reliability,
D plan/acceptance completeness. For each, read the changed files, record
actual evidence and findings. FAIL returns to repair; UNKNOWN is not PASS.
One agent performs these sequentially; never claim independent reviewers.
Commit, push, verify open PR/head and actual checks at exact SHA.
Do not merge or claim production readiness without owner approval.
```

### Success conditions
- One approved phase, not a speculative unrelated refactor.
- Test results observed, not generated by the model.
- Four review verdicts with evidence and explicit omissions.
- Correct repo PR process and source SHA verified.

## Entrypoint B — backend bugfix

```text
The observable bug is: <symptom>.
Read all of source/commands/fix_backend_bug.md and the relevant
bug-tracer / blast-radius-analyzer instructions. First reproduce it and
identify the earliest broken invariant with path:line. If reproduction is
unavailable, mark STATIC-UNCONFIRMED. Trace callers and persistence impact.
Use source/commands/design_bugfix.md for the minimal fix design. Obtain
a RED regression, implement the smallest approved correction, verify GREEN.
Run all four backend quality gates, then real-provider checks when needed.
Record manual QA using source/templates/manual-qa.md. Create a focused PR.
```

## Entrypoint V — final cross-phase validation

```text
Read source/commands/implement_backend.md's Final Cross-Phase Review.
Re-open the current PR diff and verify its exact HEAD. Check ALL in-scope
phases and acceptance IDs against actual code, tests and provider wiring.
Examine API/error consistency, duplicate or dead code, restart/idempotency,
source freshness, data egress, security and rollback.
Run appropriate smoke/integration checks where available.
Use source/templates/phase-template.md and project testing strategy
to report pass/fail/not-run/unknown with command and artifact.
No unverified quality, cost, token saving or production-ready claims.
Return remaining findings and owner decisions.
```

## Entrypoint C — context handoff

```text
Before a context compaction, session switch or agent handoff, read
source/templates/progress-checkpoint.md and fill it with actual branch,
full HEAD SHA, PR, canonical plan/task IDs, completed changes, exact
test runs, four gate states, known blockers, uncommitted unrelated edits,
open owner decisions and next single executable operation.
Save the checkpoint to an approved existing plan/evidence location.
On resume inspect Git and current code, then compare against checkpoint.
A stale summary never overrides the actual working tree.
```

## Operating rules for every entrypoint

- A prompt does not itself grant tool permission or change project authority.
- A stage can return BLOCKED rather than invent an answer.
- A quick mechanical task should use T0 instead of generating unnecessary eight-document design.
- A T2 change requires deeper design and approval, not a bigger model prompt.
- The research stage must not silently become an implementation stage.
- A failed security gate is not offset by passing lint.
- Human approval is distinct from an agent's self-review.
- Real-provider tests and benchmark acceptance are separate from unit mocks.
- Preserve source, privacy and historical evidence.
- All resulting documents use consistent paths and current SHA.
