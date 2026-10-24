# ACE — Traceability Matrix, Design Review и Definition of Ready

**Статус:** Proposed. Цель: дать coding-агенту точную трассу от исходных требований к событиям, модулям, тестам и OpenSpec changes, а также показать, что **ещё не принято**.

## 1. PRD → домены → OpenSpec

| PRD requirement | BC / механизм | OpenSpec capability | Change | Статус реализации |
|---|---|---|---|---|
| FR-01 lexical+semantic code | Code Discovery | `code-discovery` | 003 | Planned |
| FR-02 AST-aware symbols | Semantic Intelligence | `semantic-verification` | 003 | Planned |
| FR-03 LSP definitions/refs/types | Semantic Intelligence | `semantic-verification` | 003 | Planned; LSP provider spike |
| FR-04 docs RAG | Documentation Knowledge | `documentation-retrieval` | 003 | Planned |
| FR-05 unified context | Context Orchestration | `unified-context` | 003 | Planned |
| FR-06 fixed budget (original PRD) | Context Orchestration | `mcp-gateway`, `unified-context` | 001, 003 | **Superseded by ADR-006:** no mandatory cap; lossless output |
| FR-07 adaptive routing | Context Orchestration | `adaptive-routing` | 005 | Experiment only; Jev not adopted |
| FR-08 structural search | Semantic Intelligence | `semantic-verification` | 003 | Planned |
| FR-09 graph/impact | Semantic Intelligence | `semantic-verification` | 003 | Minimal impact from AST/LSP; persistent graph deferred |
| FR-10 data-flow/CFG | Future static analysis | no current spec | Later | **Deferred P2** |
| FR-11 runtime/test evidence | Future evidence ports | no current spec | Later | **Deferred P2** |
| FR-12 source/revision | Workspace Truth | `workspace-identity` | 001 | Planned |
| FR-13 stale-safety | Workspace + Retrieval | `workspace-identity`, `code-discovery`, `unified-context` | 001, 003 | Planned |
| FR-14 incremental + overlay | Workspace + Discovery | `code-discovery` | 003 | Planned |
| FR-15 provenance | Orchestration + Semantics | `unified-context` | 003 | Planned |
| FR-16 dynamic uncertainty | Semantic Intelligence | `semantic-verification` | 003 | Planned |
| FR-17 archive queries | Memory | `project-memory` | 004 | Planned |
| FR-18 episode + knowledge | Memory | `project-memory` | 004 | Planned |
| FR-19 source links | Memory | `project-memory` | 004 | Planned |
| FR-20 decision states | Memory | `project-memory` | 004 | Planned |
| FR-21 time-aware | Memory | `project-memory` | 004 | Planned |
| FR-22 delete/correct | Memory + Policy | `project-memory` | 004 | Planned |
| FR-23 links to commits/ADRs | Memory + Workspace | `project-memory`, `workspace-identity` | 004 | Initial provenance; richer cross-graph linking later |
| FR-24 Codex MCP | Agent Access | `mcp-gateway` | 001 | Planned |
| FR-25 no Codex fork | Agent Access | `mcp-gateway` | 001 | Planned |
| FR-26 AGENTS.md guidance | Agent Access | root `AGENTS.md` | 001 | Document provided, runtime guidance to verify |
| FR-27 future agents | Agent Access ACL | `mcp-gateway` | 001 | Port designed; extra adapters deferred |
| FR-28 fail safe | Trust & Policy | `security-policy` | 001 | Planned |
| FR-29 usage logs | Evaluation | `agent-benchmarking` | 002 | Planned |
| FR-30 compare | Evaluation | `agent-benchmarking` | 002 | Planned |
| FR-31 correctness | Evaluation | `agent-benchmarking` | 002 | Planned |
| FR-32 cached/uncached/cost | Evaluation | `agent-benchmarking` | 002 | Planned |
| FR-33 retrieval metrics | Evaluation | `agent-benchmarking` + task-specific fixtures | 002, 003 | Planned |
| FR-34 dashboard | full observability | no current spec | Later | **Deferred per ADR-010**; raw reports still required |
| FR-35 ablations | Evaluation | `agent-benchmarking` | 002+ | Planned |
| FR-36 new-session tests | Memory + Evaluation | `project-memory`, `agent-benchmarking` | 004 | Planned |

**PRD NFR-07** initially lists tracing/dashboards, but **ADR-010 defers full observability**. Mandatory minimal usage and security event logs stay.

