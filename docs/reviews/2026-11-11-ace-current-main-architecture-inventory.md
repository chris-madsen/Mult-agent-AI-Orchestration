---
title: "ACE current-main architecture inventory — Phase A"
date: 2026-11-11
researcher: "Hermes Agent"
repository: "chris-madsen/Mult-agent-AI-Orchestration"
branch: "codex/ace-architecture-inventory"
git_commit: "29c09a79c2d821bea926ae2de72df3ce5da55582"
status: complete
topics:
  - architecture-inventory
  - sdlc
  - retrieval
  - gateway
---

# ACE current-main architecture inventory — Phase A

> `status: complete` means this source inventory is complete for the approved Phase A scope. It does not mean runtime production acceptance, owner approval, agent E2E, or benchmark completion.

## 1. Question and scope

**Question:** What architecture and runtime composition are present in the current repository, how do they map to accepted ACE/SDLC decisions, and which prior-plan statements remain current?

**Inputs reviewed:** the upstream `Mult-agent-AI-Orchestration` repository and its `docs/research/sdlc` material; `/home/ilja/Music/ace-3.md` and `ace-4.md`; the user-provided current plan; the tracked SDLC adoption plan, ADRs, OpenSpec changes, architecture rules, runtime composition, provider adapters, integrations, infrastructure, tests, CI workflows, and selected retained reviews/evidence.

**Boundaries:** source baseline is `origin/main@29c09a79c2d821bea926ae2de72df3ce5da55582`, tree `a4361517075afbe5f5dc51d6fa7b04e3acb71a3c`. This is a research/documentation slice. No runtime or production code was changed. Historical benchmark artifacts were inventoried and selectively inspected, not read line by line. Static findings are not promoted to provider or production claims.

**Worktree:** the task worktree was clean at the source baseline. A single task worktree was used; the pre-existing primary checkout and its untracked user files were preserved. The user-provided `docs/plans/current/current-plan.md` is not tracked in this clean `main` tree and was not edited; the tracked governing SDLC plan is updated separately.

## 2. Summary

- ACE is a TypeScript + Effect modular monolith with explicit MCP tools, a separate native Hermes ContextEngine/JSONL bridge, and an experimental Bifrost model-bound projection path. These are distinct delivery planes, not interchangeable transports.
- The current `main` tree has real local-provider evidence: Qdrant provider/restart/two-writer/crash scenarios and a real `rust-analyzer` LSP scenario passed in PR #227 CI. The retained artifacts explicitly do **not** approve production, Graphiti locality, or 5× savings.
- Two current gateway issues are directly reproduced or source-confirmed: the TypeScript request validator accepts unknown JSON fields and array-valued enums rejected by its strict JSON Schema; the gateway also has no authenticated transport or cryptographically verified host attestation. These block production gateway use.
- The current main AST selection defaults to `auto`, while the active retrieval plan and current remote follow-up branch preserve CLI as default until real-repository NAPI parity. The branch-only parity report is blocked and is not current-main evidence.
- Model-specific token counting, fresh RepoMap provenance, final Bifrost provider egress, real Hermes agent E2E, Graphiti egress authorization, TypeSpec migration, and Harbor efficiency evaluation remain distinct open gates. No production or token-savings claim changes in this inventory.

## 3. Findings

### R-001 — Runtime is one layered TypeScript + Effect monolith with thin language-specific boundaries

**Source identity:** `main@29c09a79c2d821bea926ae2de72df3ce5da55582`.

**Where:** `src/bin/ace-mcp.ts`; `src/application/`; `src/domain/`; `src/adapters/`; `src/gateway/`; `src/transport/`; `integrations/hermes/`; `integrations/bifrost/`.

**What it does:** tracked source is organized as 57 domain files, 22 application files, 39 adapters, five TypeScript bin entrypoints, one gateway module, and three transports. Python is used for embedding/provider and Hermes boundaries; Go is used for the Bifrost connector/plugin. The Rust crate is an inactive stub, not a second production runtime.

