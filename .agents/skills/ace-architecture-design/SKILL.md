---
name: ace-architecture-design
description: Design or revise ACE features by integrating with existing bounded contexts using Event Storming, functional DDD, immutable ADTs/FSM, Effect, TypeSpec and Meyer contracts before implementation planning.
---

# ACE Architecture Design — integrate, do not reinvent

**Stage:** Architecture (T1 focused, T2 mandatory). This is a one-agent planning skill. It makes architecture **before** implementation task decomposition and does **not** edit product code, approve G02, call providers, merge PRs or replace ACE's accepted architecture.

## Read first

1. Read root/scoped `AGENTS.md`, accepted ADRs, relevant current OpenSpec `proposal.md` + `specs/**/spec.md`, `docs/research/sdlc/ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md`, `docs/docs/architecture/07-architecture-fitness-contracts.md`, `docs/research/sdlc/source/commands/design_feature.md` and `docs/operations/ai-assisted-sdlc.md`. Inspect the actual current SHA, runtime composition, owner tests and upstream/provider native capabilities. Read existing `design.md` as a *candidate*, not proof of current code.
2. Read the complete vendored `.agents/skills/domain-modeling/SKILL.md` and pinned `.agents/skills/codebase-design/SKILL.md` with `DEEPENING.md` and the ACE compatibility overlay. Use their **domain vocabulary/deep-module seam techniques**, not their default glossary/ADR locations or parallel-subagent patterns. Use one agent to compare competing designs sequentially. If any skill is unavailable, report it; do not claim invocation.
3. Identify **what already exists and is reused** (exact bounded context/module, interface, pure function, adapter, layer, provider and accepted contract). Give a justified *minimal architecture delta*. Prefer preserving current modules and tightening an existing seam to inventing a new module/port. Check maintained upstream actual APIs before custom code. Mark historical/retired delivery paths non-targets.

## Mandatory architecture output (in canonical OpenSpec design.md)

Use observed AS-IS versus proposed TO-BE with path:line and source SHA. For each relevant acceptance ID provide:

- **Event Storming:** actor, command, meaningful domain event (not automatic event bus), policy, hot spot, external-system interaction and consistency boundary. For a focused T1 change, state why an abbreviated analysis suffices; for T2 model material domain behavior. Include changed bounded contexts and their actual existing context-map relations.
- **Functional domain ownership:** immutable `State | Command | DomainError` and `Event` only where meaningful; pure `decide/transition/evolve` signatures with typed outcomes. Keep rules *inside cohesive domain-function modules* — no anemic god services, mandatory OO aggregate classes or scattered flags in HTTP adapters. Aggregate = actual atomicity/consistency boundary.
- **FSM only when needed:** identify states, legal/illegal transitions, guards, event/side-effect ordering, retry, replay, cancellation, crash/restart and idempotency. Explain N/A for stateless behavior; never create an FSM framework by default. Persisted state needs CAS/transaction/fencing where actually required.
- **Effects and interfaces:** define pure→Effect application→adapters→provider layering, dependency ownership and actual runtime construction; secrets/egress authorization at real send time; typed errors and resource/cancellation semantics. Demonstrate upstream/native reuse and identify superseded code to remove, or none.
- **TypeSpec:** when public/versioned wire changes, reference selected TypeSpec source and generated mappings, runtime validation, negative/roundtrip/backcompat tests. If no public contract changes, explicitly N/A — never add duplicate DTO authority.
- **Meyer DbC:** for each significant accepted behavior specify require/precondition, ensure/postcondition, invariant, frame condition and exceptional/rescue postcondition; independent positive/negative test oracles at the *cheapest actual owning seam*, plus unique provider/agent/Harbor E2E where needed. Define evidence limitations: mock ≠ real final wire ≠ agent E2E ≠ production.
- **Decision record:** list alternatives, why reuse/deepening beats new construction, actual impacted file/interface owners, rollout/rollback, risks and accepted ADR compatibility. A material contradictory change gets a **proposed** ADR and `Owner decision: BLOCKED` until decided, not a silent overwrite.
- **G02 crosswalk:** exact `AC | Owner | Decision | Interface/state | Phase | Deterministic oracle | Provider/agent oracle` for all IDs; phase is a provisional implementation responsibility, **not** a prematurely committed ticket-count or LOC promise. Owner signoff is a separate observed decision; self-review cannot grant it.

## Completion gate

1. Walk every AC through real runtime wiring, invariant, error path, owning test and rollback. Reject invented module owners, hidden new transports, duplicate stores/schema authority, incomplete plugin hooks and inconsistent decisions.
2. Record `READY_FOR_G02_REVIEW`, `NEEDS_RESEARCH` or `NEEDS_OWNER_DECISION`. The first means design evidence appears reviewable, **not** G02 PASS. T2 implementation remains closed without explicit owner design approval and separate egress approval as needed.
3. Open a focused **architecture PR** under `ace-stage-handoff`. Its body identifies exact inherited Requirements PR/commit and records that subsequent planning may be provisional. Never wait for merge merely to prepare a dependent Plan; never bypass a blocked material decision.
4. **Do not call `ace-to-tickets` until the architecture document is complete and self-checked**. Later owner changes trigger targeted design re-review before downstream plans can be accepted.
