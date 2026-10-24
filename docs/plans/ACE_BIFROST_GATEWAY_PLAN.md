# ACE × Bifrost LLM Gateway — architecture and delivery plan

**Status:** Proposed / design baseline. **Owner:** ACE. **Scope:** agent-independent context delivery, not a rewrite of ACE or of Bifrost.
**Decision:** Bifrost is the provider gateway; ACE is a separately deployed context compiler. A thin Go connector provides the interoperability boundary. No source-code, runtime, FFI, or language dependency between the two services.
**Related work:** Hermes context-engine integration and Harbor evidence; the gateway is an alternative delivery adapter, not a replacement for the native Hermes adapter.

## 0. Executive decision

The long-term goal is to run one ACE context-selection/compaction/retrieval implementation for Hermes, Pi, OpenCode, and future coding agents. Native hooks offer the most reliable state visibility when present. The Bifrost route serves agents that can point their model-provider base URL at a managed endpoint but do not expose a request-local context hook.

The **ACE Context Protocol** (agent-independent) and **ACE Gateway Protocol** (Bifrost connector ↔ ACE service) are distinct contracts. Bifrost owns credentials, provider routing, HTTP transport, retry/fallback policy, and streaming. ACE owns evidence acquisition, memory, source provenance, context budget, projection compilation, and the associated receipts. The Go connector is a deliberately small protocol client, NOT a second ACE implementation.

**No silent degradation:** a full-context route must produce an outbound verified projection or reject the request. An append-only or MCP fallback must be explicitly labelled as a lower capability tier.

## 1. Non-goals and boundaries

- Do not fork Hermes, OpenCode, or Bifrost solely to deliver ACE context.
- Do not translate the ACE core from TypeScript to Go.
- Do not log prompts, provider API keys, OAuth tokens, signed reasoning blocks, or unredacted tool output in receipts.
- Do not promise transparent support for every provider-specific field. Unsupported protocols/models/features are blocked (or explicitly run without ACE outside strict evaluation).
- Do not rewrite a coding agent's persisted conversation; the replacement is **request-local**.
- Do not claim an end-to-end Harbor or production result from unit tests.
- Do not attempt to MITM TLS. The agent talks to the Bifrost TLS endpoint; Bifrost initiates a separate upstream TLS connection.

## 2. Runtime deployment

```text
                         native context adapters (Hermes/Pi/OpenCode)
Coding agent ─────────────────────────────────────────────────────────► ACE Context API
     │                                                                    ▲
     │ provider base_url = Bifrost                                        │
     ▼                                                                    │
Bifrost HTTPS ingress                                                     │
     │                                                                    │
     └── ACE Go connector (HTTPTransportPreHook: request body) ──HTTP/UDS─┘
                  │
                  ├─ verified ContextProjection + receipt
                  ├─ validation and failure gate
                  ▼
        Bifrost parse/route/provider adapter
                  │
         final outbound request checks
                  │
          HTTPS to LLM provider
                  │
       SSE / streaming response to agent
```

Local development: Bifrost and ACE may run on Linux as separately managed processes; use a Unix domain socket where practical. Production: separate containers with mutually authenticated service identity and network policy. macOS support may use the same external HTTP/UDS contract. A Go plugin must be rebuilt against its **pinned Bifrost version**, but ACE need not be.

## 3. Capability negotiation and route classification

A route is identified by `(agent, agentVersion, ingressProtocol, provider, modelFamily, transportMode, featureSet)`.

| Tier | Delivery | Meaning |
| --- | --- | --- |
| L3 native | Agent context hook | Can replace full provider-bound transcript with agent state; persisted transcript remains intact |
| L2 gateway/verified | Bifrost connector | Can replace all **visible** provider-request content; final wire payload passes conformance and egress guards |
| L2 gateway/limited | Bifrost connector | Selected fields can be rewritten but opaque provider state or conversions limit control; explicitly reported |
| L1 assist | MCP/skills/context files | Agent chooses if/when to use retrieved context; NOT full replacement |
| L0 observe | Telemetry only | No intervention |

The route registry must declare:
- `supportsFullInputReplay`, `supportsOpaqueReasoning`, `supportsToolCallRoundTrip`, `supportsMultimodal`, `supportsRequestLocalReplace`, `supportsStrictEgress`, `supportsStreaming`, and `supportsFallbackRevalidation`.
- A pinned adapter/Bifrost/provider version or commit and the corresponding test-case IDs.
- An explicit reason why unsupported features are blocked.

