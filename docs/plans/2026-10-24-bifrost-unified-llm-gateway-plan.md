# Unified Bifrost LLM Gateway for ACE — architecture and implementation plan

**Date:** 2026-10-24  
**Status:** **Planning only**; no gateway connector, provider-wire certification or production approval is claimed by this document.  
**Owner intent:** Bifrost as the single LLM-gateway frontend for configurable-endpoint agents; ACE Core stays an independent TypeScript/Effect context engine.  
**Decision:** [ADR-017](../docs/references/ADR-017-bifrost-unified-llm-gateway.md) (accepted architectural direction; implementation/evidence conditional).  
**Baseline:** Current ACE `main` must be pinned at implementation start. Reference Bifrost inspection: `maximhq/bifrost@fe7634a6c828927d05ffdd57c62be0aaab04193f` (not a release pin).  
**Existing paths:** ADR-001/014 unified MCP/hybrid Context Engine; ADR-015/016 Hermes primary feedback/native request-only ContextEngine; current `integrations/hermes/ace_context_engine/` and ACE `src/` runtime are retained.

> This is a scoped implementation queue for **gateway context delivery**. It does not replace the consolidated ACE correctness/production roadmap, authorize a production provider selection, or re-label unresolved Harbor evidence as complete. Every implementation slice must have its own reviewable PR to `main`.

## 0. Goal, boundaries and proof obligations

**Goal:** Give different agents one stable, provider-compatible LLM endpoint backed by Bifrost, through which ACE can construct/validate the **actual request-local provider context**, with no mandatory agent fork and no change to the durable agent transcript.

The three independently testable contracts are:

1. **Ingress fidelity:** Go connector sees the complete, authenticated, bounded provider-native request, its protocol, model, route, tenant/workspace authorization and caller identity, or classifies the capability as unsupported.
2. **ACE projection:** TypeScript ACE gets a versioned, authorized snapshot; returns an atomic request-local projection with validated protected fields, source freshness and receipt identity. It never edits the agent's durable transcript or worktree.
3. **Provider egress fidelity:** Before every upstream attempt, including retry/fallback, the effective outbound payload contains the exact intended projection and preserves protected protocol semantics; bypass, silent truncation and unauthorized destination changes are blocked.

**Important distinction:** TLS exists on **agent↔Bifrost** and separately on **Bifrost↔provider**. Bifrost is the endpoint, not a third party tampering with another TLS connection. Payload changes inside the gateway are allowed; provider adapters may reserialize or deliberately rewrite JSON, so inbound-hook success alone is not an upstream-wire guarantee.

### In scope

- Linux Go connector and pinned Bifrost HTTP gateway; macOS feasibility/proven build as a separate compatibility gate.
- OpenAI Chat Completions, Anthropic Messages, then OpenAI Responses; add Gemini native only after those routes are proven.
- Explicit model routing, source and session correlation, request-local context replacement, evidence receipts, security admission, retry/streaming behavior, provider-wire capture, Harbor experiments.
- An agent-neutral ACE Gateway Projection API and conformance suite reusable by a future gateway implementation.
- Existing direct Hermes adapter as an independent conformance baseline, not something to delete or wrap blindly.

### Out of scope for first delivery

- A second TypeScript HTTP reverse proxy; a blanket Bifrost fork; migrating ACE Core to Go.
- Full vendor translation for every model/protocol; arbitrary closed agent traffic interception; transparent handling of server-side history not present in the request.
- Manipulating signed/opaque reasoning states; keeping incomplete logs of tools; altering user source files; automatic permission to send private code to cloud providers.
- Windows compatibility; GUI; broad observability overhaul; claims of 5× savings without paired quality-gated evidence.

## 1. Target architecture and ownership

~~~text
                 [ Agent session and durable transcript ]
                                    |
                        configured model endpoint
                                    |
                           HTTPS (or loopback)
                                    v
        +-------------------- BIFROST (GO) ---------------------+
        |  HTTP ingress / auth / route selection                |
        |      |                                                 |
        |      v                                                 |
        |  ACE Connector (thin Go) <--- local IPC ------------+  |
        |      |                                              |  |
        |      |  accepted projection bytes + digest           |  |
        |      v                                              |  |
        |  protocol-preserving provider request construction   |  |
        |      |                                              |  |
        |  FINAL outbound attempt guard / receipt verification |  |
        +------|-----------------------------------------------|--+
               |                                               |
        HTTPS #2 / provider API                          [ ACE CORE ]
               |                                        TS + Effect
               v                                    retrieval / projection
       [ OpenAI / Anthropic / etc. ]                 authorization / evidence
