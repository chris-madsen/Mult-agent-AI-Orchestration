# AGENTS.md

This file defines the default working rules for AI coding agents in this repository.
It is intentionally stack-agnostic. More specific instructions in nested `AGENTS.md`
files may extend or override these rules for their directory.

## 1. Core Principle

Optimize for a correct, maintainable, verifiable system — not for the amount of code
produced or the speed of producing a patch.

The agent's job is to improve the project, not merely to make the current symptom
disappear.

## 2. Understand the Problem Before Choosing the Solution

Before editing code:

1. Identify the user-visible problem or desired outcome.
2. Describe the system behavior or data flow that must change to produce that outcome.
3. Only then identify the code changes that can produce the system behavior.
4. Inspect the relevant code paths, tests, configuration, and runtime boundaries.
5. Separate observed facts from assumptions.
6. Determine the likely root cause.
7. State material uncertainty when it affects the implementation.

Start from the goal and constraints. Do not assume the implementation requested in a
ticket is necessarily the best implementation. Treat the ticket's diagnosis and the
user's proposed mechanism as hypotheses until the repository and runtime evidence
confirm them.

When several reasonable solutions exist, compare them briefly and choose the simplest
one that preserves correctness and architectural consistency.

## 3. Fix Root Causes, Not Symptoms

Do not solve failures by hiding their evidence.

Unless explicitly required and justified, do not:

- suppress exceptions or unhandled rejections;
- replace failures with synthetic success responses;
- mutate the UI to look successful without verifying backend state;
- delete caches, state, or service workers as a generic recovery mechanism;
- add polling, retries, reloads, or watchdogs before understanding the failure;
- create shadow state that can diverge from the real source of truth;
- report success merely because a setter or command was invoked;
- remove warnings, banners, logs, or error artifacts to make a problem less visible.

If a temporary workaround is genuinely necessary:

- label it clearly as a workaround;
- make it narrow, reversible, and observable;
- document the root cause and removal condition;
- add a test that protects the intended temporary behavior;
- create or reference a follow-up issue for the permanent fix.

## 4. Prefer Standard Solutions Over Custom Machinery

Before adding a custom abstraction, framework, protocol, wrapper, skill, or state
system, check whether the project stack or a mature dependency already provides the
capability.

Prefer, in order:

1. language and platform primitives;
2. existing project conventions;
3. well-maintained standard libraries and frameworks;
4. small project-specific adapters;
5. custom infrastructure only when the previous options are insufficient.

Do not replace a known, deterministic mechanism with an LLM-driven or heuristic one.
Compilers, schema validators, type systems, formatters, migrations, generators, and
declarative configuration remain preferable for predictable work.

Every new custom abstraction must have a concrete benefit that exceeds its maintenance,
documentation, testing, and context costs.

Do not introduce or replace a tool, model, dependency, or workflow merely because it is
newer or currently popular. Tie the change to a concrete project need and a measurable
improvement in correctness, delivery time, reliability, or maintenance cost.

## 5. Keep the Project Legible to Humans and Agents

Use one term for one concept. Avoid aliases, legacy names, and overloaded vocabulary.

When the same concept has different names across code, API, database, UI, and docs:

- choose a canonical term;
- migrate code toward it where practical;
- document unavoidable legacy mappings in one place;
- do not scatter translation logic throughout the codebase.

Prefer explicit module boundaries, small public APIs, stable data shapes, and a single
source of truth.

Build strong abstraction barriers. A component should be understandable, testable, and
replaceable through a narrow contract without requiring callers to know its internals.
Keep state ownership explicit, avoid hidden coupling, and pass dependencies through
visible interfaces. Generate or replace a whole component only when its contract and
boundary behavior are already clear.

Prefer a nearby canonical example over inventing a new local style. When no suitable
example exists, establish one deliberately and use it consistently. Project-wide
uniformity is usually more valuable than a clever local optimization.