Do not infer coverage from the presence of a hook alone. An external provider-managed continuation (e.g. opaque `previous_response_id` with missing transcript) is NOT full-context-capable without authoritative replay state.

## 4. Versioned protocol between the Go connector and ACE

Propose `POST /v1/gateway/project`; transport can be HTTP+JSON over UDS or private TLS. Schema and fixtures live in `contracts/ace-gateway/v1`. Schema changes are explicit and backward-compatible within v1. This is a **design contract**, not implemented API.

Example request (field descriptions, not a literal test fixture):

```json
{
  "schemaVersion": 1,
  "deliveryMode": "strict",
  "requestId": "stable-idempotency-key",
  "attemptId": "attempt-1",
  "sessionId": "opaque-session-id",
  "turnId": "opaque-turn-id",
  "agent": { "name": "opencode", "version": "pinned" },
  "route": {
    "ingressProtocol": "anthropic-messages",
    "provider": "anthropic",
    "model": "example-model",
    "outboundProtocol": "anthropic-messages",
    "capabilityProfileId": "anthropic-messages-v1"
  },
  "workspace": { "workspaceId": "opaque-id", "sourceRevision": "commit-sha" },
  "budget": { "contextWindowTokens": 200000, "reservedOutputTokens": 8192 },
  "input": {
    "mediaType": "application/json",
    "providerNativeBody": {},
    "sourceBodySha256": "64-hex-digest"
  },
  "privacy": { "allowRawPromptsInReceipts": false }
}
```

The connector **never** forwards upstream `Authorization` or virtual-key secrets into the ACE request. Its request IDs, source digest, and route metadata are assigned by a trusted gateway, not by untrusted prompt text.

Successful response:

```json
{
  "schemaVersion": 1,
  "requestId": "stable-idempotency-key",
  "status": "ready",
  "projection": {
    "mediaType": "application/json",
    "providerNativeBody": {},
    "projectionSha256": "64-hex-digest"
  },
  "receipt": {
    "receiptId": "opaque-receipt-id",
    "sourceBodySha256": "64-hex-digest",
    "evidenceSetSha256": "64-hex-digest",
    "projectionSha256": "64-hex-digest",
    "policyVersion": "pinned",
    "compilerVersion": "pinned"
  },
  "limitations": []
}
```

Failure response: `status = "blocked"`, stable `reasonCode`, no projection. Partial delivery is only allowed when a route has explicitly negotiated partial coverage; never reinterpret blocked as "send original context." An idempotent retry of the same request/projection context returns the same projection identity. HTTP timeouts, size caps, cancellation, and backpressure are mandatory.

Avoid a lossy generic `{role, content}` intermediate format. Use a typed Context IR for operations that are known-safe, and opaque provider-specific extensions for fields which must be preserved verbatim. For full-body replacement, allow the provider-native JSON shape to survive unchanged outside explicitly authorized projection paths.

## 5. Hook selection and zero-bypass delivery

1. **After Bifrost authentication**, the connector's `HTTPTransportPreHook` sees `HTTPRequest.Body []byte` for normal buffered HTTP requests.
2. Authenticate connector-to-ACE, construct the request metadata, ask ACE to compile a projection, and replace `req.Body`. Refuse if ACE is unavailable, times out, returns an invalid receipt, violates budget/protected-message invariants, or cannot understand the payload.
3. The Bifrost transport writes the modified body back to the HTTP request. This is only the *first* verification boundary.
4. Bifrost may subsequently parse into `BifrostRequest`, route, lower to provider-specific shape, rewrite model/max_tokens, or otherwise transform the request. Do not assume body byte equality implies outbound equality.
5. For strict routes, a final outbound egress guard must inspect the **actual provider-bound body** (or a cryptographically bound validated projection of it) immediately before network send. Reject if a required context element was silently dropped, mutated outside the allowed delta, or the projection receipt is missing.
6. `PreLLMHook` executes on each provider attempt/fallback, so bind attempt IDs to context identity and revalidate each attempt. `PreRequestHook` can be used for request-wide normalization consistency, not by itself for a final-wire guarantee.
7. If Bifrost lacks an appropriate enforceable final-wire hook for a route, classify the route as unsupported for L2 strict. Only then consider a minimal, isolated provider-native passthrough path, preferably within Bifrost rather than a second gateway.