**Entry points and dataflow:**

1. `src/bin/ace-mcp.ts` validates runtime identity/configuration, composes workspace and provider ports, builds retrieval services, and selects the explicit MCP, context-bridge, or gateway mode. Qdrant retrieval is gated by `ACE_ENABLE_EXPERIMENTAL_QDRANT` (`src/bin/ace-mcp.ts:202-229, 380-403, 1126-1138`).
2. The code path is workspace observation/source snapshot → structural analysis and embedding → Qdrant candidates → local source verification → optional LSP enrichment and RepoMap → `ContextTransformService`/`ContextAssembler` → an explicit transport. Qdrant candidate freshness is initially `unknown`; current source verification is a separate step (`src/adapters/http-provider-boundaries.ts:214-276`; `src/application/context-transform-service.ts`).
3. `src/transport/mcp-sdk-stdio.ts` uses the official MCP TypeScript SDK for explicit tools. The handwritten `src/transport/mcp-stdio.ts` owner is absent from the current tracked tree. MCP is not the model-bound context plane.
4. `integrations/hermes/ace_context_engine/` implements the native Hermes ContextEngine/JSONL boundary; `src/transport/context-bridge-stdio.ts` is not MCP.
5. `src/transport/gateway-projection-http.ts` and the Go `integrations/bifrost/ace-connector/` implement a separate projection seam. Its endpoint currently rejects final-delivery recording as `PROVIDER_WIRE_NOT_CERTIFIED` (`src/transport/gateway-projection-http.ts:55-59`).
6. `src/bin/ace-memory.ts` and `src/adapters/graphiti-mcp.ts` provide an optional official Graphiti MCP boundary over local archive/policy ports. `src/bin/ace-worktree-helper.ts` is the host worktree/mTLS boundary.

**Architecture boundaries:** `architecture/rules/` currently enforces three import boundaries: domain-to-adapter, MCP transport-to-gateway, and gateway transport-to-MCP. These rules do not encode a separate dependency policy for each proposed bounded context. `src/domain/` has no direct adapter/application imports in the inspected tree, but `source-text.ts` imports `node:util` and `structural-language.ts` imports `node:path`; the current architecture rules do not reject those platform imports. `src/bin/ace-mcp.ts` remains a large composition root (1,199 lines), and `src/adapters/qdrant-context-provider.ts` remains a large provider owner (1,659 lines); size alone is not evidence that their ACE freshness/recovery responsibilities are safe to remove.

**Evidence type:** CODE, CONFIG, CI. The tracked tree contains 889 files: 128 `src/`, 118 `test/`, 109 `scripts/`, 188 `benchmarks/`, 215 `docs/`, 54 `openspec/`, 14 integration files, and eight infrastructure files, plus root/tooling files. The automated reuse audit scanned 805 text files and reported five exact-duplicate groups, 58 near-duplicate pairs, 27 duplicate symbol names, and 200 capped textual signals. Those are candidates only; several exact matches are historical reports, fixtures, or benchmark configs and were not treated as safe deletion targets.

**Uncertainty:** this inventory traces runtime-reachable paths and key owners; it is not a line-by-line audit of every historical report, benchmark fixture, or script.

### R-002 — Qdrant is on the official SDK path; bounded current-tree real-provider evidence exists

**Where:** `src/bin/ace-mcp.ts:9, 380-403, 1014-1018`; `src/adapters/qdrant-sdk-adapter.ts`; `src/adapters/http-provider-boundaries.ts:76-80, 214-276`; `src/adapters/qdrant-context-provider.ts:753-859`.

**What it does:** the composition constructs the official `QdrantClient` and passes it through `makeQdrantSdkAdapter`; candidate search and lifecycle operations use the typed `QdrantSdkPort`. The runtime selects stable-collection-direct publication. Cleanup is generation-fenced and excludes the current index key; verified membership is checked before pruning. The targeted source search found no Qdrant-specific raw REST branch in the production candidate/lifecycle path. The general fetch port in `http-provider-boundaries.ts` remains for other HTTP providers.