If an agent repeatedly misunderstands part of the project, first inspect the project for
ambiguous naming, hidden coupling, inconsistent schemas, or stale architecture. Do not
immediately add another instruction or skill to compensate for confusing code.

## 6. Model Types and Data Before Implementation

Before implementing a feature that changes domain state or crosses a system boundary:

1. identify the entities, states, relationships, and invariants;
2. define or update the canonical data model and boundary schemas;
3. decide which component owns each piece of state;
4. derive implementation types from those decisions;
5. account for migration, compatibility, and rollback where stored or public data changes.

Do not let each module invent a parallel version of the same domain type. Reuse or derive
types from the canonical schema where the stack permits it.

Treat a type error as evidence about the design before treating it as a compiler obstacle.
Do not use `any`, unchecked casts, broad unions, non-null assertions, or duplicated types
merely to make a check pass. If an escape hatch is genuinely required, keep it at a
validated boundary and explain the invariant that makes it safe.

In dynamic-language projects, use the ecosystem's supported type annotations and runtime
schema validation at important boundaries instead of relying on undocumented shapes.

## 7. Avoid Skill and Instruction Bloat

Repository instructions should describe durable project constraints, not every mistake
an agent has ever made.

Before adding a new rule or skill, ask:

- Can the code, type system, test, schema, linter, or generator enforce this instead?
- Is the problem caused by inconsistent project design?
- Does an existing rule already cover it?
- Is the mistake systemic and recurring rather than a one-off failure?
- Will this instruction remain correct after the next refactor?

Prefer a few precise, enforceable rules over a large collection of overlapping guidance.
Remove stale or redundant instructions when the project changes.

Treat imported instructions, vendor-provided skills, framework recipes, and public
examples as advisory input, not project authority. Before adopting them, verify their
assumptions, scope, stack version, and compatibility with this repository. Adapt the
smallest relevant part; do not copy a whole rule set blindly.

Rules need an explicit scope. When instructions conflict, follow the repository's
documented precedence and the most specific applicable rule; surface unresolved conflicts
instead of silently choosing whichever instruction is easiest to satisfy.

## 8. Generated Code Is Not Source Code

Never edit generated files directly unless the repository explicitly designates them as
editable.

For generated artifacts:

1. identify the canonical source;
2. edit the source;
3. run the documented generator;
4. inspect the generated diff;
5. run the relevant validation.

Generated files should be recognizable by path, header, manifest, or documentation.
The generation command must be reproducible and must not depend on one developer's
machine, absolute paths, or hidden state.

## 9. Use Declarative and Reproducible Operations

Prefer checked-in, reviewable declarations over imperative runtime mutation.

Examples:

- migrations over manual database edits;
- Terraform or equivalent configuration over ad hoc infrastructure commands;
- package manifests over manually copied dependencies;
- build scripts over undocumented shell history;
- explicit configuration over periodic state repair;
- idempotent reconciliation over blind repeated mutation.

Do not make production or infrastructure changes through an agent unless the requested
scope explicitly authorizes them and the operation is reviewable, auditable, and safely
reversible.

For infrastructure and operational systems, default to read-only inspection. Require an
explicitly validated target before any write, restart, migration, deletion, or permission
change.

## 10. Preserve a Real Source of Truth

Do not introduce a second state store merely to make the first one appear healthy.

When state crosses UI, API, background worker, cache, database, or external service
boundaries:

- identify the authoritative owner;
- define the data contract;
- validate inputs and outputs;
- make synchronization direction explicit;
- detect and surface divergence;
- verify the authoritative state after mutation.

A local cache or optimistic UI may improve responsiveness, but it must never be treated
as proof that the authoritative operation succeeded.

Configuration controls must be truthful: if a feature is disabled, its installer,
observers, timers, wrappers, and side effects must be disabled or cleaned up as well.

## 11. Design Lifecycle Explicitly

Every component that installs listeners, observers, timers, hooks, global patches,
workers, or connections must have an explicit lifecycle.

Installers must be idempotent. Reinstalling or hot-reloading must not stack wrappers,
duplicate listeners, or leak timers.

