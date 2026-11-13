---
date: 2026-11-13
repository: chris-madsen/Mult-agent-AI-Orchestration
branch: main
commit: 6df583fad7d45a4cda6586632240b6f364c08a8a
research_question: >-
  Follow AGENTS.md, .agents/skills/ace-sdlc/SKILL.md and the full Research stage of
  docs/operations/ai-assisted-sdlc.md. Research the actual source-backed path by
  which ace_context is registered in MCP stdio. Identify the runtime composition,
  source identity, typed unavailable behavior and real versus mocked provider
  evidence. Record the current SHA and file/line citations. Do not change code or
  suggest a redesign during Research.
status: complete
---

# Research: `ace_context` registration in MCP stdio

## Scope and constraints

- **Answered:** the current executable and transport path; the `ace_context` request path; source identity carried by code evidence; unavailable-provider behavior; and what the available tests and provider run prove.
- **Excluded:** code/config changes, provider selection or approval, cloud requests, Bifrost provider-wire, Hermes model-context delivery, and agent quality claims.
- **Source identity:** repository `chris-madsen/Mult-agent-AI-Orchestration`, `main@6df583fad7d45a4cda6586632240b6f364c08a8a`. The checkout was clean at inspection. The T0 preflight and worktree audit were read-only.

## Executive summary

`ace_context` is an explicit MCP tool. `package.json:7-10` builds the TypeScript runtime and starts `dist/bin/ace-mcp.js`; the executable's normal mode composes `makeMcpGateway` and `runMcpSdkStdio` (`src/bin/ace-mcp.ts:1144-1169`). The official MCP server SDK registers the tool and owns stdio framing (`src/transport/mcp-sdk-stdio.ts:42-100,130-146`).

Real retrieval is conditional: `ACE_ENABLE_EXPERIMENTAL_QDRANT=true` is required to construct the Qdrant-backed provider (`src/bin/ace-mcp.ts:372-386,1112-1117`). With the flag off, the MCP server can still start and list `ace_context`, but its call returns typed `not_ready` rather than an empty success (`src/bin/ace-mcp.ts:1124-1127`; `src/gateway/mcp-gateway.ts:120-125,247`). This is an explicit-tool path, not automatic model-context injection.

## Entry points and runtime composition

| Entry | Observed implementation | Evidence |
|---|---|---|
| CLI script | `npm run mcp:stdio` builds, then runs the compiled ACE MCP executable | `package.json:7-10` |
| Runtime bootstrap | Source execution is allowed only with `ACE_ALLOW_SOURCE_RUNTIME=true`; compiled execution verifies runtime provenance and reports the MCP SDK versions | `src/bin/ace-mcp.ts:206-220` |
| Workspace identity | `ACE_WORKSPACE_ROOT` is required; roots are constrained by `ACE_ALLOWED_ROOTS`; the workspace is registered and observed before serving tools | `src/bin/ace-mcp.ts:223-265` |
| Retrieval provider | The experimental flag gates setup; Qdrant defaults to loopback and is validated against local-host policy before constructing its client | `src/bin/ace-mcp.ts:372-402` |
| Transport selection | Gateway HTTP and direct ContextBridge JSONL are separate mutually exclusive modes. Otherwise the executable composes the explicit MCP gateway and official stdio server | `src/bin/ace-mcp.ts:1129-1169` |
| MCP registration | `createAceServer` registers `ace_context` with a Zod input schema; `runMcpSdkStdio` delegates protocol and stdio lifecycle to `serveStdio` | `src/transport/mcp-sdk-stdio.ts:42-100,130-146` |

The registered input includes `workspace_id`, `query`, optional retrieval intent/source switches, working-context hints, and required/optional source obligations (`src/transport/mcp-sdk-stdio.ts:75-100`). The gateway validates the request, resolves the workspace and source plan, calls the injected `ContextProvider.search`, then applies the delivery projection (`src/gateway/mcp-gateway.ts:127-247`). The installed server SDK is pinned at `@modelcontextprotocol/server` 2.3.1 (`package.json:115-125`).

## Source identity and freshness

For code evidence, `RetrievalEvidence` exposes the source kind, citation, source digest, proof class, freshness, source revision, and optional exact-expansion handle/range (`src/domain/retrieval.ts:112-147`). `evidenceFromCandidate` creates citations as `path:start-end` and sets both `sourceDigest` and `sourceRevision` from the candidate's source digest (`src/domain/retrieval.ts:383-399`).