**Current-tree RUN evidence:** GitHub Actions run `42994334958` tested checkout `09de1bf7d52a9ae44ece83b15201644c2461f590`, whose tree is identical to current main `29c09a79...` (`a4361517...`). The retained artifacts are `ace-real-qdrant-42994334958` and `ace-real-lsp-42994334958`.

- `test:real-provider`: `provider-pass`; a 2,000-line TypeScript fixture returned a current citation and complete result.
- `test:real-provider-restart`: `provider-pass`; warm reuse and changed publication used the same stable collection.
- `test:real-qdrant-concurrency`: both writers completed, returned current citations, and converged on the same stable collection/index/provider fingerprint.
- `test:real-qdrant-crash`: the writer was killed after Qdrant verification and before publication; readers reconciled current bytes and the restarted writer published the next generation.
- Provider/runtime identity in the reports: Qdrant 1.19.2, Node 22.23.4, local-loopback Qdrant, FastEmbed worker; the scenario-specific source/trace digests and request IDs are in the retained JSON/JSONL artifacts.

The reports explicitly state `productionApproved: false` and `tokenSavings5x: false`. This closes only the exercised local-provider scenarios, not all interleavings, release readiness, or agent delivery. Qdrant remains explicitly gated as experimental in the runtime.

### R-003 — AST provider selection, RepoMap delivery, and LSP evidence are at different stages

**AST selection:** `src/bin/ace-mcp.ts:291-297` defaults `ACE_AST_GREP_PROVIDER` to `auto`, which selects the NAPI path for supported JS/TS grammars. The active retrieval plan says the batched CLI remains the default until real NAPI parity (`docs/plans/2026-10-26-retrieval-post-177-execution-plan.md:76-83`). The current remote `codex/retrieval-followup` branch sets the default to `cli`, but is not merged and has no open PR. Its branch-only readiness report records real-repository NAPI parity as `BLOCKED` across 125 files and 1,386 differences; it is not a current-main parity result. Current-main deterministic CI does run a three-file coverage subset that checks NAPI does not lose canonical CLI declarations (`test/ast-grep-napi.contracts.test.ts:160-194`), but no current-main job runs the full parity comparator over a representative repository. Therefore current main's `auto` default is a confirmed plan/evidence mismatch, not a verified full-parity promotion.

**RepoMap:** `src/domain/repo-map.ts:156-188` identifies a source-faithful adaptation of pinned Aider `get_ranked_tags` and NetworkX PageRank behavior. `test/repo-map.contracts.test.ts` uses a frozen `test/fixtures/repo-map/aider-behavior.json` fixture, and the deterministic suite includes a numerical graph-ranking comparison against the pinned Aider/NetworkX oracle on fixture data. No executable comparison against pinned Aider on a representative real repository or RepoMap benchmark artifact was found in the tracked scripts/benchmarks/reviews. `src/adapters/repo-map-structural.ts:120-143` builds graph relations from shared structural identifier records without requiring LSP. The runtime composes `makeRepoMapService` (`src/bin/ace-mcp.ts:656-660`) and returns rendered RepoMap as structural evidence; the contract test explicitly asserts `freshness: 'unknown'` because the aggregate map is not exact-reread as one source (`test/provider-and-multiprocess-contracts.test.ts:159-203`). Thus the map is wired and emitted, but its aggregate freshness is honestly unknown and cannot establish a complete/current structural result by itself.

**LSP:** the registry has a typed server descriptor and reference-counted leases; process identity deliberately excludes source-generation identity (`src/application/lsp/server-registry.ts:29-47, 70-74`). CI's real `rust-analyzer` report is `provider-pass` for definitions, references, hover, diagnostics, and mixed TypeScript routing, with exact provider version and fixture digest retained. This is real provider evidence for those operations, not the complete startup, crash/restart, cancellation, or agent-facing lifecycle matrix.