~~~

**Bifrost owns:** inbound endpoint compatibility, TLS, client auth, upstream credentials, model routing, upstream retries, streaming, circuit breaking and provider API integration.

**Go connector owns:** ingress adapter, capability detection, exact correlation IDs, scoped ACE IPC, applying the returned payload/projection at the chosen extension seam, short-circuit/denial and proof that **all** covered upstream paths were checked. It does not implement retrieval, reranking, memory or its own prompt selection.

**ACE Core owns:** workspace and source validation, retrieval/selection/budgeting, immutable protected-message group rules, policy and authorization decisions, source citations, receipts, projection integrity. Preserve existing Effect dependency/typed error model; gateway transport DTOs live at the application/adapters boundary.

**Agent-native Hermes adapter owns:** its own request-local projection via `ContextEngine` for the Hermes reference arm. Do not run native and gateway projection simultaneously on the same request without a proven single authoritative projection ID and idempotent composition.

### Authoritative single-delivery invariant

Each model request has one `projectionMode` among `native`, `gateway`, `assist-only`, `observe-only` or `off`. If `gateway` is selected, MCP contextual retrieval remains available but cannot silently inject a second, competing model context. A side channel may supply agent state **only** with authenticated session binding. This is not permission for an arbitrary HTTP header to select a different workspace.

## 2. Public endpoint contract versus internal ACE contract

Keep **two** deliberately distinct APIs:

- **Northbound Bifrost endpoint:** existing protocol-native agent-facing interfaces (for example `/v1/chat/completions`, `/v1/responses`, `/v1/messages` where supported by the exact configured Bifrost build). Avoid inventing an agent-specific `ACE API` that would require changing agent SDKs.
- **Southbound ACE Gateway Projection v1:** a versioned local adapter protocol, independent of Bifrost Go types. Wire transport recommendation: authenticated Unix-domain HTTP where colocated; loopback HTTP only if process/security constraints require it. TLS/mTLS for separated hosts.

### Proposed ACE API (contract-design input, not implemented)

- `GET /internal/ace-gateway/v1/capabilities` — exact supported schema, protocol + route matrix, policy mode, optional max bytes, runtime/build identities. Handshake at startup; fail if versions cannot be negotiated.
- `POST /internal/ace-gateway/v1/project` — a single idempotent request-local projection, deadline/cancellation bound, no persistent transcript mutation.
- `POST /internal/ace-gateway/v1/record-delivery` — optional *verified* attempt-level wire observation with projection digest, provider/model/route and receipt. Never accept an unverified client's claim as proof of actual wire delivery.
- `GET /internal/ace-gateway/v1/health` — liveness distinct from capability/readiness; an alive process with an unsupported route is **not** ready.

Example logical projection request (exact schema to be finalized in OpenSpec; illustrative only):

~~~json
{
  "schemaVersion": "ace.gateway.v1",
  "requestId": "req-unique",
  "attemptGroupId": "req-unique",
  "agent": {"kind": "opencode", "sessionId": "bound-session"},
  "authenticatedScope": {"workspaceId": "server-resolved-id", "dataClass": "private"},
  "request": {
    "protocol": "openai.responses",
    "model": "provider-model-id",
    "requestedProvider": "approved-provider",
    "bodyEncoding": "base64",
    "bodyBase64": "<redacted in this example>",
    "bodySha256": "64-lowercase-hex-digest"
  },
  "projectionMode": "gateway",
  "deadlineEpochMs": 0,
  "capabilities": ["request-local", "protected-groups", "provider-native-payload"]
}
~~~

**Identity/security:** `authenticatedScope` is **resolved and asserted by the trusted gateway**, never accepted directly from an untrusted model prompt, arbitrary request header or JSON field. Do not forward Authorization or upstream API keys into ACE. Forward only allowlisted protocol headers needed to interpret the request; secrets remain owned by Bifrost. Use a separate authenticated mapping for session/workspace/tenant; reject conflicts or unknown mappings. Scrub private payloads from traces, errors and saved receipts.