Before delivery, the Qdrant provider rereads exact workspace bytes and requires both the file digest and the byte-exact selected span to match the indexed candidate. A mismatch is marked stale/unknown, recorded as a failure, and the unverified snippet is omitted (`src/adapters/qdrant-context-provider.ts:1287-1328`). This is source-integrity evidence for the MCP result; it is not evidence that an agent's later model request contained or used that result.

## Typed unavailable behavior

`GatewayResponse` distinguishes `ok`, `not_ready` with code `NOT_READY`, and typed domain `error` (`src/gateway/mcp-gateway.ts:70-73`). A provider-returned `NOT_READY` remains `not_ready`; other typed failures remain errors (`src/gateway/mcp-gateway.ts:113-117`). If the provider was not constructed, `ace_context` returns `not_ready` for `unified_context` (`src/gateway/mcp-gateway.ts:120-125,247`). The transport marks non-OK results as MCP errors and preserves the structured status in `structuredContent` (`src/transport/mcp-sdk-stdio.ts:13-29`).

## Test and provider evidence

| Evidence | Real or simulated | Observed result | What it proves / does not prove |
|---|---|---|---|
| `test/mcp-sdk-runtime.conformance.test.ts:11-65` | Official MCP client and stdio transport launch `src/bin/ace-mcp.ts`; source-runtime mode is explicitly enabled and Qdrant is disabled | Tools are listed, `ace_context` schema is present, and workspace status is not ready | Actual entrypoint/SDK registration and stdio interoperability; this test does not call `ace_context` with a ready provider and does not verify compiled provenance |
| `test/mcp-sdk-runtime.conformance.test.ts:67-90` | In-memory SDK transport and `Effect.never` fake gateway | Cancellation interrupts the effect | Cancellation mapping only; no real provider |
| `test/mcp-runtime-readiness.test.ts:82-96` | Actual ACE entrypoint over stdio; configured Qdrant endpoint is a local unavailable test endpoint | Calling `ace_context` returns `NOT_READY` while the process remains callable | Real unavailable path; no successful retrieval provider |
| `test/mcp-runtime-readiness.test.ts:98-134` | Actual entrypoint, local fake Qdrant HTTP server, and fake embedding worker that exits 17 | Embedding preflight failure remains `not_ready` | Failure handling only; the provider is simulated |
| `scripts/real-provider-e2e.mjs:65-86,186-239` | Source-identified ACE runtime, local Qdrant and resolved embedding worker; sends an MCP `tools/call` for `ace_context` | Asserts complete retrieval, current freshness, exact source digest/citation/span; the following `ace_expand` assertion compares returned bytes with the original fixture (`:242-260`) | Real-provider MCP retrieval and exact-source expansion against a temporary 2000-line fixture; no LLM agent consumes the result |
| GitHub Actions run `43409457459` | Full nightly at `main@6df583fad7d45a4cda6586632240b6f364c08a8a` | `real-qdrant` job and its “actual provider and restart acceptance” step succeeded; full deterministic suite succeeded | Retained real local-provider evidence for this source revision; not Bifrost final-provider wire or agent E2E |

The targeted local command `./node_modules/.bin/tsx --test test/mcp-sdk-runtime.conformance.test.ts test/mcp-runtime-readiness.test.ts` passed **4/4** on the recorded source SHA. `npm run test:sdlc-preflight` passed **11/11**; `npm run sdlc:preflight -- --tier T0 --stage research --json` returned `READY_FOR_AGENT`. These preflights do not attest provider or agent acceptance.

## Delivery-plane distinction

The implementation comment says MCP is the optional explicit-tool plane; model-bound Bifrost projection and native Hermes modes do not instantiate the MCP gateway (`src/bin/ace-mcp.ts:1155-1168`). ADR-017 assigns MCP to explicit tool calls and Bifrost to planned model-bound delivery (`docs/docs/references/ADR-017-bifrost-unified-llm-gateway.md:19,29`); ADR-016 describes Hermes' separate direct JSONL ContextEngine path (`docs/docs/references/ADR-016-hermes-context-engine-integration.md:9-18`). Therefore neither `listTools`, an `ace_context` result, nor the real-Qdrant run proves Bifrost provider-wire or automatic Hermes/model context injection.

## Open factual limits

- The provider integration fixture is temporary synthetic source, not this repository's codebase.
- The official SDK process-conformance test uses the source entrypoint with providers disabled; the successful real-provider evidence is a separate local Qdrant/embedding path.
- No evidence in this investigation establishes a selected production embedding/semantic identity, Bifrost final egress, or model-agent E2E.
- No code or configuration was changed during the Research stage.