## 2. ADR → design consequences

> **Current delivery precedence (ADR-016/017, 2026-10-24):** the old ADR-001 `unified MCP` line below describes only the explicit tools facade. It is not an instruction to inject model context through MCP. Hermes-native ContextEngine is implemented; Bifrost gateway projection is selected but unimplemented and must pass provider-wire/agent E2E. LangGraph orchestration is outside ACE.

| Accepted ADR | Realized by |
|---|---|
| ADR-001 agent-neutral core + existing MCP explicit tools | MCP tools ACL + BC-06, change 001; model delivery superseded by ADR-016/017 |
| ADR-002 Jev proposed | Change 005 **experiment**, not runtime dependency |
| ADR-003 Qdrant code + Vertex docs | BC-02 + BC-04, change 003 |
| ADR-004 Tree-sitter/ast-grep + LSP spike + fresh overlay | BC-01/02/03, changes 001/003 |
| ADR-005 archive + Graphiti | BC-05, change 004 |
| ADR-006 no forced output truncation | ArtifactPort, ContextBundle exact expand, changes 001/003 |
| ADR-007 policy deny vs outage with logs | BC-07, changes 001/003/004 |
| ADR-008 existing local K8s and modular monolith | Proposed deployment (design, not preselected mounts) |
| ADR-009 Harbor benchmarking | BC-08, change 002 |
| ADR-010 dashboards deferred | No Grafana/OTel requirement, minimal event and usage logs only |
| ADR-011 TypeScript + Effect core | Foundation runtime and contracts; Rust remains benchmark-gated candidate |

## 3. Key Acceptance Tests (cross-context)

| Test ID | Scenario | Expected invariant | Owner BC |
|---|---|---|---|
| ACE-T001 | Registered repository with symlink to outside | Denied/no leakage | Workspace Truth + Policy |
| ACE-T002 | Working-tree file changed after Qdrant index built | Old D1 never `current` | Workspace Truth / Orchestration |
| ACE-T003 | Same method name in two classes | Correct references or unresolved, not merged by name | Semantic Intelligence |
| ACE-T004 | Dynamically registered handler; LSP returns 0 refs | Unknown dynamic exposure, not «unused» | Semantic Intelligence |
| ACE-T005 | Vertex timeout and local AST available | Degraded partial bundle and safe log | Orchestration / Policy |
| ACE-T006 | Policy forbids code upload | No external request; deny logged | Policy |
| ACE-T007 | Prompt injection embedded in README | Treated as source text, no tool/policy escalation | Policy / Orchestration |
| ACE-T008 | 2000+ line file round-trip | Byte-identical full read; SHA-256 equality | Agent Gateway / Artifact |
| ACE-T009 | Re-import exact Codex session twice | One logical episode, original preserved | Memory |
| ACE-T010 | Proposed decision never confirmed | Remains proposed, not accepted | Memory |
| ACE-T011 | Accepted decision later superseded | As-of retrieval shows historical correct status | Memory |
| ACE-T012 | User deletes memory | Original and derived index not retrievable; safe audit | Memory / Policy |
| ACE-T013 | Codex JSON usage with cumulative snapshots | No double counting | Evaluation |
| ACE-T014 | Lower token result but failing tests | Not accepted win | Evaluation |
| ACE-T015 | Harbor run aborted/timeouts | Included in metrics and pass rate | Evaluation |
| ACE-T016 | Jev cloud route lacks consent | No Jev request, rule route usable | Policy / Routing |
| ACE-T017 | Host file changes during MCP request | Retry/changed_during_request, never falsely current | Workspace / Orchestration |
| ACE-T018 | Generated code archived as exact artifact | No truncation by model budget logic | Agent Gateway / Orchestration |

## 4. Design Review decisions REQUIRED before implementation declares production readiness

- **D-01:** Language of main monolith (**resolved by ADR-011:** TypeScript + Effect; Rust remains benchmark-gated).
- **D-02:** Secure read of local Codex working tree from K8s pod (host helper / specific mount alternative).
- **D-03:** Actual LSP adapter (Serena or direct TypeScript service).
- **D-04:** Embedding model(s), local-first and cloud opt-in quality gate.
- **D-05:** Codex transcript export mechanism and exactly what can be captured.
- **D-06:** Graphiti extractor/model + backend license, local privacy, durable storage and deletion.
- **D-07:** Jev adoption only *after* comparative spike; optional forever.
- **D-08:** Pinned Harbor/Codex adapter and normalization of usage counter semantics.
- **D-09:** Exact MCP schema transport and handles supported by installed client.

