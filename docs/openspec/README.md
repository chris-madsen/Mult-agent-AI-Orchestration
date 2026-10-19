# OpenSpec SDD implementation plan for ACE

This is the active OpenSpec implementation plan. The five changes are partially
implemented and remain unarchived; each active change contains `proposal.md`,
`design.md`, `tasks.md`, and delta capability specs with
`## ADDED Requirements / #### Scenario:`. `openspec/specs/` starts empty because
no change has been fully implemented and archived. Treat each checked task as
evidence-backed only; do not infer completion from the proposal text.

## Execution order and dependencies

1. `001-foundation` — workspace & policy, MCP gateway, safe error contracts.
2. `002-harbor-evaluation` — strong Codex baseline and actual usage metrics (early enough to guide retrieval design).
3. `003-unified-retrieval` — Qdrant code retrieval, Tree-sitter AST, selectable LSP, Vertex docs, unified evidence bundle.
4. `004-temporal-memory` — Codex raw session archive + Graphiti extraction + temporal recall.
5. `005-adaptive-routing-spike` — experiment: deterministic route policy vs Jev; **not** automatic inclusion in production.

After each change: tests, design/ADR review, benchmark where meaningful, archive/sync OpenSpec specs only after implementation passes. Upstream capabilities are specified by earlier changes; sequential application avoids ambiguity.

## Live CLI verification (on user's machine)

```bash
npm install -g @fission-ai/openspec@latest
openspec --version
openspec list
openspec status --change 001-foundation
openspec validate 001-foundation --strict
openspec instructions apply --change 001-foundation
```

The exact CLI version and options must be checked against `openspec --help`/`openspec validate --help` in the target environment. In the current environment, OpenSpec `1.14.0` validates all five active changes with `--strict` from the `docs/` OpenSpec root.

## Architecture and source documents

- `../docs/architecture/01-strategic-ddd.md` — Bounded Contexts and Context Map
- `../docs/architecture/02-event-storming.md` — events, commands and policies
- `../docs/architecture/03-tactical-ddd.md` — entities, value objects, aggregates
- `../docs/architecture/04-fsm-workflows.md` — state machines and use cases
- `../docs/architecture/05-contracts-and-deployment.md` — MCP contracts, ports and local K8s boundary
- `../docs/references/` — copies of PRD & all signed-off ADRs

## Exclusions

No full observability stack, default code-to-cloud, multi-tenant enterprise IAM, agent-written patch manipulation, guaranteed dynamic callgraph, mandatory fixed output-token limits, or fresh microservices per BC.

---

## Architecture correction and sixth proposed acceptance change (2026-10-18)

**Critical:** Existing 001–005 changes contain provider-independent implementations, but an adapter and a green isolated contract test **do not** mean the production MCP composition uses the chosen provider. `006-production-retrieval-vertical-slice` is the proposed end-to-end closure change, with Meyer contracts DBC-01 through DBC-14 and owner review gate.

New normative readiness levels: `contract-designed`, `adapter-implemented`, `real-provider-tested`, `agent-E2E-passed`, `benchmark-evaluated`, `owner-approved`. Do not check mandatory capabilities off through a "controlled exception": open external provider decisions mean `not_ready`. Real agent retrieval benefit needs a retrieval-demanding holdout with **actual ACE MCP calls**; zero-call natural smoke or forced trivial TODO test is never proof of causal benefit.

Read `docs/docs/architecture/07-architecture-fitness-contracts.md`, the proposed ADR-012 and `docs/reviews/2026-10-18-architecture-failure-review.md` before executing the next implementation task. Keep original accepted ADR status unchanged until explicit owner approval.

## Codex immediate work (owner approved 2026-10-19)

Read [`changes/006-production-retrieval-vertical-slice/CODEX-EXECUTION-PLAN.md`](changes/006-production-retrieval-vertical-slice/CODEX-EXECUTION-PLAN.md) first. ADR-012 is **Accepted** as a six-rule acceptance policy and ADR-013 is **Accepted only as an experimental embedding-evaluation protocol**. This is not model selection, retrieval production readiness or 5× validation. Run candidate integration, Serena-vs-TS-LS comparison, local Graphiti and gcloud Vertex probes and real Harbor tests without further planning bureaucracy; retain production gates as unchecked until actual evidence exists.
