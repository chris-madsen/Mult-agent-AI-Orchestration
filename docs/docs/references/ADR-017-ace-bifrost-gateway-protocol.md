# ADR-017 — ACE LLM Gateway Protocol v1 over Bifrost

**Status:** Proposed / implementation plan (NOT implemented).  
**Scope:** General-purpose ACE integration for coding agents via LLM provider API gateway.  
**Boundary:** ACE remains an independent process; Bifrost runs separately (Go). Linux first; macOS optional. No Windows requirement.

## 0. Decision

Use **Bifrost as the provider gateway**, with a minimal, pinned Go **ACE Connector plugin** that invokes a standalone ACE service over Unix domain socket (or loopback HTTP in dev). Never import ACE TypeScript modules into Go; never embed Bifrost inside ACE. This is a separate delivery mechanism alongside the Hermes/Pi/OpenCode native context hooks.

Primary path: `Agent -> Bifrost HTTPTransportPreHook -> ACE projection service -> modified Bifrost request -> provider`. Optional `PreRequestHook` validates normalized fields after decoding. **Neither hook by itself proves the final upstream bytes.** Add independent egress observation via a controlled mock provider, plus production provider-token receipts.

Treat the gateway as a _context-delivery plane_, not a retrieval implementation. All retrieval, source validation, selection, memory, compaction, and budget decisions remain in ACE Core.

Do **not** call the existing Hermes v1 append-only context injection `context replacement` or `token saving`. This interface must support honest `augment`, `replace`, `passthrough`, and `blocked` outcomes.

## 1. Goals and non-goals

### Goals
- One versioned interface across Hermes, Pi, OpenCode, provider SDKs, and compatible arbitrary agents that expose a configurable API endpoint.
- Safe **request-local** projection without mutating the agent's durable conversation.
- Lossless representation of critical provider-native constructs, or an explicit `unsupported` response; never silently drop tool/result linkage, reasoning carriers, multimodal payloads, cache-control directives or system constraints.
- Provider-visible evidence: immutable input/projection digests and network-observed payload + real usage (input/cached/output tokens, dollars, latency) correlated per attempt.
- Strict fail-closed in experiments, including retries, streaming, alternate provider routes, and hook failures.
- Explicit per-provider capability negotiation: feature declared, tested, and pinned to an exact Bifrost revision.

### Non-goals
- Transparent interception of arbitrary direct agent-to-provider TLS (agents must intentionally target Bifrost).
- Invisible injection into provider-held histories such as OpenAI `previous_response_id` or server-managed threads.
- Cross-provider syntax rewriting in a lossless route: translating incompatible models may require intentionally lossy conversion and must be a different mode.
- Secrets or full message contents in receipts/telemetry.

## 2. Process topology

```
Coding Agent --(OpenAI/Anthropic/Gemini HTTPS)--> Bifrost :443
                                               |
                                       ACE Connector (Go)
                                               |  UDS/HTTP+JSON
                                               v
                                       ACE Core (TypeScript)
                                        |- retrieval / source checks
                                        |- Context IR/compiler
                                        |- budget & provenance
                                        \- evidence receipts
                                               |
Bifrost per-provider serializer + policy ---------> Provider
                              \--------------------> Mock wire capture (conformance only)
```

- Bifrost handles its own auth, credential selection, rate limit, retries, streaming and provider routing.
- The connector has NO repository access, no retrieval logic, and no provider credentials in payloads sent to ACE.
- The connector must support cancellation and bounded execution time; do not hold a Go plugin lock while awaiting ACE.
- Pin Bifrost by commit/release digest and compile plugin with matching Go version/dependencies. Linux + macOS build/test matrix.

## 3. Protocol: `ace.gateway.context/v1`

Use HTTPS JSON on loopback or Unix socket; strict JSON Schema / TypeScript discriminated unions; arbitrary message bytes are base64 or structured safe envelopes.

### Request fields

```typescript
interface GatewayContextRequestV1 {
  protocol: "ace.gateway.context/v1";
  requestId: string;  // unique for each incoming provider call
  attemptId: string;  // unique for each provider attempt
  sessionId?: string; turnId?: string;
  agent: { id: string; version?: string; capabilityLevel: "gateway" };
  provider: {
    inputDialect: "openai-chat" | "openai-responses" | "anthropic-messages" | "gemini";
    model: string; endpoint: string; stream: boolean;
    bfiRevision: string;
  };
  payload: {
    rawBodyBase64: string;           // precise ingress bytes; not logged
    contentType: "application/json";
    canonicalDigestSha256: string;
  };
  capabilities: {
    rawPassthrough: boolean;
    responseStateVisible: boolean;
    unsupportedFields?: string[];
  };
  contextBudget: {
    windowTokens?: number; outputReserveTokens?: number;
    maxAceOverheadTokens: number;
  };
  source?: { workspaceId: string; revision?: string; sourceDigest?: string };
}
```