**Response decision union** (illustrative):

- `APPLY` — transformed provider-native body bytes (or a validated pointer to a protected, local artifact), `baseBodySha256`, `projectedBodySha256`, `projectionId`, `receiptId`, selected and protected evidence identities, supported route/representation.
- `UNCHANGED_AUTHORIZED` — explicit, policy-approved decision to forward with no alteration; **never** default from missing ACE or parse error.
- `DEGRADED_AUTHORIZED` — typed partial provider availability and bounded, visibly degraded context consistent with ADR-007.
- `BLOCK` — typed category: `policy_denied`, `unsupported_protocol`, `server_side_state_unknown`, `invalid_request`, `protected_group_invalid`, `identity_mismatch`, `ace_unavailable`, `deadline_exceeded`, `projection_digest_mismatch`, etc.

An `APPLY` result must be bound to the **exact original bytes** with `baseBodySha256` (optimistic CAS), exact authenticated scope, destination class, effective route and timeout. Reject stale/out-of-order results and replay across sessions. Returned bytes are validated before replacing the input; a receipt alone never authorizes egress.

**Wire format guidance:** Keep a provider-native envelope containing the original JSON/binary form. Preserve unknown field values and opaque items; use parsed copies for ACE reasoning and schema validation. Avoid naive "array of {role, content}" round-tripping. Decide in implementation whether a constrained JSON patch over original bytes or a fully validated returned body best preserves opaque data; record actual serialization behavior in contract tests. In neither case blindly trust a replacement to retain all controls.

## 3. Capability negotiation and route classification

Do not make blanket claims such as "Bifrost supports lossless Responses". Version every capability by **agent integration × inbound protocol × upstream provider/model family × Bifrost build × processing mode × streaming/continuation mode**.

| Level | Name | Guarantee |
|---|---|---|
| G3 | `FULL_PROVIDER_CONTEXT` | Request-local system/developer/user/assistant/tool context projection, protected group validation, no hidden provider-held history, attempt-level egress proof |
| G2 | `GATEWAY_VISIBLE_ONLY` | Replace *all visible admissible request parts* but unseen continuation/provider state excluded; explicitly not advertised as full |
| G1 | `CONTEXT_ASSIST` | MCP/skills/explicit tools; agent chooses what goes into context |
| G0 | `OBSERVE_ONLY` | Logs/metrics/ingestion only, no substitution |