### R-004 — Gateway request validation and transport do not yet meet the strict contract

**Contract mismatch, directly reproduced:** `contracts/ace-gateway/v1/projection-request.schema.json:5-7, 14, 21, 27-44` rejects unknown properties and requires string enum values. `src/domain/gateway-projection.ts:109-159` does not reject unknown top-level fields and uses `String(input.dataClass)` / `String(input.projectionMode)` before returning the original value. A direct call to the current validator with an extra property returned `Ok`; a request with `dataClass: ["private"]` also returned `Ok` and retained an array in the typed result. Existing `test/gateway-schema.contracts.test.ts` checks the schema shape, while `test/gateway-projection.contracts.test.ts:33-45` does not assert runtime/schema equivalence. This is a confirmed trust-boundary defect, not just an unexecuted hypothesis.

**Host ownership and endpoint:** OpenSpec 009 requires authenticated host attestation bound to session/workspace/tenant (`openspec/changes/009-bifrost-hermes-ownership/specs/gateway-ownership/spec.md:19-25`). The TypeScript validator checks field types/digests and booleans but does not verify an attestation signature or authenticated principal (`src/domain/gateway-projection.ts:75-106`). The HTTP server has no authentication middleware and can bind beyond loopback through `ACE_GATEWAY_HTTP_HOST`; loopback is only the default (`src/transport/gateway-projection-http.ts:93-120`). The Go connector accepts an arbitrary endpoint and falls back to `http.DefaultClient` without requiring TLS or a local destination (`integrations/bifrost/ace-connector/connector.go:63-72, 121-127`). Hermes host ownership is optional by default (`integrations/hermes/ace_context_engine/engine.py:110-114`). These are confirmed blockers for a non-local/production strict route; the default loopback bind does not satisfy the authenticated-host requirement.

**Budget/final wire:** `makeContextAssembler` accepts an optional model counter, but runtime composes it with no counter (`src/application/context-assembler.ts:12-30`; `src/bin/ace-mcp.ts:1131-1138`). Character estimates remain partial, and `gateway-projection-service.ts:93-95` refuses `APPLY` when transformation is not `ready`. The final delivery endpoint returns 501. Bifrost's current mock-wire path therefore does not prove final provider egress, model usage receipts, or savings.

### R-005 — Documentation and memory egress are intentionally gated, not proven local end to end

**Vertex:** runtime requires `ACE_ENABLE_VERTEX`, project/corpus IDs, and sets `allowedCloudProviders` to Vertex only when `ACE_CLOUD_DOCS_OPT_IN=true`; the allowed data class is `project_document` (`src/bin/ace-mcp.ts:173-199`). Default Kubernetes config disables Vertex (`infra/k8s/ace-local/ace-mcp.yaml:10-16`). This is a code/config-level opt-in boundary; no real Vertex provider operation was run in the current CI evidence.

**Graphiti:** the default Kubernetes ACE config disables Graphiti. The pinned Graphiti config states that the pinned MCP does not expose the requested local Sentence-Transformers embedder and that preflight must remain `not_ready` until upstream supports it (`infra/providers/amplifier-graphiti/graphiti-config.yaml:1-5, 21-26`). Its LLM provider is OpenAI through a local Amplifier Face endpoint, and the pinned OAuth provider is `openai-chatgpt` (`graphiti-config.yaml:11-19`; `pins.json:10-29`). A local FalkorDB endpoint therefore does not establish local extraction/embedding egress. The sample is marked synthetic-only; private original sessions must remain blocked until extraction, embeddings, and authorization are evidenced as local/approved.

### R-006 — Accepted DDD/TypeSpec direction is not equivalent to installed tooling or enforced module contracts

ADR-019 is accepted and selects functional DDD and TypeSpec as the source language for new/migrated public/versioned contracts, including Gateway Projection; it explicitly does not install TypeSpec tooling (`docs/docs/references/ADR-019-functional-ddd-typespec-contracts.md:11-16, 32-38`). The inspected tree has no tracked `.tsp` source and `package.json` has no TypeSpec compiler dependency. Current gateway authority remains split among JSON Schema, TypeScript validation, and Go DTO/decoding.

