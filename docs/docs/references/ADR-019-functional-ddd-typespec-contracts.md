# ADR-019 — Functional DDD and TypeSpec-first public contracts

**Статус:** Accepted  
**Дата:** 2026-11-05  
**Проект:** Adaptive Context Engine (ACE)  
**Связанные ADR:** ADR-014 (Hybrid Context Engine), ADR-016 (Hermes ContextEngine), ADR-017 `ADR-017-ace-bifrost-gateway-protocol.md` (ACE LLM Gateway Protocol v1 over Bifrost)  
**Источник решения:** explicit project-owner decision recorded during the SDLC/architecture review on 2026-11-05.

## Контекст и проблема

ACE needs durable rules for two related concerns that were previously scattered across design notes:

1. how material domain behavior is modeled in the TypeScript + Effect modular monolith;
2. which source owns new and migrated public/versioned machine-wire contracts.

Without one accepted decision, agents can alternate between rich mutable OO models and functional domain modules, or maintain competing handwritten MCP/HTTP/native JSON schemas after TypeSpec adoption.

## Драйверы решения

- Preserve ACE as one TypeScript + Effect modular monolith rather than a service per bounded context.
- Keep business invariants testable without provider I/O.
- Keep OpenSpec behavioral acceptance, ADR rationale and wire-schema ownership distinct.
- Eliminate duplicate handwritten protocol-schema owners during staged migration.
- Preserve official SDK transports, especially the maintained MCP TypeScript SDK.
- Prefer maintained generators and upstream tooling over custom emitters.
- Avoid big-bang rewrites of working contracts.

## Рассмотренные варианты

1. **Rich OO DDD by default.** Rejected as a mandatory implementation style; aggregate consistency does not require mutable classes.
2. **Functional DDD with readonly ADTs and pure domain functions.** Accepted as the default modeling style.
3. **Continue handwritten public schemas per adapter.** Rejected for new/migrated public contracts because it creates competing wire authorities.
4. **TypeSpec-first public wire contracts with staged generated integration.** Accepted.
5. **Generate domain behavior from wire contracts.** Rejected; business decisions remain handwritten domain logic.
6. **Custom generators by default.** Rejected; official/maintained compiler, emitters and generators are evaluated first.

## Решение

### Domain modeling

For material T2 domain changes, start design with Event Storming to identify commands, meaningful facts/events, policies, hot spots, bounded contexts and consistency boundaries.

The default implementation is:

- immutable/read-only domain data and discriminated ADTs;
- cohesive pure functions that own invariants and state transitions;
- Effect in the application shell for I/O, authorization, cancellation, concurrency, persistence coordination and provider composition;
- explicit runtime validation for untrusted wire/persisted input.

An aggregate is a consistency boundary, not a requirement for a mutable OO root object. Event Storming does not imply Event Sourcing, an event bus or one microservice per bounded context.

Canonical functional rule IDs are FP-01..FP-12 in `docs/research/sdlc/source/standards/Functional Domain Modeling.md`.

### Public wire contracts

TypeSpec is the selected canonical source language for **new and migrated public/versioned ACE machine contracts**, beginning with Gateway Projection HTTP and extending to representable MCP/native JSON shapes.

Authority is separated:

- OpenSpec: required behavior and acceptance;
- ADRs: architectural rationale and durable decisions;
- TypeSpec: migrated public wire operations, DTOs, errors and constraints;
- domain ADTs/pure functions: business invariants.

Existing accepted runtime contracts remain the compatibility baseline until a surface's TypeSpec toolchain is installed, pinned, reproducible and parity-tested. An uncompiled `.tsp` file is not allowed to displace a working schema merely by existing.

Use official/maintained emitters and downstream generators first. A custom emitter/checker requires an evidenced upstream gap, the smallest possible scope and explicit owner-approved rationale. TypeSpec must not replace the official MCP transport or become the only authorization boundary.

Canonical generated-integration rule IDs are TSP-01..TSP-08 in `docs/research/sdlc/TYPESPEC-CODEGEN-COVERAGE.md`.

## Компромиссы и последствия

Benefits:

- one durable modeling policy without forcing OO ceremony;
- one migration target for public wire shapes;
- clearer ownership between behavior, wire schema and runtime enforcement;
- generated mechanical boilerplate can replace duplicated schema/DTO glue;
- contract migration can be incremental and compatibility-tested.

Costs:

- TypeSpec compiler/emitter/generator tooling must be selected, pinned and maintained;
- existing public schemas need explicit baseline/parity work before ownership transfers;
- some protocol features may need a narrow adapter when TypeSpec cannot represent them faithfully;
- Event Storming adds design work for material T2 changes.

## Безопасность / локальность / лицензии

- TypeSpec annotations or generated permission metadata never replace send-time authorization.
- Private code/data egress remains governed by existing ACE policy ADRs.
- Official SDK transports remain authoritative where selected.
- Generator and skill dependencies require pinned versions, license review and reproducible provenance.
- No custom protocol transport or generator is justified solely by convenience.

## Критерии проверки

- Material T2 domain design records applicable G15/FP evidence.
- New/migrated public contract work records G16/TSP-01..08 evidence or an explicit BLOCKED/DEFERRED state while toolchain work is absent.
- Existing wire fixtures are captured before migration and compared against generated output.
- Unknown fields/variants and unmapped DTO fields fail closed.
- Authorization negative tests remain independent of generated metadata.
- Real MCP/Hermes/Bifrost/provider evidence remains distinct from schema/codegen tests.
- Superseded handwritten schema authority is removed only after compatibility proof.

## Условия пересмотра

Revisit if:

- TypeSpec cannot faithfully represent a required ACE public protocol despite a narrow maintained adapter;
- a maintained alternative provides materially stronger generation/validation with lower ownership cost;
- the TypeScript + Effect modular-monolith decision changes;
- measured experience shows the functional modeling default materially harms correctness or maintainability.

## Источники

- `docs/research/sdlc/ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md`
- `docs/research/sdlc/TYPESPEC-CODEGEN-COVERAGE.md`
- `docs/research/sdlc/source/standards/Functional Domain Modeling.md`
- `docs/research/sdlc/source/standards/TypeSpec Contract First.md`
- root `AGENTS.md`
