# ACE — single-agent, agent-neutral SDLC architecture

## Purpose and authority

The SDLC controls **how changes to ACE are developed**; it is not an AI runtime component. It works with any coding agent able to read repository files and run commands. The agent reads root AGENTS.md first and obeys the current accepted ADR/OpenSpec hierarchy.

Operational entrypoint: [docs/operations/ai-assisted-sdlc.md](../../operations/ai-assisted-sdlc.md).  
Prompt router: [PROMPTS-ACE.md](PROMPTS-ACE.md).  
Full workflows: [source/commands/](source/commands/).  
Rules: [source/standards/](source/standards/).

## Critical distinction: SDLC vs ACE runtime

- ACE's TypeScript + Effect core remains an agent-neutral context/RAG engine.
- LangGraph, Claude TeamCreate, Codex tasks or similar orchestrators are **not** requirements.
- The SDLC is a Markdown workflow for the coding agent working on ACE's repo.
- A single agent reads the relevant command and performs its steps sequentially.
- Four different review passes are **not four independent reviewers**.
- Existing OpenSpec, ADR, docs/plans, tests and GitHub Actions remain authoritative.
- New process files must not become competing spec/test/runtime owners.

## Execution model

```text
User request
  → preflight (repo, branch, HEAD, rules, active PRs, risk)
  → Research (fact-only)                   [T1/T2 as needed]
  → Design (C4/DFD/sequence/decisions)     [T2; T1 concise]
  → Plan (canonical OpenSpec/tasks)        [T1/T2]
  → owner decision if architecture/policy changes
  → one unblocked implementation phase
      → RED test / reproducible oracle
      → minimal code change
      → GREEN + affected checks
      → BUILD gate
      → ARCHITECTURE gate
      → SECURITY gate
      → PLAN COVERAGE gate
      → any FAIL: same phase repair + recheck
  → focused commit + push + open PR at exact SHA
  → next phase OR cross-phase integration review
  → real-provider/agent-E2E as applicable
  → human approval and merge
```

The stage transitions are logical; no separate orchestration server or hidden state machine is added.

## Scope classes

| Tier | Use case | Research/Design | Tests & gates |
|---|---|---|---|
| T0 | documentation, formatting, mechanical safe edit | inspect only, minimal PR rationale | applicable diff/CI checks |
| T1 | local defect, no material new contract | focused AS-IS and smallest repair design | RED/GREEN where feasible; four applicable gates |
| T2 | new behavior, protocol, state, concurrency, security or egress | full source-grounded research, approved design/plan | all gates, explicit owner decisions and relevant real E2E |

A one-line policy change may require T2; a large documentation cleanup may remain T0. Complexity is risk-based.

## Input and output per stage

| Stage | Required input | Deliverable | Explicit prohibition |
|---|---|---|---|
| Research | question, source SHA, code entrypoints | fact-only source map and evidence ledger | recommendations/implementation |
| Design | verified facts, owner goals, ADR | behavioral and architecture contract | silent change of accepted ADR |
| Plan | approved contract, current implementation | exact phased file/test map | vague "implement and test" |
| Implement | approved slice, actual test owner | minimal code, RED/GREEN and gate report | uncontrolled extra scope |
| Final review | complete PR diff, provider evidence | cross-phase verdict with limitations | mock-only production claim |

## Detailed source instruction mapping

### Research
Use [research_codebase.md](source/commands/research_codebase.md) in full. It constrains the agent to documentation of present behavior, full reads of relevant definitions, exact path:line, current runtime composition and explicit unknowns.

Use [codebase-researcher.md](source/agents/codebase-researcher.md) as a sequential investigative pass. A call to a planned adapter is not proof the adapter is actually bound in the runtime.

Store research in a durable, existing research location. Keep as-is findings separate from any later design proposal.

### Design
Use [design_feature.md](source/commands/design_feature.md) with conditional research. Adapt the video's output types into existing OpenSpec design sections:
1. Architecture: C4 context/container/component and actual proposed DI/ports.
2. Behavior: normal/error/timeout/cancellation sequences; DFD and state transitions.
3. Decisions: alternatives, rationale, risk, owner and ADR change if required.
4. Testing: requirement/invariant → unit/contract/provider/agent E2E mapping.
5. Events: only when event contracts change.
6. Persistence: only for Qdrant/archive/Graphiti/other state mapping changes.
7. Standards: link canonical ACE engineering rules.
8. API: only when public HTTP/MCP/gateway-projection contract changes.

