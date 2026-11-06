# ACE — operational AI-assisted SDLC

## Goal and scope
This is a **single-agent, client-independent** development process for the ACE repository. It makes the Research → Design → Plan → Implement method executable through detailed prompts and gates. Full reusable procedures are in [docs/research/sdlc/](../research/sdlc/README.md); use [PROMPTS-ACE.md](../research/sdlc/PROMPTS-ACE.md) as the entrypoint and individual full files, not a five-line substitute.

**Authorities:** for normative behavior, explicit owner instructions > Accepted ADR > applicable OpenSpec > root/nested AGENTS.md. For claims about **what is currently implemented**, current code/tests/retained evidence outrank stale plans and reviews. A current owner-approved governing execution plan still controls the requested task's scope, sequencing, replacement/deletion targets and named-upstream obligations unless it conflicts with a higher authority; it is not proof that its work is already implemented. This procedure never weakens security, source provenance, runtime boundaries, PR delivery or production proof requirements.

## Pick route by risk

| Tier | Trigger | Stages | Required evidence |
|---|---|---|---|
| T0 | simple docs/edit, no runtime/API/policy change | inspect → edit → verify/PR | diff check, relevant CI, exact SHA |
| T1 | contained bugfix with accepted behavior | focused research → minimal design/plan → RED/GREEN → four gates | root cause, regression, source/PR evidence |
| T2 | feature, architecture, persistence, egress/auth, externally observable protocol, concurrency/crash | full Research → Design → Plan → owner choice → slices → four gates → cross-phase E2E | acceptance mapping, decisions, provider evidence and owner review |

One line in an authorization guard can be T2. Do not classify by diff size alone.

## 0. Universal preflight
1. Confirm repository, current branch, base and HEAD SHA.
2. Check dirty worktree; preserve all unrelated files.
3. Read root/nested AGENTS.md.
4. Read relevant accepted ADR/OpenSpec specs and current governing execution plan.
5. Check open PRs/remote branches for work already implemented.
6. Identify input data classification and allowed external resources.
7. Decide T0/T1/T2 and what evidence is required.
8. Confirm current actual code before trusting old unchecked tasks or negative reviews.

### Stop when
An owner decision or denied provider permission is mandatory. Record a blocker; do not silently invent a bypass.

## 1. Research stage
Full procedure: [research_codebase.md](../research/sdlc/source/commands/research_codebase.md).

- Only describe current implementation.
- Read relevant code and actual composition.
- Trace all affected entrypoints and owner boundaries.
- Record source SHA and path:line.
- Separate test doubles from real providers.
- Record open factual gaps and negative searches honestly.
- Durable research memo is an output; no solution proposal is written here.

**Exit:** source-grounded facts sufficient to decide design; else PARTIAL/BLOCKED.

## Additional Quality Gates from the video/Sphericon audit

Read the full [research comparison](../research/sdlc/QUALITY-GATES-VIDEO-SPHERICON-ACE.md), [gate catalog](../research/sdlc/QUALITY-GATES-CATALOG.md), and [detailed adoption plan](../research/sdlc/QUALITY-GATES-IMPLEMENTATION-PLAN.md). The working reviewer checklist is [Quality Gates](../research/sdlc/source/standards/Quality%20Gates.md).

The new **G02 pre-code Design Consistency** check is mandatory for a T2 design: every acceptance criterion must have an owner, accepted decision, interface/state, implementation phase, deterministic oracle and real-provider oracle if needed. In a local T1 defect use a short criterion→invariant→RED/GREEN mapping; for T0 mark N/A. G02 is a *procedure* now, not a new CI command.

Use existing fast ACE commands, then the four separate review passes from implement_backend.md. If a new automated check is not installed, record **PLANNED / NOT-RUN**, never PASS. The catalog distinguishes current scripts from proposed ast-grep rules, offline Markdown links, secret/workflow scanners, Knip, architecture dependency pilot and nightly tools.

**Five execution layers, not five new mandatory tools:**
1. G00/G01: source identity, factual evidence, scope.
2. G02: Design Consistency **before implementation** (T2), plus G15 for material domain behavior.
3. G03–G05: actual fast inner-loop commands/rules/hooks only if present.
4. G06–G10: scoped PR architecture/security/docs/contract/acceptance gates, plus G16 for a new/migrated public contract once its TypeSpec toolchain slice exists (otherwise BLOCKED/NOT-RUN).
5. G11–G14: applicable real providers, nightly, release provenance and final owner review.

Do not run SQL/Ent/Squawk/Schemalens gates for ACE's non-relational stores. Do not add TypeSpec solely because Sphericon uses it. New architecture rules require tested valid and invalid fixtures, exact rule ID, repair hint and observed CI failure before they are called ACTIVE.

## 2. Design stage
Full procedure: [design_feature.md](../research/sdlc/source/commands/design_feature.md) or [design_bugfix.md](../research/sdlc/source/commands/design_bugfix.md).

- Preserve AS-IS/TO-BE distinction.
- Define preconditions, postconditions, invariants, frame conditions and exceptional behavior.
- Use C4 for changed boundaries/ownership; DFD and sequence for multi-step or cross-trust behavior.
- Cover failure paths, idempotency/retry/cancellation, data egress and state recovery.
- Record design alternatives and decision owner.
- Map acceptance to test oracles.
- Add events/persistence/API documents only when relevant.
- Reuse existing OpenSpec design/ADR rather than duplicating an entire docs tree.
- If owner decisions remain, do not continue as though approved.