The implementation is still one modular monolith; bounded-context names in design documents are not individually enforced by the current three architecture rules. Several repeated worker and filesystem lifecycle owners remain inventory candidates, not permission to consolidate: `process-embedding.ts`, `process-sparse-embedding.ts`, `process-reranker.ts`; `file-workspace-store.ts`, `file-memory-archive.ts`, `file-projection-outbox.ts`. Their error, cancellation, recovery, and persistence semantics require owner-specific proof before extraction.

### R-007 — SDLC adoption has merged gates, but repository merge policy is not enforced by visible repo settings

The tracked adoption plan records QG0/#223, QG1/#224, and QG2/#225 as merged; QG2 remains advisory/report-only. QG4–QG6 are staged, and TypeSpec TS-00..06 is a separate track (`docs/plans/2026-11-10-sdlc-adoption-execution-plan.md:241-291`). PR #227 is now merged at `29c09a79...`; its checks passed for contracts/deterministic verification, docs links, secret scanning, workflow security, the Bifrost connector, real Qdrant, and real non-TS LSP. The scheduled secret-history check was skipped. The contracts job ran `npm run verify:pr`; the real-provider job uploaded the artifacts referenced in R-002/R-003.

GitHub API readback on 2026-11-11 returned no repository rulesets and `404 Branch not protected` for `main`. Effective required-check/approval enforcement therefore remains an owner action; workflow presence alone is not merge protection. Local `npm ci --ignore-scripts` completed and reported nine npm audit findings (eight moderate, one high); no remediation or separate advisory triage was performed in this inventory.

### R-008 — Several tracked “current” indexes/status statements are stale or contradict current source

- `openspec/README.md:3-18, 38` describes seven changes and seven validations; the tracked tree contains nine active `tasks.md` changes (`001`–`009`) and 222 task checkboxes (157 checked, 65 unchecked). Checkboxes are not runtime acceptance proof.
- The 2026-10-27 addendum in `docs/plans/2026-10-26-retrieval-post-177-execution-plan.md` still describes raw Qdrant REST branches, the legacy handwritten MCP parser, LSP-dependent RepoMap, and RepoMap-only score-prior delivery (`:829-836, 872-876, 920-924`). Current main uses the SDK port, the old MCP parser is absent, RepoMap consumes shared structural records, and a test asserts structural evidence is emitted. The RepoMap evidence remains freshness-unknown; these old statements should not be used as current status.
- The tracked SDLC plan still labels PR #227 “draft until CI/owner review” (`docs/plans/2026-11-10-sdlc-adoption-execution-plan.md:293-299`) although GitHub reports it merged on 2026-11-11.
- `README.md:3, 11-12` calls the Bifrost gateway “not-yet-implemented” while later describing the connector and mock-wire proof (`:76-79`). The precise current status is: adapter and mock-wire path implemented; final provider egress/usage certification and production approval are not.

## 4. Runtime composition