The ACE Core does not assume the HTTP body contains a complete conversation. Server-held history and encrypted reasoning are flagged `not_full_context`; no full-replacement claim in this state.

### Response fields

```typescript
type GatewayContextDecisionV1 =
 | { protocol: "ace.gateway.context/v1"; requestId: string; attemptId: string;
     action: "replace"; rawBodyBase64: string; projectionDigestSha256: string;
     receiptId: string; selectedEvidenceIds: string[]; omittedEvidenceIds: string[];
     projectionKind: "full" | "partial"; limitations: string[] }
 | { protocol: "ace.gateway.context/v1"; requestId: string; attemptId: string;
     action: "passthrough"; receiptId: string;
     reason: "not_beneficial" | "not_applicable"; limitations: string[] }
 | { protocol: "ace.gateway.context/v1"; requestId: string; attemptId: string;
     action: "blocked"; reasonCode: string };
```

Always validate IDs, response/body digests, size limits, allowed endpoint/dialect and all mandatory provider invariants before forwarding. `passthrough` is allowed for non-strict operational mode but is **not** counted as ACE-applied evidence. In strict benchmark mode, require `replace` with an audited receipt or fail closed.

### IR rules

- Immutable control plane: system/developer instructions, permissions and task goal protected by default.
- Conversation is an ordered graph with message IDs, tool-call IDs, tool-result IDs, multimodal parts, provider-specific opaque fields and hidden-state flags.
- Transform only allowed editable subgraphs; never mutate signed/opaque reasoning contents.
- Preserve unresolved tool calls and immediate tool-result groups; source-verified older outputs can be replaced only under a documented coverage policy.
- Cache prefix invalidation is measured: modified blocks should occur as late as possible consistent with provider semantics.
- Compute both `inputDigest` and `projectionDigest` in the connector and compare with the ACE response. No unverified reserialization.

## 4. Bifrost hook and provider routing

1. `HTTPTransportPreHook` (after authentication): recognize only explicit model request routes and supported JSON content types; capture body, remove credentials, ask ACE, apply `req.Body`, or short circuit on failure.
2. `PreRequestHook` (one per logical request): optional normalized structural checks and correlation tags. No second retrieval.
3. `PreLLMHook` (per fallback attempt): enforce ACE admission marker and provider identity; do not re-run transform blindly. Revalidate when a fallback changes dialect/model constraints.
4. Upstream wire conformance: mock provider receives final Bifrost-emitted body and SSE is verified with streaming tools and usage frames.
5. **Large payload mode**: upstream Bifrost may omit the body from HTTP hook to avoid buffering. Explicitly reject strict ACE requests unless an approved streaming transform path exists; never pass through unobserved bytes.
6. **Raw passthrough**: provider adapters can still modify `model`, `max_tokens`, `thread` and other fields. Enumerate allowed normalization deltas **per exact provider+API version**. An unknown or disallowed mutation fails conformance.
7. Retries / failovers: correlate `attemptId` to source projection, and reject any attempt with no valid ACE admission; no fallback from `replace` to native context after a connector/ACE failure.

## 5. Security and resilience

- Bind to Unix socket with owner/group permissions; fallback HTTP only on loopback with mutual authentication.
- No credentials or raw text in receipts. Enforce max input bytes, max output bytes, deadlines and cancellation. No telemetry of unredacted prompts.
- Prevent source/provider egress that bypasses the ACE admission layer in strict mode: network policy or equivalent control, plus mock-network tests.
- Distinguish: `BLOCKED` (verified denial), `UNKNOWN` (missing evidence), `NOT_APPLIED` (intentional passthrough), `APPLIED` (verified projection). Never reinterpret unknown as zero ACE use.
- Separate plugin errors from response verification; fail closed when audit or receipt persistence fails in strict mode.
- Do not expose API keys to the TS ACE process. Bifrost alone owns upstream credentials.

## 6. Token economics and acceptance evidence