Implementer MAY mock unresolved provider integration for isolated tests, but MUST return `unsupported/not_configured` in functional paths until an approved real provider exists. No simulated successful runtime behavior.

## 5. Definition of Ready for an OpenSpec change

- Source PRD/ADR checked; delta specs normative and scenarios executable.
- Owning Bounded Context / aggregate / port identified.
- All external data transfers mapped to policy gate and necessary opt-ins.
- No contradictory guardrail (especially fixed token cap vs ADR-006).
- Required spikes scoped and identified as blocking where needed.
- Tests identify both happy paths and failed, stale, racing, denied scenarios.
- Rollout and rollback conditions, provider version pins and license notes specified.

## 6. Definition of Done for a change

- All behavioral scenarios tested or explicitly accepted as controlled exception.
- No data leakage or false-success/freshness reports in negative tests.
- Domain invariants enforced in code, not only comments.
- Adapter-specific DTOs do not leak into domain modules.
- Full artifacts preserved with exact checksums where applicable.
- Harbor performance/correctness report for affected capabilities; raw logs retained safely.
- Updated ADR if material assumption changed, documentation reflects actual, not aspirational, behavior.
- Owner has reviewed, and `openspec archive` run only after verification.


---

## 7. Correction traceability: no provider-complete claims without wiring proof

| Architecture contract | PRD / ADR | Spec owner | Current observed gap (2026-10-18) |
|---|---|---|---|
| DBC-01/02/03 actual Qdrant→AST→LSP, precise spans | FR-01/02/03/05, ADR-003/004 | 003 + 006 | Runtime `ace-mcp` uses regex/full-file lexical index |
| DBC-06 completeness | FR-05/15/28, ADR-006/007 | 003 + 006 | Warnings can coexist with `complete=true` |
| DBC-09 MCP SDK | FR-24/27, ADR-001 | 001 + 006 | Hand-rolled JSON-RPC instead of official SDK |
| DBC-10/11 archive identity/delete | FR-17/18/22, ADR-005 | 004 + 006 | append re-identifies episodes; shared digest delete risk |
| DBC-12 Harbor attribution | FR-29/30/35, ADR-009 | 002 + 006 | trivial forced smoke and zero-call natural smoke cannot prove gains |

**Implementation-status vocabulary:** `contract-designed` → `adapter-implemented` → `provider-tested` → `agent-E2E-tested` → `benchmarked` → `owner-approved/production-ready`. A prior checkbox means only its **narrowly worded task** was attempted; it must not be used to promote an entire capability. The quality gates in `07-architecture-fitness-contracts.md` and proposed ADR-012 supersede any informal inference of readiness; accepted ADRs remain authoritative until the owner approves changes.


## 7. Current-state correction and ADR-014 traceability — 2026-10-21

The original “Planned” statuses above are historical blueprint state and must not be used as current implementation status. By current main after PR #94:

- ast-grep structural extraction is implemented in the production path;
- generic LSP provider wiring is implemented;
- Qdrant immutable collection + atomic alias publication is implemented;
- content-addressed dense vector reuse is implemented;
- request-time dirty-worktree reconciliation is implemented;
- explicit source obligations and progressive exact expansion are implemented.

ADR-014 / OpenSpec 007 add the remaining target capabilities:

| Target | Capability | Change | Current status |
|---|---|---|---|
| Dense + sparse code retrieval | hybrid-context | 007 | **Open** — dense exists, sparse/BM25+RRF missing |
| Reranking | hybrid-context | 007 | **Open** — provider/model not selected |
| Dynamic working-state priors | hybrid-context | 007 | **Partial** — freshness exists; ranking priors/focus hints missing |
| Context receipts/delta delivery | hybrid-context | 007 | **Open** |
| Compact structural outlines in locate mode | hybrid-context | 007 | **Partial** — ast-grep outline exists internally; delivery policy open |
| Natural agent token/quality proof | agent-benchmarking + hybrid-context | 002,007 | **Open** |

This table is the current bridge from the historical blueprint to the accepted Cursor-like hybrid architecture. See `plans/2026-10-21-cursor-like-hybrid-context-completion-plan.md`.