| Entrypoint | Runtime composition/provider | Current evidence | Ambiguity or limit |
|---|---|---|---|
| `src/bin/ace-mcp.ts` | Official MCP SDK; optional local Qdrant + FastEmbed + ast-grep + LSP; context assembler | Real Qdrant provider/restart/two-writer/crash CI on identical main tree; deterministic CI | Qdrant is experimental-gated; NAPI `auto` parity unresolved; final context counter absent |
| `src/bin/ace-context-bridge.ts` + `integrations/hermes/ace_context_engine/` | Native Hermes ContextEngine over versioned JSONL bridge | Python contract tests and strict ownership checks exist | No current real Hermes agent E2E; strict attestation opt-in and not cryptographically authenticated |
| `src/bin/ace-gateway-http.ts` | Internal ACE projection HTTP service for Go Bifrost plugin | Gateway contracts and mock provider-wire coverage | No auth, record-delivery endpoint 501, no final provider egress/usage receipts |
| `src/bin/ace-memory.ts` | Local archive, decision history, optional official Graphiti MCP/FalkorDB | Local archive and provider contracts exist | Pinned Graphiti local embedder is unavailable; extraction route may use OpenAI; private-session use blocked |
| `src/bin/ace-worktree-helper.ts` | Host worktree helper using mTLS transport | K8s config requires client cert/key and disables inbound ACE network exposure | Release image is a non-pullable placeholder; no deployment-readiness claim |
| Python workers | FastEmbed and optional sparse/reranker subprocess protocols | CI real FastEmbed provider path passes | Worker lifecycle consolidation and non-default providers are separate gates |
| Go Bifrost connector/plugin | One pinned OpenAI Chat Completions ingress hook | Go test/vet CI passes; mock upstream path is tested | Does not certify ACE final provider egress, streaming, all routes, OAuth/privacy, or production |
| Rust crate | Placeholder library only | Manifest/stub inspected | Not active in production composition |

## 5. Existing tests and observations

| Test/command | Fixture/provider | Ran? | Result | Proves | Does not prove |
|---|---|---:|---|---|---|
| `npm run test:sdlc-preflight` | Offline temp-Git fixtures | Yes, before report | PASS | Preflight behavior on the task tree | Runtime behavior |
| `npm run sdlc:preflight -- --tier T2 --stage research --plan docs/plans/2026-11-10-sdlc-adoption-execution-plan.md --json` | Local task plan | Yes, before report | PASS | Research-stage plan gate | Owner approval for future implementation |
| `npm run sdlc:preflight -- --tier T2 --stage research --task-id ace-architecture-inventory --plan docs/plans/2026-11-10-sdlc-adoption-execution-plan.md --json` | Local task identity | Yes, before report | PASS | Task-ID preflight path | Runtime/provider acceptance |
| `npm run worktree:audit -- --json` | Local Git worktree | Yes, before report | PASS | Worktree lifecycle audit | User files outside this worktree |
| `npm run verify:pr` | Task worktree at `29c09a79...` with documentation-only changes | Yes; before final doc-only wording refinements | PASS: TypeScript 716/716; Hermes 20/20; lint/build; architecture rules 3/3; SDLC preflight 11/11 | Deterministic repository gates on this worktree | Real provider, agent E2E, benchmark, and Lychee docs-link CI |
| GitHub Actions run `42994334958` — `npm run verify:pr` | Tested checkout `09de1bf...`; tree equals main `29c09...` | Yes | SUCCESS | Deterministic suite, typecheck/lint/build/architecture/preflight at the tested tree | Production or agent E2E |
| `test:real-provider`, `test:real-provider-restart` | Qdrant 1.19.2 + FastEmbed | Yes, same CI run | `provider-pass` | Tested source integrity, restart, warm reuse | Production approval/performance budget |
| `test:real-qdrant-concurrency`, `test:real-qdrant-crash` | Two writers and a killed/restarted writer | Yes, same CI run | All recorded checks PASS | Bounded stable-publication scenarios | Every possible process interleaving |
| `test:real-non-ts-lsp` | Pinned CI `rust-analyzer` 1.99.1 + TypeScript route | Yes, same CI run | `provider-pass` | Definition/reference/hover/diagnostic scenario | Full lifecycle fault matrix or agent E2E |
| `go test ./...`, `go vet ./...` | Isolated ACE connector/plugin | Yes, same CI run | PASS | Go connector build/unit/vet path | Real upstream model/provider egress |
| Direct `validateGatewayProjectionRequest` probe | Valid v1 request plus extra property and array enum | Yes, local read-only probe | `Ok`; returned enum remained array | Confirms runtime/schema mismatch | Full exploitability under every deployment boundary |
| `npm ci --ignore-scripts` | Locked Node dependencies, local Node v24.15.0 | Yes | PASS; npm reported 9 audit findings | Locked install succeeds | Advisory triage or security remediation |
| Harbor/native-vs-ACE benchmark | No valid current paired agent run inspected | No | NOT RUN | — | Any token-savings or quality claim |
| Hermes live agent, Vertex, Graphiti real extraction, Bifrost final provider egress | Credentials/services not used in this inventory | No | NOT RUN/BLOCKED by current contracts/config | — | Production readiness |

