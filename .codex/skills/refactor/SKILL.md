---
name: refactor
description: Refactor an existing codebase to a functional-core/imperative-shell style with explicit ADTs, freeze/ingest boundaries, ports (Reader-style DI), event-style logging, and stable Makefile entrypoints. Use this when the user asks to refactor code “by rules”, introduce ADTs/Result types, remove unsafe fallbacks, flatten control flow via dispatch/strategies, or set up a repeatable refactor workflow.
---

# Refactor (Rules-Driven)

## Overview

This skill is a workflow for refactoring **any** codebase to a style that is:
- declarative / functional-first,
- explicit about domain data (ADTs),
- safe-by-design (fail closed),
- testable (pure core + thin integration),
- readable (flat code, composition over control flow),
- repeatable (Makefile as the public interface).

The detailed, project-agnostic rules live in `references/rules.md`.

## Workflow Decision Tree

1) **Is this a multi-module / long-lived project?**
   - Yes → start with **DDD model pass** (bounded contexts, aggregates, value objects).
   - No (tiny script) → use **command pipeline / fluent main**.

2) **Where is the I/O?**
   - Identify boundaries: HTTP/RPC, DB, filesystem, time, randomness, subprocess.
   - Everything else becomes the **functional core**.

3) **Where is the instability?**
   - Extract strategy/dispatch maps or protocols/traits at those seams.
   - Avoid inheritance trees; prefer polymorphism + composition.

## Step-by-step Refactor Procedure

### Step 1 — Inventory (15–30 min)
- List entrypoints (CLI/server/job runner).
- List side effects (I/O).
- List current “domain nouns” and invariants.
- Decide if we need a DDD “model first” pass.

### Step 2 — Define the Domain ADTs
- Introduce product types (records) and sum types (`Ok|Err`, `State` variants, etc).
- Define a single `DomainError` shape (`code/path/message`).

### Step 3 — Freeze Boundaries (`ingest_*`)
- Add boundary functions that:
  - validate + normalize,
  - canonicalize,
  - produce immutable ADTs,
  - return `Result` (errors as data).
- After `ingest_*`, no “mutate dict as we go”. Update via new values.

### Step 4 — Ports (Reader-Style DI)
- Replace direct calls to time/uuid/http/db with injected `ports`.
- Core becomes pure: `Core(input_adt) -> (new_state, events)`.

### Step 5 — Events & Replayability
- Prefer structured event logs (JSONL is fine).
- Distinguish **observation timebase** vs **wall clock** explicitly.
- Keep logs append-only.

### Step 6 — Flatten Control Flow
- Replace `if/switch`-heavy branching with:
  - dispatch maps,
  - strategies,
  - FSM tables when state+event explodes.
- Prefer “compute result” over “control the process”.

### Step 7 — Tests (Fast First)
- Add unit tests for:
  - `ingest_*` boundaries,
  - deterministic transforms,
  - baseline vs improved algorithm when relevant.
- Keep integration tests thin and explicit.

### Step 8 — Makefile Public Interface
- Ensure common actions are one command (`make test`, `make fmt`, `make run`, `make deploy`).
- Keep `make help` truthful.
- Targets are idempotent and safe to re-run.

## What to Load

- Read `references/rules.md` when you need the full ruleset or examples.