Do not create eight files automatically. In T2, sections may be split if needed. In a limited T1 fix, a short design and test mapping suffice.

### Plan
The example sequence in the presentation (domain VO, ports, adapters, use case, mapping, controller, DI) is specific to its feature. In ACE use **vertical, independently verifiable slices**, not a mandatory Go layer order.

Every slice has:
- task ID and dependencies;
- exact new/modified/deleted files;
- observable acceptance condition and negative case;
- approved architecture and data-policy constraints;
- test command with expected RED/GREEN output;
- rollback/migration/compatibility requirement;
- targeted provider evidence when required;
- four reviewer passes;
- human decision stop point where needed.

Use an existing governing OpenSpec tasks.md or docs/plans plan, not two trackers. Record phases in the [phase template](source/templates/phase-template.md).

### Implement and review
Use the **complete** [implement_backend.md](source/commands/implement_backend.md) for ACE code. The implementation loop includes:
- current state/preflight and plan dependency read;
- deterministic RED and minimal GREEN;
- affected test selection;
- build gate with actual command outputs;
- architecture gate for TypeScript+Effect, DDD, reuse and runtime wiring;
- security gate for trusted identity, prompt injection, egress, secrets, retry and side effects;
- plan gate mapping every requirement, file and test;
- rejection/repair/recheck loop;
- focused PR delivery with HEAD SHA, CI results and source-linked artifacts;
- final cross-phase review.

Use backend bugfix [workflow](source/commands/fix_backend_bug.md) if the task starts from a failure report. Use frontend commands only when implementing a real UI; TypeScript itself does not imply frontend.

## Standards relevant to ACE

The 13 [standard files](source/standards/) are separate references and are read conditionally. Architecture Layers, Clean Architecture and Domain Model map to accepted TypeScript+Effect boundaries. Builder is a semantic invariant/factory discipline rather than required Go-style getter syntax. RepoModel maps to source truth, cache/persistence and safe migrations. Tests Style and Domain model test map to established Node test runner and deterministic tests. Base Mock never substitutes for provider acceptance. Go style applies only to actual Go connector code. LLM Integration adds model/provider, RAG, tool policy, reliability, observability and cost requirements. Functional Domain Modeling owns the canonical FP rule IDs, TypeSpec Contract First owns public-wire migration rules, and Quality Gates defines the developer verification procedure.

## ACE-specific non-negotiable gates

1. Source bytes/current revision outrank stale index and derived memory.
2. A successful empty result differs from unavailable, denied, stale and not-ready.
3. A complete result requires required-source coverage and evidence.
4. Actual LSP semantic evidence differs from textual symbol resemblance.
5. MCP explicit tool success is not proof of Bifrost provider-bound injection.
6. Hermes native request-time bridge is a separate owned integration.
7. Private source must not leave local environment without approved policy.
8. Vertex documentation egress must remain authorized and isolated.
9. Graphiti derived claims must not silently become original/session truth.
10. Tool actions need authorization and idempotency/replay safety where applicable.
11. Real-provider and agent E2E statuses must be reported distinctly from mocks.
12. 5× savings remains a benchmark hypothesis until measured on quality-gated paired tasks.
13. Source SHA, provider identity, fixture and artifacts bind acceptance evidence.
14. No unsupported new bespoke parser/cache/protocol/shadow implementation.

## Context handling

Before compaction, complete the [checkpoint](source/templates/progress-checkpoint.md): task/PR/HEAD, phase/dependencies, accepted decisions, test results and failures, blocked owner decisions and next exact action. On resume re-read source and check branch/remote PR. Numerical context-window thresholds are optional heuristics since not every client exposes usage.

## Definition of done

- Correct scope classification and source version.
- Required fact-only research and approved design/plan available.
- Every implemented slice passes applicable build/architecture/security/plan gates.
- Actual tests and provider evidence reported honestly.
- Cross-phase review covers the entire PR, not one last commit.
- Committed and pushed branch with open PR to main and exact SHA/check statuses.
- Human approval for material decisions and merge.
- Separate release criteria for production claims.

## Verification of this SDLC itself

Use [PROMPT-ACCEPTANCE-SCENARIOS.md](PROMPT-ACCEPTANCE-SCENARIOS.md) to check whether prompts drive the intended behavior. Run controlled positive/negative cases, retain output, compare against a baseline where useful. A written prompt is not evidence that the process works; a real completed change with observed tests is the proof.