**A retrieval hit is not a token saving.** The existing Hermes plugin adds evidence to a preserved transcript; it cannot claim saved tokens by construction. Introduce a genuinely replacing/context-pruning compiler mode separately.

Measure on the wire *per provider attempt*:
- provider-reported input, cached-input, uncached-input, output, reasoning and billable usage;
- number of attempts, model/tool invocations, latency, cost and task-level reward;
- original ingress size, ACE projection size, and **final Bifrost upstream payload** (hash + byte/token estimate);
- ACE connector overhead, extra retrieval LLM expenses, embedding/rerank overhead;
- response quality and verifier provenance.

Use same model/provider/version/reasoning/task/revision across paired arms. Include cold-cache and warm-cache trials independently, randomized AB/BA order, repeated trials and confidence bounds.

Report both:
1. `grossTokenRatio = aceTotalProviderTokens / nativeTotalProviderTokens`, including cached tokens once.
2. `netCostRatio = (ACE provider cost + ACE overhead) / native provider cost`.

No `5x` claim until raw trial/provider evidence is complete, task quality is non-inferior, and a genuinely shrinking projection is observed. A simple 1-turn smoke with small files is NOT sufficient to demonstrate 5x context savings; include long sessions with repeated tool outputs and unbounded-history baselines.

## 7. Conformance test matrix

| Case | Required check |
|---|---|
| OpenAI Chat | tool calls+results, JSON schemas, system/user/assistant messages, cache behavior |
| OpenAI Responses | reasoning items, function/custom tools, previous_response_id rejection for full replay |
| Anthropic Messages | signed thinking, tool_use/tool_result, cache_control, beta headers |
| Gemini | functionCall/functionResponse, cachedContent, multimodal payload |
| Streaming | SSE fragments, usage frames, cancellation, error trailers |
| Provider fallback | exact projection/attempt provenance and no unguarded retry |
| Large body | explicit block unless ACE has complete observable data |
| Caching | prefix stability and cost measurements |
| Unsafe requests | credentials absent in ACE; source and trust boundaries intact |
| Raw vs normalized | wire-level semantic diff and enumerated allowed deltas |

For each dialect test both *provider-native same-dialect* and *cross-provider routed* paths. Unsupported conversions must be visible as capabilities, not silently permitted.

## 8. Milestones

**M0 — Baseline (P0):** pin Bifrost commit, collect known behavior; define schema, fixture requests and mock provider. Exit: compile and reject unsupported modes deterministically.

**M1 — Local MVP (P0):** Go HTTP hook + UDS client, ACE service stub replacing one OpenAI Chat request, egress capture, fail-closed, SSE compatibility, receipts. Exit: 100% of mock-provider upstream requests have matching ACE projection.

**M2 — Native payloads (P0):** Responses + Anthropic, field-preservation suite, tool/reasoning/caching coverage. Exit: exact permitted transformation set, no critical fields lost, error/stream paths covered.

**M3 — Context Compiler (P0):** genuine history replacement with protected message groups, evidence-aware compaction, explicit no-op decision and token-budget math. Exit: at least one long-context paired workload with actual upstream input-token reduction and no quality regression.

**M4 — Benchmark integration (P0):** four-arm Harbor with native/Hermes-native-hook/Bifrost-ACE/Bifrost-passive controls, all models/providers pinned, report reconciliation. Exit: cost/token receipts match provider usage and all ACE claims are independently auditable.

**M5 — Beta (P1):** Gemini, SDK wrappers, macOS, performance, backpressure, compatibility renegotiation, supported versions matrix. Exit: automated CI matrix; documented unsupported routes and operational runbooks.

## 9. Failure / rollout criteria

- No raw source/credentials leaked via logs or receipts.
- Unknown critical provider fields, hidden history and mutable fallback paths block strict full context mode.
- A repeatable red/green test demonstrates why an unsafe Bifrost conversion is rejected.
- End-to-end test proves that native transcript is unaffected by request-local projection.
- Release blocked if any strict request reaches provider without verified ACE admission.
- Default production mode remains additive/observe-only until replacing compiler passes quality-and-economics gates.

## 10. Separation from PR #164

PR #164 is benchmark-runtime readiness. It must not be confused with implementation of this gateway or with proof of context economy. Track these separately:
- Gateway protocol/conformance here.
- Existing Hermes plugin v1: `augmentation` receipts, not `replacement`.
- Future ACE compiler: policy-controlled replacement, actual provider token reductions, verified quality.