A route may be `structured` (typed Bifrost request + conversion) or `native_passthrough` (original provider-native body). A flag named "raw" does **not** establish G3. `native_passthrough` may still rewrite ``thread`, `model`, `max_tokens`, signed billing fields or unsupported structures, so require an allowlist of permissible changes plus evidence.

**Block strict G3** when:
- Response continuation refers to hidden provider-side state (`previous_response_id`, provider-managed thread, etc.) and no authorized complete history is available.
- A signed/encrypted reasoning carrier would be invalidated or changed; preserve it untouched or refuse the transform.
- A provider conversion drops or alters a required tool/result pair, message role, control instruction, multimodal reference or unknown must-preserve field.
- The inbound hook lacks a complete body (large/streaming request case), Bifrost sends a different body on retry/fallback, or provider requests bypass inspection.
- Destination model/provider violates current workspace/data-class egress rules.

### Initial route order

A. **P0 spike:** one pinned Bifrost build, OpenAI Chat Completions to matched OpenAI-compatible mock upstream (buffered + streaming).

B. **First implementation candidate:** OpenAI Chat Completions with complete explicit history, tools and no provider-managed continuation.

C. **Second:** Anthropic Messages native (including thinking/signature/tool blocks) with raw-body behavior tested and explicitly permitted rewrites.

D. **Third:** OpenAI Responses with explicit `input`, tool outputs and reasoning carriers; blocked on provider-held continuations without reconstructible state.

E. **Later:** Gemini native, Bedrock/Vertex transports, protocol translation, prompt caching edge cases, multimodal/video/realtime.

## 4. Bifrost seam selection and hardening checklist

Reference static inspection (`fe7634a6...`, `dev`, re-pin for implementation):

1. `HTTPTransportPreHook`: `HTTPRequest.Body []byte` can be modified; `applyHTTPRequestToCtx` installs it as actual fasthttp body. On body-snapshot skip for large/unknown Content-Length, there is **no complete request** for ACE to project. Enforce explicit route rejection, a streaming parser with bounded resources in a scoped follow-up, or policy-approved G0/G1 downgrade. Do not silently forward under G3.
2. `HTTPTransportPreHook` returns response/error to prevent further processing in HTTP transport; check Bifrost plugin order and ensure ACE guard cannot be superseded by a later hook. Deny before provider network dial on blocked/malformed/expired decisions.
3. `PreRequestHook` runs once before per-attempt routing and is suitable for normalized-state invariants; `PreLLMHook` runs for every fallback attempt and may see changed provider/model. If projection is made once, re-authorize and revalidate **each attempt** before send.
4. `RawRequestBody` requires appropriate route/context wiring and can still be rewritten. Verify how Bifrost stores the raw body *after* the HTTP hook. Never assume editing normalized messages also changes raw bytes used by provider.
5. Run raw/typed comparisons on real final outbound bytes. If Bifrost cannot expose a verifiable final-send seam for a supported route, fail G3 certification: add a narrow Go transport hook/patch with tests **only after** this negative finding and ADR review, or use a separately approved scoped native adapter.
6. Streaming *response* should flow through Bifrost without ACE blocking each SSE chunk; ACE transforms the **request before** the provider call. Streaming *request body* has a separate, explicit admission limitation. Protect cancellation, backpressure, timeout, final event ordering, tool-call fragments and usage events.
7. Plugin packaging: pin Bifrost source/tag/Go toolchain/module dependencies; build Go plugin against the same release/toolchain. Start Linux/amd64 and Linux/arm64 as needed; test Darwin separately if chosen. No dynamic module hot reload requirement. Avoid Bifrost dev-branch drift in production manifests.
8. Gateway should be the **only configured egress path** for a G3 agent run. Internal ACE provider calls must not recursively re-enter the same projection pipeline; route them via separately authorized, explicitly identified service identities and validate destination policy.

## 5. Protected transcript/protocol invariants

Define a typed protected-group validator and adversarial fixtures **before** permitting any provider call.

- **Control plane:** preserve system/developer instructions, approved safety/permission controls and the distinction between instructions and untrusted retrieved content; ACE may add evidence but must not silently strip higher-priority policy.
- **Tool graph:** maintain call IDs, function names, arguments, matching results, order, parallel calls, partial results and cross-message dependencies. If a tool message is removed, dependent messages must be handled as one proven coherent group or the projection rejected.
- **Reasoning:** preserve provider-specific reasoning/encrypted content/signature fields, handoff data, cache/replay metadata and opaque bytes; do not summarize or restructure protected opaque carriers.
- **Multimodal:** preserve valid image/audio/file references, MIME/content descriptors and model-recognized provenance. Unknown unsupported content is not permission to drop it.
- **Source truth:** current verified workspace bytes override stale index. Long code artifacts are stored losslessly in worktree/original archive and remain exactly expandable; no arbitrary mandatory truncation.
- **Budgets:** calculate model limits and output reserve from effective route/model metadata. Never silently drop protected content to meet budgets; block or require explicit smaller, safe projection.
- **Durable state:** preserve stored agent transcript outside gateway. Test process/session replay and hashing before/after calls; distinguish provider-side state from local agent state.

## 6. Failure model, privacy and security

| Condition | Strict G3 behavior | Evidence |
|---|---|---|
| ACE unreachable, malformed response, timeout, cancelled | **Block** upstream, with typed error and correlation ID | No mock-upstream requests; failure record |
| Policy denied, forbidden data class, credential leak | **Block**, no alternate provider | Destination + data-class admission evidence |
| Required source stale/missing | Block or explicitly authorized degraded projection; do not claim `complete` | Source freshness / selected and omitted IDs |
| Unsupported tool/reasoning block or hidden thread | **Block G3**, return capability reason | Provider-native fixture and validator |
| Retry/fallback changes model/provider | **Reauthorize each attempt**; stop unsafe reroute | Every attempted egress record |
| Replay / stale projection digest | **Block**, no reuse across unauthorized identity | Bound digests + session/attempt fields |
| Partial stream / disconnected client | Cancel upstream; no false delivered receipt | Stream lifecycle receipts |
| Gateway bypass / missing connector registration | **Fail startup or enforce network egress guard** for certified G3 run | Network/actual wire verification |

Two separate failure classes:

- **Authorization/data-residency/protected-integrity failure:** always fail closed, regardless of strict/degraded operational mode.
- **Ordinary retrieval/provider outage:** per ADR-007, can return an explicit safely degraded **authorized** projection. In strict acceptance experiments, require verified ACE participation and do not pretend an unmodified request is an ACE success.

**Secrets:** Bifrost owns upstream auth material; never forward raw upstream Authorization headers to ACE, logs, task traces or receipts. Test prompt injection attempting to override gateway/workspace policy. Limit max input bytes, payload decompression ratio, body scan time, IPC deadline and concurrency. Apply least-privilege Unix socket ACLs, owner-checked socket path, pinned container images, reproducible artifacts and redacted security logs.

## 7. Projection receipts, egress evidence and metrics

Receipt fields (all request-bound, no raw prompt/code/keys):

- `gatewayBuildDigest`, `connectorBuildDigest`, `aceBuildDigest`, `schemaVersion`, exact Bifrost version+commit+config digest;
- `requestId`, `agentSessionId`, `turnId` if known, `attemptIndex`, `attemptGroupId`, `projectionId`, effective model/provider/protocol, authentication scope;
- original body SHA-256, returned projected body SHA-256, **captured effective outbound body SHA-256** and named **permitted wire rewrites**;
- source workspace revision, selected evidence IDs/digests and source freshness, capability level, policy decision/status, timestamps/deadline;
- model request and response correlation IDs, actual usage provenance (input/output/cached tokens) with ``measured` / `estimated` / `unknown`, latency and failure reason.