**Important known Bifrost behavior at time of design:** the transport hook permits body changes; very large/chunked payloads may skip copying into `HTTPRequest.Body`; raw passthrough can still rewrite fields such as Anthropic `thread`, `model`, and `max_tokens`. OpenAI Responses lowering can rewrite or drop certain protocol-specific blocks. These are explicit capabilities to test, not surprises after deployment.

## 6. Preservation/invariants

- Protected system/developer instructions and user-granted permissions are never dropped or weakened by context selection.
- Tool call ↔ result IDs, order, multipart messages, streamed tool invocations, and control-flow correlations remain well-formed.
- Opaque reasoning items, signatures, continuation IDs, and multimodal attachments are either preserved under a validated protocol rule or cause L2 strict to refuse the request.
- For any projection, record an allowlist of intentional deltas: context candidate selection/replacement, budget changes when explicitly allowed, safe model alias normalization. Reject unapproved deltas.
- Never reconstruct provider-managed history without full trustworthy replay; choose L1/limited mode or reject.
- Streaming responses are relayed with correct ordering, cancellation, EOF/usage accounting, backpressure, and provider-specific SSE framing.
- Do not collapse retry/fallback attempts into one provenance identity; associate all attempts with original request and selected projection.
- Preserve agent-side durable history; only the outgoing model request is changed.

## 7. Security, policy, and operations

- Authenticate ACE service requests; use UDS peer permissions locally and mTLS or equivalent service identity remotely.
- Scrub provider/agent credentials and untrusted headers from any body sent to ACE; the body may still contain sensitive prompt data, so enforce retention and tenancy isolation.
- Never log raw prompts or tool output in default telemetry; receipts store digests and provenance pointers.
- Validate workspace identity and path scope; distinguish source evidence from lower-trust repository comments, webpages and tool output.
- Fail closed for strict mode, including stale plugin, missing ACE daemon, body-copy bypass, unknown provider field, model switch or fallback.
- Disable bypass routes and fail-open "direct provider" egress in strict evaluation; outside strict mode, explicit bypass must be separately configured and reported.
- Pin Bifrost release/commit, plugin binary digest, ACE release digest, contract version, model config, provider route, test fixtures and run manifest.
- Timeouts: separate connection, projection, provider, idle-stream deadlines. Context generation timeout must never cause an unverified original request to be forwarded.
- Bound payload size, concurrent ACE compilations and cache cardinality; stream large body inputs or explicitly reject until supported.
- Expose metrics: `ace_projection_applied`, `ace_gateway_blocked`, `ace_egress_bypass`, `ace_dropped_field`, `ace_fallback_revalidation`, TTFT, end-to-end latency, token input/output and cost.

## 8. Required conformance matrix

For each supported protocol/model family:
1. Ordinary Chat Completions roles and fully replacing an existing message (not appending text).
2. Anthropic Messages system array, tool_use/tool_result IDs, caching metadata, reasoning and signatures.
3. OpenAI Responses input items, function calls and outputs, reasoning items, `previous_response_id` with and without replayable state.
4. Unknown nested provider-native fields and experimental fields.
5. Multimodal images or file references; unsupported cases must be blocked, not flattened.
6. Long input and chunked-body transport (must not bypass plugin or preflight).
7. Streaming SSE, incremental tools, client cancellation, backpressure, usage-only final chunk.
8. Provider fallback and multiple attempts, including model/protocol changes.
9. ACE timeout/crash/unavailable, invalid UTF-8/JSON, oversized response, wrong requestId/digest/receipt.
10. Baseline without ACE versus projected output and unmodified agent persisted session.

Run mock-upstream capture to compare **actual outbound JSON** with the expected provider-native projection using schema-aware semantic diff. A separate packet/HTTP capture at the mock endpoint supplies evidence. Unit-level hook tests alone are insufficient. Define an acceptance threshold of **zero silent losses of protected/opaque/tool fields and zero unverified outbound sends**.

## 9. Work packages / milestones

### M0 — Inventory and pinned reference (2–3 engineering days)

- Pin a Bifrost commit and inspect ingress, transport hook, normalization, request conversion, retry/fallback, and final provider request construction for the selected protocols.
- Build a capability registry and adversarial fixtures.
- Deliverable: architecture decision record, protocol risk matrix and capture-based test plan.
- Gate: every required route has an identified enforcement point or is explicitly blocked.