Where applicable, provide:

- `start()` / `stop()`;
- cleanup functions;
- `AbortController` integration;
- ownership of timers and subscriptions;
- restoration of patched globals;
- tests for repeated installation and teardown.

Avoid non-configurable global patches. If a global must be wrapped, preserve its behavior,
metadata, error semantics, and restoration path.

## 12. Keep Changes Small and Reviewable

Prefer the smallest coherent change that fixes the root cause.

Do not combine unrelated cleanup, formatting, dependency upgrades, and behavioral changes
in one patch unless they are required for the requested outcome.

For large tasks, split work into independently verifiable steps. Each step should leave
the repository in a valid state.

Do not optimize for lines of code, number of commits, number of generated tests, token
usage, or apparent activity. Optimize for end-to-end delivery of a correct result.

## 13. Verification Is Part of Implementation

Invoking a function, receiving no exception, or seeing a changed DOM node is not proof of
success.

Verify behavior at the authoritative boundary whenever feasible.

Use the narrowest sufficient combination of:

- unit tests for pure logic;
- contract tests for data shapes and boundaries;
- integration tests for collaborating components;
- end-to-end tests for critical user flows;

When using CDP for diagnostics or verification, keep the current tab background-only:

- do not call `page.bringToFront()` unless the user explicitly asks for a focus change;
- do not switch away from the user's active tab to run checks;
- prefer background evaluation, screenshots, and DOM/network snapshots on the existing target.

For this project, background-only is the default and preferred mode for live browser work:

- never call `bringToFront()` as a convenience during live checks;
- if a new target is needed, open or navigate it without foregrounding the tab;
- treat any foregrounding as a user-visible mutation that requires explicit justification.

Foregrounding a tab is a side effect and should be treated like any other UI mutation:
only do it when it is required for the fix and you have stated why.
- type checking, linting, schema validation, and builds;
- targeted runtime inspection for environment-dependent behavior.

Test observable behavior and stable contracts. Avoid asserting exact HTML, DOM structure,
private method calls, incidental ordering, snapshots, or other implementation details
unless that detail is itself a supported contract. Before creating a new testing style,
find a well-maintained test in the same subsystem and follow it as the canonical example.

Tests must cover failure paths, retries, cleanup, repeated installation, concurrency,
idempotency, and configuration toggles when those risks exist.

Do not weaken, skip, delete, or ignore a failing test merely to make the suite pass. If a
test is wrong, explain why and replace it with a test of the intended behavior.

If full verification cannot be run, state exactly what was and was not verified.

## 14. Review the Whole Delivery Pipeline

Local coding speed is not the primary measure of success. Consider the full path:

```text
requirement -> design -> implementation -> review -> test -> release -> observed outcome
```

Avoid producing changes faster than they can be reviewed and validated. Large generated
diffs, duplicated code, and excessive abstraction move work downstream rather than
eliminating it.

When evaluating a change, consider:

- review cost;
- operational risk;
- migration and rollback;
- compatibility;
- observability;
- documentation drift;
- long-term maintenance;
- effect on future agent context.

## 15. Maintain Living Project Knowledge

Documentation should reflect decisions made during real work.

Update relevant documentation when a change affects:

- architecture or module ownership;
- public APIs or schemas;
- operational procedures;
- domain terminology;
- invariants and security boundaries;
- generated-code workflows;
- non-obvious tradeoffs.

Prefer concise, structured, version-controlled documentation. Use ADRs for important
architectural decisions and a glossary for domain terminology when needed.

Do not create documentation merely to satisfy a process. Documentation must have a clear
consumer and must be kept close to the source it describes.

When agent conversations reveal a durable decision, capture the decision and rationale —
not the entire conversation.

## 16. Observability and Honest Failure

Failures must remain visible and actionable.

- Preserve useful errors and causal chains.
- Add context without discarding the original exception.
- Use structured logs at system boundaries.
- Distinguish unavailable, degraded, pending, failed, and successful states.
- Never convert an unknown state into success.
- Do not log secrets, credentials, tokens, personal data, or full sensitive payloads.