**No fake proof:** A plugin's statement "I applied the projection" is `adapter-implemented` evidence, **not** `provider-wire-tested`. The latter requires mock upstream capture and byte/semantic comparison at the actual final network boundary. A post-hook receipt that is never linked to a real upstream attempt must be `not_delivered` or `unknown`.

**No double counting:** Provider calls, Bifrost retries, ACE projection calls, cache hits, embeddings/reranking cost, stream usage events and agent-visible tokens are separate counters. Do not add ACE transform receipts to totals already including those calls. Define per-attempt and per-task aggregations with invariants in OpenSpec.

## 8. Implementation sequence (one reviewable PR per slice)

Do not run the following queue in parallel with changes to shared acceptance/specs that are not yet reconciled. Before any source PR, audit current runtime/code/OpenSpec against accepted ADRs, then add normative OpenSpec requirements and expected test owners. The timings are **rough engineering effort estimates**, not commitments.

| Slice | Purpose and planned deliverable | Prerequisite | Rough effort | Gate |
|---|---|---|---|---|
| **G0** | Read-only Bifrost source/wire spike; pin candidate build, map routes/hook order, generate request/response fidelity matrix against capture upstream | ADR-017 | 1–3 eng. days | Reproducible static+wire report; explicit unknowns |
| **G1** | OpenSpec capability + JSON schema `ace.gateway.v1` and version/capability negotiation, typed errors, privacy/authority model; no runtime behavior changes | G0 | 2–3 days | Contract review, invalid-input fixtures, owner resolves open decisions |
| **G2** | ACE TypeScript/Effect gateway application port and IPC endpoint using existing context engine; request-local projection and exact SHA binding | G1 | 2–4 days | Deterministic contract tests, no original transcript/worktree writes |
| **G3** | Thin Go Bifrost HTTP hook connector, bounded IPC, route allowlist, strict short-circuit, startup registration/readiness | G2 | 2–4 days | Blocked requests produce zero upstream calls; dependency outage tests |
| **G4** | OpenAI Chat Completions full explicit-history adapter, protected groups, provider-native fidelity, streaming requests/responses baseline | G3 | 3–5 days | Mock upstream actual wire capture; tools/system/unknown fields preserved |
| **G5** | Attempt-level egress guard/receipts, retries, fallbacks, cancellations, credential/identity and data-class controls; large input denial | G4 | 3–5 days | No bypass on every enabled provider path; negative security cases |
| **G6** | Anthropic native and OpenAI Responses routes, reasoning/signatures/opaque items, continuation capability downgrades | G5 | 4–7 days | Per-route certified matrix and negative replay/hidden-state cases |
| **G7** | Real Hermes/OpenCode/Pi agent E2E as applicable; matched Harbor comparison with identical model/task/runtime, measured overhead and quality | G6 | 3–6 days + environment | Real provider path, raw trial receipts, no unsupported quality claims |
| **G8** | Linux packaging, pinned config/runbooks, rollback, macOS feasibility (optional), final security/economics review | G7 | 2–4 days | Exact-commit release checklist and explicit owner signoff |

