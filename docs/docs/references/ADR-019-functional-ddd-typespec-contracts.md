# ADR-019 — Functional DDD and TypeSpec-first public contracts

**Статус:** Accepted  
**Дата:** 2026-11-05  
**Проект:** Adaptive Context Engine (ACE)  
**Связанные ADR:** ADR-014, ADR-016, ADR-017  
**Источник решения:** explicit project-owner decision recorded during the SDLC/architecture review on 2026-11-05.

## Контекст и проблема

PR #222 records two durable owner-selected architecture choices that already appear in the repository guidance:

1. material domain design uses Event Storming with a functional DDD implementation style;
2. TypeSpec is the selected source language for new and migrated public/versioned ACE machine-wire contracts.

Root `AGENTS.md` requires durable architecture decisions to live in ADRs, so this ADR records those existing choices. **It does not add or change an SDLC stage, gate, rollout sequence, migration deadline or implementation requirement.**

## Решение

### Functional DDD

For substantive domain design, use Event Storming to identify commands, meaningful facts/events, policies, hot spots, bounded contexts and consistency boundaries.

Implementation remains functional:

- immutable/read-only ADTs and data;
- cohesive pure domain functions for invariants and transitions;
- Effect for application orchestration, I/O, cancellation, authorization and resource ownership.

An aggregate is a consistency boundary, not a mandatory mutable OO class or microservice. Event Storming does not imply Event Sourcing.

### TypeSpec

TypeSpec is the selected source language for new and migrated public/versioned ACE wire contracts, including the Gateway Projection API and applicable MCP/native JSON messages.

OpenSpec remains behavioral requirements/acceptance authority. ADRs record architectural rationale. The TypeSpec toolchain and generated artifacts are not made installed or active by this document.

All staged rollout, quality-gate and implementation semantics remain exactly as defined by the SDLC documents in PR #222.

## Последствия

- The existing PR #222 architecture guidance now has a durable ADR record.
- Existing runtime behavior and existing SDLC gate/stage semantics are unchanged.
- No new CI command, gate, provider proof or rollout phase is introduced by ADR-019.

## Безопасность / локальность / лицензии

Existing ACE security, egress, provider, SDK, provenance and upstream-reuse rules continue unchanged.

## Критерии проверки

- `AGENTS.md` and the architecture policy point to ADR-019 as the durable decision record.
- The original PR #222 SDLC flow and gate meanings remain unchanged.
- TypeSpec tooling remains staged/not installed where the original PR says so.

## Условия пересмотра

Revisit through an owner-reviewed ADR if the selected modeling style or public-contract source language changes.

## Источники

- `AGENTS.md`
- `docs/research/sdlc/ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md`
- `docs/research/sdlc/TYPESPEC-CODEGEN-COVERAGE.md`