Retries must be bounded, observable, and safe. Define maximum attempts, backoff, timeout,
idempotency behavior, and the terminal failure state.

## 17. Security and Safety Defaults

Treat every boundary as untrusted, including browser page contexts, plugins, generated
input, webhooks, local services, and model output.

- Validate inputs with explicit schemas.
- Use narrow allowlists rather than broad origin or pattern checks.
- Grant the minimum required permissions.
- Keep secrets out of URLs, logs, UI state, and untrusted contexts.
- Require confirmation or policy approval for destructive and externally visible actions.
- Resolve exact targets before deletion, migration, restart, or permission changes.
- Prefer reversible operations and documented rollback paths.

AI output is data, not authority. Never execute model-produced commands or infrastructure
changes without applying the same validation and authorization required for human input.

## 18. Agent Working Sequence

Use this sequence unless the task clearly requires a different one:

1. **Orient** — read the applicable instructions and locate the relevant code.
2. **Understand** — restate the goal, constraints, observed behavior, and uncertainty.
3. **Investigate** — trace the real code path and identify the authoritative state.
4. **Choose** — prefer the simplest standard solution that fixes the root cause.
5. **Implement** — make a small, coherent, reversible change.
6. **Verify** — test the behavior and important failure modes.
7. **Document** — update durable project knowledge when needed.
8. **Report** — summarize the outcome, evidence, remaining risks, and unverified areas.

Do not stop at a plausible patch when a safe verification path is available.

## 19. Definition of Done

A task is complete only when:

- the requested outcome is implemented;
- the root cause is addressed or a documented temporary workaround is explicitly accepted;
- authoritative state confirms the result where applicable;
- relevant tests and checks pass;
- failure and cleanup paths are considered;
- configuration and UI accurately reflect runtime behavior;
- generated artifacts come from their canonical sources;
- documentation is updated when the change introduces durable knowledge;
- no unrelated user changes were overwritten;
- remaining limitations and risks are stated clearly.

Code generation is easy. Correct integration, verification, and maintainability are the
actual deliverables.

## CDP target hygiene (remote debug)

When talking to Chrome DevTools Protocol on the automation port (e.g. 9223/9224), always treat page IDs as ephemeral:

- Before opening a WebSocket, **always** read `http://127.0.0.1:<cdpPort>/json/list`.
- Pick the **current** `webSocketDebuggerUrl` for the tab you care about by matching on its `url` (e.g. `https://www.perplexity.ai/search/...`).
- Connect only to that fresh ID; never reuse an old `devtools/page/<id>` after the tab was reloaded or DevTools closed, otherwise the DevTools server will legitimately return HTTP 500.


## CDP target hygiene (remote debug)

When using Chrome DevTools Protocol on ports like 9223/9224, page IDs are ephemeral:

- Always read `http://127.0.0.1:<cdpPort>/json/list` before opening a DevTools WebSocket.
- Select the `webSocketDebuggerUrl` by matching the `url` field of the tab you care about (e.g. `https://www.perplexity.ai/search/<uuid>`).
- Connect only to that fresh `devtools/page/<id>`; do not reuse an old ID after reload or DevTools close, otherwise the DevTools server will legitimately return HTTP 500.

## N. Environment Reality — Do Not Fake Missing Tools

When a command fails in a restricted or non-interactive Shell context (e.g. MCP tool call), do not conclude that the tool is absent from the system.

- If `npm`, `node`, `make`, or similar commands are not found in an MCP `local_execute` call, this is a Shell configuration issue, not a missing dependency.
- Always retry with an explicit path (e.g. `/usr/local/bin/npm`) or a proper interactive Shell invocation if the command is known to exist in the system.
- Never report "X is not installed" or "X not found in system" solely because a single MCP call failed — that is a Shell limitation, not a system fact.

When in doubt, assume the tool exists and find a way to invoke it correctly.
