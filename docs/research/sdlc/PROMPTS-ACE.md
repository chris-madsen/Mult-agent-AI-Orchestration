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

## Entrypoint Q — select and execute Quality Gates

```text
Read the complete docs/research/sdlc/QUALITY-GATES-CATALOG.md and
source/standards/Quality Gates.md. Inspect the actual current ACE
package.json, CI and AGENTS.md at HEAD rather than trusting a plan.
Classify the current change (T0/T1/T2) and select applicable gate IDs.

BEFORE T2 implementation apply G02 Design Consistency: trace each
acceptance criterion to its owner, contract, approved decision, phase,
test oracle and required real-provider evidence. Stop for unresolved
material decisions. During development use the existing ACE scripts
and any ACTUALLY INSTALLED scoped static rules. In the PR stage
perform separate BUILD, ARCH, SECURITY and PLAN passes, and check
link/secret/dependency/contract categories only if applicable.

For every selected gate report exact version/command/SHA, actual
PASS/FAIL/UNKNOWN/NOT-RUN/N/A, and supporting artifacts. A proposed
tool is never counted as a completed check. If a required gate fails,
repair and rerun on the changed SHA. Never claim that one-agent
self-review is independent validation.
```

See [QUALITY-GATES-IMPLEMENTATION-PLAN.md](QUALITY-GATES-IMPLEMENTATION-PLAN.md) for tools not yet installed and the rollout PR order.

## Entrypoint Q-Author — create a new architecture rule

```text
Before adding a custom scanner, read accepted ADR/OpenSpec and
source/standards/Quality Gates.md. Choose ONE verifiable invariant
and the simplest mature tool suitable for its syntax/type semantics.
Write a valid fixture, violating fixture and false-positive fixture.
Demonstrate RED (detector catches violation) then GREEN (allowed code
not flagged); label all rules with ID and concrete fix. Scope changed
paths, generated-code exclusions and baseline policy. Measure
false positives, runtime and CI resource cost. Only after CI runs
on a real PR head can the rule be marked ACTIVE.
```

## Selected design defaults: Event Storming, functional DDD, TypeSpec

**Current owner decision:** For material T2 domain work, begin with Event Storming. Name bounded contexts, commands, facts, policies, hot spots and actual consistency boundaries; implement **readonly ADTs and pure domain functions**, with Effect orchestrating I/O. Do not generate rich mutable OO entities or scatter invariants into controllers. Read [functional DDD policy](ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md) and [Functional Domain Modeling](source/standards/Functional%20Domain%20Modeling.md).

For public machine contracts **TypeSpec is chosen**, not a conditional pilot. Read [codegen coverage](TYPESPEC-CODEGEN-COVERAGE.md) and [TypeSpec Contract First](source/standards/TypeSpec%20Contract%20First.md). Use [ACE TypeSpec Codegen Skill](../../../.agents/skills/ace-typespec-codegen/SKILL.md) for generated API scaffolding, SDK, validators, mechanical mapping, permissions metadata and drift/compatibility. TypeSpec alone does not generate business decisions.

## Imported Matt Pocock skills — actual files, not paraphrases

Read [import manifest and project override](MATT-POCOCK-SKILLS.md). The original pinned skill files are in `.agents/skills/`, MIT-licensed. Suggested auxiliary read:
- Design and ubiquitous language: `domain-modeling`, `grill-with-docs`, `codebase-design`.
- Work decomposition: `to-spec`, `to-tickets`; **map to existing OpenSpec**.
- Implement: `tdd`, `diagnosing-bugs`, `code-review`.
- Completion: `pr`, `handoff`, `writing-for-agents`.

Do NOT silently invoke the upstream `implement-spec` multi-agent/subagent procedure or `setup-matt-pocock-skills` repository reset. Use ACE's own single-agent stage commands and project authority. Matt skills supply techniques, not a second agent runner or a replacement for TypeSpec/OpenSpec.