## 6. Contradictions and resolutions

| Claim A | Claim B | Evidence | Resolution |
|---|---|---|---|
| Retrieval plan says CLI remains default until real NAPI parity | Main code defaults to `auto` | `docs/plans/2026-10-26-retrieval-post-177-execution-plan.md:79`; `src/bin/ace-mcp.ts:291-297` | UNRESOLVED; main does not satisfy the plan's evidence gate |
| Old retrieval addendum says Qdrant raw REST and legacy MCP owners remain | Current main uses typed SDK port and official MCP SDK only | `src/adapters/http-provider-boundaries.ts:76-80, 214-276`; `src/transport/mcp-sdk-stdio.ts:42-45`; current tracked `src/transport/` list | Historical findings superseded by source; retain only the remaining ACE-specific freshness/policy owners |
| OpenSpec schema rejects additional fields and requires string enums | Runtime validator accepts an extra field and `["private"]` | `projection-request.schema.json:5-7, 14`; `gateway-projection.ts:117-123`; direct probe | CONFIRMED contract drift |
| Bifrost is described as a selected future plane | A connector, projection endpoint, and mock wire proof already exist | `README.md:3, 76-79`; Go connector/plugin; gateway transport | Adapter/mock implemented; real final egress and production acceptance remain open |
| PR #227 is marked draft in the tracked plan | GitHub state is MERGED | plan `:293-299`; `gh pr view 227`; run/artifact readback | Plan status needs update |
| Seven OpenSpec changes are described | Nine active changes and 222 checkbox items are present | `openspec/README.md`; `git ls-files openspec/changes/*/tasks.md` | Index is stale; task checkboxes remain non-authoritative for runtime status |

## 7. Open questions

- **Q-01:** What authenticated principal/signature or equivalent accepted host-attestation mechanism will bind gateway requests to session, workspace, and tenant, and what network binding is allowed for Bifrost-to-ACE?
- **Q-02:** Is CLI default still the accepted R2 policy? If so, how will the current main default be reconciled with the blocked NAPI parity branch without importing that branch's unrelated/blocked R4 work?
- **Q-03:** What exact per-file source/freshness contract should a rendered RepoMap satisfy before it can contribute to a complete ContextBundle?
- **Q-04:** Which verified model-specific token counter and effective context-window metadata are available on the chosen Hermes/Bifrost route? Until then, the gateway correctly blocks strict `APPLY`.
- **Q-05:** Can Graphiti extraction and embeddings run entirely locally at the pinned upstream, or what destination-specific authorization is required before any private session data is transmitted?
- **Q-06:** When should the staged TypeSpec TS-00 inventory begin for the already-versioned Gateway Projection API, and which handwritten schemas/DTOs remain the compatibility baseline until parity is proven?
- **Q-07:** What repository ruleset/required-check policy does the owner want? The repo-level GitHub API shows no branch protection or rulesets; effective protection is not established by CI workflows alone.

## 8. Completion check

- [x] Material code claims are tied to current `main` paths/lines.
- [x] Runtime wiring is distinguished from hypothetical adapters and from planned architecture.
- [x] Historical plans/reviews are reconciled against current source and current CI evidence.
- [x] Provider, agent-E2E, benchmark, and owner-approval stages remain separate.
- [x] No PASS was inferred from a mere script/adapter declaration; retained current-tree real-provider artifacts were inspected.
- [x] Source SHA, tested checkout SHA, and identical tree identity are recorded.
- [x] Missing evidence and blocked claims are explicitly labeled.