These slices may be split/merged **only** where the review diff stays narrow and gates remain independently inspectable. No code deletion or migration of existing native Hermes path is implied.

### Deliverables by directory (proposal; not created by this plan)

- `docs/docs/references/ADR-017-bifrost-unified-llm-gateway.md` — durable architecture choice.
- `docs/plans/2026-10-24-bifrost-unified-llm-gateway-plan.md` — this scoped plan.
- `openspec/changes/<gateway-change>/proposal.md`, `design.md`, `specs/*/spec.md`, `tasks.md` — normative requirements, typed error/failure and conformance scenarios.
- `src/application/<gateway-projection-port>` and `src/adapters/<gateway-projection-http>` — ACE Core adapter(s), not Go domain logic.
- `integrations/bifrost/` — isolated Go connector, pinned Bifrost build instructions and smoke fixtures.
- `test/<gateway-contracts>`, `benchmarks/<gateway-conformance>` — fixture-driven contract and provider-wire evidence.
- `docs/operations/<gateway-runbook>` — validated install/config/rollbacks and supported-route list.

Before adding directories/files, inspect existing equivalents and avoid duplicate test portfolios or competing transport implementations.

## 9. Conformance suite / acceptance matrix

Every route claims its maximum G-level **only after** all applicable checks pass:

| ID | Verification | Expected observation |
|---|---|---|
| GW-01 | Complete JSON with system/developer, prior messages and tool graph; ACE replaces selected historical context | Final mock upstream receives intended request-local projection; saved agent history unchanged |
| GW-02 | Unknown nested provider fields / large numeric literals / opaque reasoning signature / preserved multimodal content | No silent loss, precision change or mutation of protected data |
| GW-03 | Sequential and parallel tool calls, matching tool results, partial/cancelled tool responses | Valid linkage/order; invalid projection blocked |
| GW-04 | Provider-native Chat vs Anthropic vs Responses, with and without streaming | Protocol-valid upstream bytes and correctly forwarded ordered SSE/events |
| GW-05 | Provider-managed continuation (`previous_response_id`, thread), hidden history or encrypted state | Honest G2/`unsupported` result; never a false G3 |
| GW-06 | Bifrost fallback retry switches provider/model or changes serialization | Every attempt authorized and checked; no uninspected/unauthorized network call |
| GW-07 | ACE timeout, connection refused, invalid JSON, mismatched SHA, expired deadline, replay | Strict blocked path: **zero** upstream provider calls |
| GW-08 | Unapproved private-workspace/cloud destination or secret in context | Denial with redacted audit, no cloud egress, no fallback bypass |
| GW-09 | Oversized, chunked or streaming *input* where HTTP hook body snapshot is empty | Explicit deny/unsupported, not invisible G3 bypass |
| GW-10 | Plugin absent, disabled or misordered; direct egress attempt | Strict run fails readiness or network guard; no false evidence |
| GW-11 | Concurrent sessions, cancellations, process crash/restart and duplicate requests | Correct binding/dedup, no stale cross-session projection or false receipt |
| GW-12 | Natural, unforced agent tasks through real provider and Harbor matched baseline | Observed full attribution and task success, token/cost/latency evidence; no 5× claim without results |
| GW-13 | Native Hermes arm versus gateway Hermes arm on same explicit tasks/model identity | No double injection, correlated request-local projection and unchanged durable transcript |
| GW-14 | Linux packaging and optional macOS matched toolchain | Reproducible plugin load, Bifrost SHA, rollback and platform-specific support claim only when tested |