### M1 — Protocol and ACE contract (3–5 days)

- Define the v1 JSON schemas, machine-readable compatibility policy, receipts, errors, deadlines, idempotency keys, and threat model.
- Implement a standalone TypeScript Context Compiler adapter reusing ACE retrieval and provenance; no Go packages imported into ACE.
- Implement deterministic mock ACE projection service for isolated tests.
- Gate: protocol compatibility tests, payload-size bounds and malformed-input tests pass.

### M2 — Minimal Go connector + Bifrost ingress (4–7 days)

- Implement the Bifrost Go plugin as a thin HTTP client with auth, cancellation, body replacement and short-circuit on failure.
- Initially support ONE pinned route, e.g. OpenAI-compatible Chat Completions over explicit full-history requests.
- Implement required final-wire guard or keep the strict capability disabled until it exists.
- Gate: real upstream capture demonstrates request-local replacement, unchanged persisted history, no bypass on ACE failure.

### M3 — Responses and Anthropic native support (5–10 days)

- Add independent native payload fixtures and protocol-aware validation for Responses and Anthropic Messages.
- Test opaque reasoning, tool results, server-side state, multi-modal, raw passthrough and provider fallbacks.
- Record unsupported features as explicit capability denials, not undocumented degradation.
- Gate: all strict-route conformance assertions pass with streamed and non-streamed requests.

### M4 — Agent integration and Harbor/ACE metrics (4–7 days)

- Point one non-Hermes agent at the Bifrost endpoint, retain Hermes native route as independent reference, and compare equal workloads.
- Separate performance improvements due to compiler from state visibility differences between adapters.
- Capture outbound payload, receipts, token savings, retrieval relevance, latency, task success and fallback rates.
- Gate: reproducible no-ACE baseline versus ACE Gateway run with independently audited egress receipts.

### M5 — Beta hardening and release (5–10 days)

- Add upgrade/conformance CI, plugin binary pinning, staged rollout, observability, rate limiting, tenant isolation and runbooks.
- Chaos-test failure behavior, throttling, interrupted streams, bad certificates and agent restarts.
- Gate: a release candidate on Linux; macOS local-development smoke; dependency and security review complete.

**Estimate:** roughly 23–42 engineer-days, excluding uncertain provider-specific reverse engineering and full benchmark runtime. Milestone durations are planning ranges, not commitments. Delivery can ship M2 as a narrow alpha without claiming universal protocol support.

## 10. Repository deliverables

- `contracts/ace-gateway/v1/`: JSON Schema, error codes, sample payloads, golden fixtures and compatibility tests.
- `integrations/bifrost/ace-connector/`: thin Go plugin and build reproducibility.
- `src/transport/ace-gateway/`: TypeScript projection API adapter over ACE core.
- `test/gateway-conformance/`: strict fake providers and outbound semantic capture.
- `docs/docs/references/`: decision ADR, deployment, capabilities and operations.
- `scripts/`: fixed-version smoke/protocol matrix runner, complete dry-run fixtures.
- CI: version-pin validation, Go plugin build, TypeScript contract tests, protocol tests, egress guard verification and per-provider route sign-off.

**Definition of done:** A coding agent with a configurable provider base URL can use ACE through Bifrost without linking ACE source code into the agent or the Go plugin; a supported strict route provably sends the selected request-local context to the provider, or blocks rather than silently sending the unmodified transcript.

## 11. Open decisions (resolve before M2)

1. Initial provider protocol and agent for M2 (recommend native OpenAI Chat Completions with stateless full-history requests as the simplest proof).
2. Whether final-wire enforcement is already possible at a current Bifrost transport point or requires a small upstream hook.
3. How much raw provider-native content ACE is authorized to inspect for each tenant.
4. Strict-only versus mixed strict/assist modes per deployment; never silently switch between them.
5. Where continuation / server-side state is recorded, if supported at all.
6. Whether the Go connector is a native plugin, WASM plugin, or both; native Go can be a pragmatic Linux-first choice.

## 12. Immediate next action

Implement M0 as an executable conformance proof: pin Bifrost, prepare mock upstream capture for full message replacement and tool/reasoning preservation, and verify the exact hook-to-wire path. Do **not** build a separate ACE Edge reverse proxy until a tested Bifrost capability gap justifies it.