**Exit:** design with testable behavior and accepted material decisions.

## 3. Plan stage
Use canonical `openspec/changes/<id>/tasks.md` or governing `docs/plans/*.md`. Phase template is [phase-template.md](../research/sdlc/source/templates/phase-template.md).

Each phase describes:
- behavior and acceptance IDs;
- predecessor phases and reusable interfaces;
- new/modified/deleted file paths;
- RED/GREEN test with exact expected outcome;
- negative/error path, provider acceptance and security;
- smallest implementation boundary and reuse of existing libraries;
- build/arch/security/plan gates;
- rollback and an owner decision gate where needed.

**Exit:** a reviewer can reject or accept each phase independently; cross-phase interfaces agree.

## 4. Implement stage
Full procedure: [implement_backend.md](../research/sdlc/source/commands/implement_backend.md). This is a **complete detailed prompt**, not merely a 4-step mnemonic.

- Read complete approved phase and current code again.
- Obtain RED if appropriate; distinguish confirmed repro from hypothesis.
- Implement smallest cohesive slice in TypeScript+Effect or approved boundary.
- Run narrow relevant checks in the edit loop, normally `npm run test:affected`.
- Preserve source identity and trust/security constraints.
- **Gate A BUILD:** actual typecheck/lint/unit/contracts, required provider/test evidence.
- **Gate B ARCH:** ownership, DDD/Effect, real DI, upstream reuse and no shadow paths.
- **Gate C SEC:** input/auth, prompt injection, egress, idempotency, secrets and failure safety.
- **Gate D PLAN:** every accepted requirement maps to changed code and test/proof.
- On FAIL fix current phase, rerun; UNKNOWN is never silently a PASS.
- Self-audits by the same model are not independent reviews.
- Once the coherent slice is ready, run `npm run verify:pr` once and push focused commit/PR per AGENTS.md.

## 5. Final integration / release evidence
- Read all phases and entire PR diff against merge base.
- Check cross-phase errors, DTO/schema, DI and public API consistency.
- Check orphan code and superseded paths were deleted.
- Check retry multiplicity, crash/recovery, authorization and cross-provider fallbacks.
- Run capability-scoped real E2E when claiming it; mocks alone do not suffice.
- Preserve benchmark raw trials and exact provider identities for token/cost claims.
- Bind every evidence claim to the exact commit tested.
- Human owner decides merge and production acceptance independently.

## Context checkpoint
Use [progress-checkpoint.md](../research/sdlc/source/templates/progress-checkpoint.md) at phase boundaries and before compaction. Do not rely on Claude-specific context APIs. Save exact HEAD/PR, plan/phase, accepted decisions, commands and outcomes, blockers, next operation. On resume re-inspect remote state and current source.

## Report and verdict
Accepted statuses: PASS, FAIL, NOT-RUN, UNKNOWN, NOT-APPLICABLE. Distinguish “command not available” from “command passed.”

```markdown
# SDLC evidence: <feature/phase>
Source HEAD:
PR/base:
Tier:
Canonical design / plan:
Research observations (path:line):
Owner decisions:
Files changed:
RED and GREEN:
| Gate | Status | Exact command/paths | Findings |
| BUILD | | | |
| ARCH | | | |
| SEC | | | |
| PLAN | | | |
Real provider E2E:
CI at HEAD:
Risks / test limitations:
Next unblocked phase:
```

## Invocation

Ask any coding agent:

> Follow `docs/operations/ai-assisted-sdlc.md` and the full stage command from `docs/research/sdlc/PROMPTS-ACE.md`. Keep one agent, and preserve existing ACE authority, tests, PR discipline and the four detailed quality gates.

## Functional DDD and TypeSpec contract-first (owner-selected, 2026-11-05)

For a material domain change, the Design stage must include **Event Storming** (commands, meaningful domain events, policies, hot spots, bounded contexts and ownership), an immutable state/command/error ADT and pure transition/invariant functions. The **Effect shell** owns I/O, cancellation, authorization at send time, persistence CAS/retries and provider composition. Aggregate ≠ OO class, bounded context ≠ microservice, Event Storming ≠ mandatory Event Sourcing.

For every new or migrated public machine contract, **TypeSpec is the canonical wire-contract source** and OpenSpec owns behavioral acceptance. Use [functional policy](../research/sdlc/ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md), [TypeSpec generated integration coverage](../research/sdlc/TYPESPEC-CODEGEN-COVERAGE.md) and [codegen skill](../../.agents/skills/ace-typespec-codegen/SKILL.md). Gradually generate SDK and server interfaces, runtime validators, mechanical DTO mappers, access metadata, fixtures and docs where selected maintained generators support them. Verify source→generated output clean, mapping exhaustiveness and actual authorization; do not generate business decisions.

**Matt's skills have been evaluated and selected, but their original files are not yet committed to ACE**; see [source/pinned import plan](../research/sdlc/MATT-POCOCK-SKILLS.md). Their prompts are optional helpers subordinate to AGENTS/ADR/OpenSpec. Use `domain-modeling`, `to-tickets`, `tdd` and `code-review` where relevant, never bypassing single-agent restrictions or creating another issue/spec owner.

## Dev/test service orchestration decision

Do **not** add `mise daemons` to ACE. For reusable integration services use the existing local **k3s** path and capability-specific namespaces/resources; for deterministic lightweight dependencies use in-process fake servers/ports. Pure domain/ADT/DbC tests run without infrastructure. This keeps one orchestration plane and aligns integration evidence with ACE's deployment target.