**Test layers**: pure property/contract fixtures → pinned Bifrost + mock provider wire capture → real provider sandbox (authorized data only) → real coding agent E2E → paired Harbor. Report `PASS`, `FAIL`, `BLOCKED` and `NOT_RUN` separately per route and effective commit; mock-only tests cannot promote production.

### Measure gateway economics independently

Record: extra ACE service round trips, gateway overhead p50/p95, overhead under concurrent streams, input/output/cached token usage, repeated-evidence bytes, embedding/reranking cost, retry amplification, timeout rate, accepted task rate. Primary metric = **quality-gated total cost per accepted task**, not Bifrost overhead in isolation.

Define the baseline arms: unmodified agent direct provider; agent→Bifrost with ACE disabled (isolates gateway overhead); agent→Bifrost→ACE; native Hermes ContextEngine→ACE for comparison. Same agent/model/reasoning/task/environment where comparisons are valid; no cross-agent apples-to-oranges claim.

## 10. Definition of done and decision points

### Engineering completion for gateway v1

- [ ] ADR accepted direction and scoped OpenSpec requirements are reviewed and linked without contradicting existing architecture.
- [ ] A pinned Bifrost binary/plugin build is reproducible on the chosen Linux target.
- [ ] One supported protocol route passes ingress + projection + **actual provider-wire** conformance, including strict failure behavior.
- [ ] Connector can call ACE via authenticated, bounded local IPC without passing credentials or implementing ACE retrieval.
- [ ] Every certified outbound attempt is reauthorized and tied to original, projected and effective wire digests.
- [ ] An agent can configure Bifrost as its model endpoint without an ACE-specific fork, and real E2E proof is retained.
- [ ] Existing Hermes ContextEngine remains functional; no double projection or silent competition with MCP context delivery.
- [ ] Operational runbook shows startup/readiness, credential rotation, audit redaction, timeout/cancellation and rollback.
- [ ] No production-ready or 5× claim without the separate quality/provider/Harbor gates and owner approval.

### Explicit decision checkpoints (do not decide by implementation inertia)

- **D1 after G0:** Which Bifrost tag/commit is pinned, and is `HTTPTransportPreHook` enough for the first supported provider route? Record exact source and an actual captured wire fixture.
- **D2 after G1:** Should the ACE API return whole validated native bytes or bounded JSON patches onto original bytes? Decide from unknown-field preservation/validation evidence.
- **D3 before G5:** How is a verifiable **final-send egress guard** enforced with fallbacks in this Bifrost release? If unavailable, limit the G-level or propose a minimal tested Bifrost patch via follow-up ADR.
- **D4 before G6:** Are provider-native Responses reasoning/continuation cases certifiable? If not, keep them explicitly G2/unsupported, not "best effort G3".
- **D5 before G8:** Approve/reject a particular protocol+build for production based on retained wire, security, E2E, cost and owner evidence.

## 11. Research references and non-proof caveat

Bifrost static sources inspected (candidate, **not** a production endorsement):

- [Bifrost HTTP plugin contracts](https://github.com/maximhq/bifrost/blob/fe7634a6c828927d05ffdd57c62be0aaab04193f/core/schemas/plugin.go)
- [HTTP transport body snapshot / application](https://github.com/maximhq/bifrost/blob/fe7634a6c828927d05ffdd57c62be0aaab04193f/transports/bifrost-http/handlers/middlewares.go)
- [Bifrost generic HTTP router](https://github.com/maximhq/bifrost/blob/fe7634a6c828927d05ffdd57c62be0aaab04193f/transports/bifrost-http/integrations/router.go)
- [OpenAI Responses conversion](https://github.com/maximhq/bifrost/blob/fe7634a6c828927d05ffdd57c62be0aaab04193f/core/providers/openai/responses.go)
- [Anthropic raw request builder](https://github.com/maximhq/bifrost/blob/fe7634a6c828927d05ffdd57c62be0aaab04193f/core/providers/anthropic/requestbuilder.go)
- [Native plugin guide](https://github.com/maximhq/bifrost/blob/fe7634a6c828927d05ffdd57c62be0aaab04193f/docs/plugins/writing-go-plugin.mdx)

**Evidence status at authoring:** Static inspection supports seam availability and identifies fidelity hazards. No new Bifrost plugin, API route, wire-capture suite, real-provider test, Harbor run or production approval was performed by creating this document.
