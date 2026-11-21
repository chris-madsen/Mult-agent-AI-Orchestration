# Bifröst single-Gateway boundary audit — 2026-11-21

**Scope inspected:** `src/transport/context-rpc-http.ts`, `src/application/gateway-attempt-authorization-service.ts`, `src/application/responses-projection-service.ts`, `integrations/bifrost/ace-connector/plugin/main.go`, Bifröst pinned fork `72f03b4b0d4a93b08e9fc0e5ebfe3447248af2a0` native ChatGPT passthrough and physical-send transport. Architectural authority: ADR-017 + ADR-021. Verification: source inspection + Go contract tests; no real provider E2E claim.

## Existing functions, actual owners, disposition

| Component or capability | Actual purpose | Bifröst already owns it? | Disposition |
|---|---|---|---|
| Agent-facing HTTPS request parser/route | Hermes → provider transport | Yes | **Reuse Bifröst** `/chatgpt_passthrough`, never add ACE reverse proxy |
| ChatGPT bearer forwarding / subscription OAuth | Login/refresh, bearer, provider authorization | Hermes + Bifröst + ChatGPT | **No ACE implementation** |
| Provider/model selection, API-key routing, retry/fallback | Model dispatch and retries | Bifröst | **No ACE implementation**; restrict selected ACE source destination only |
| Native SSE/streaming and provider response parsing | Model stream / error / usage | Bifröst | **Reuse**, test C06; ACE does not reimplement SSE or count provider usage |
| Context retrieval and evidence | CBM/Qdrant/LSP/Vertex/current source | No | **Keep ACE Core (TS/Effect)** |
| Context insertion before provider send | Verified source, additive Responses request, unchanged caller history | No | **Keep ACE projection** via Bifröst post-auth plugin |
| `POST /internal/ace-context/v3/project` | Authenticated **local** Go↔TS context projection RPC | No | **Keep**: no public generation endpoint, no provider network request |
| `POST /internal/ace-context/v3/authorize-attempt` | ACE-specific source/data permission and final body/receipt integrity | Bifröst provides the **terminal hook**, not ACE's evidence policy | **Keep ACE policy inside Bifröst hook**; do not implement separate OAuth or route switching |
| `GET .../health`, `GET .../capabilities` | ACE Core readiness and internal capability diagnostics | Bifröst health does not know ACE retrieval readiness | **Keep local**; do not call them a second LLM Gateway |
| `ace.context.v3` TypeSpec DTOs | Versioned internal Go↔TS schema, receipt and source-policy results | No | **Keep**: native context-only contract; DTOs use Context rather than Gateway terminology |
| Provider-native `POST /v1/responses` | Generic API-key-compatible native Responses mode | Bifröst | **Do not use as a substitute** for ChatGPT subscription; only the existing `/chatgpt_passthrough/.../responses` is configured for Hermes |
| `HTTPTransportPreHook` and `PreLLMHook` | Native Bifröst extension points | Yes | **Extend existing Go ACE plugin** only for exact Codex subscription route |
| `physical-send` guard / retry IDs | Bifröst terminal transport and per-attempt callback | Yes | **Reuse**, ACE supplies policy decision; no second outbound connector |
| Private-source opt-in / source freshness / safe audit | ACE own data policy, separate from LLM entitlement | No | **Keep**. These do not authenticate a ChatGPT subscription |

## Removed design mistakes / do not reintroduce

- Unconditional `OAUTH_ROUTE_UNVERIFIED` and SDLC gate requiring it: corrected in PR #318.
- Hard-coded provider-route restriction to the API-key `/v1/responses`: ACE Go plugin now also recognizes Bifröst's exact native ChatGPT subscription POST and its read-only model-catalog GET.
- Requiring a voluntary Hermes session header as a prerequisite to sending a *valid* OAuth request: absent header is now explicitly `unattested-` correlation, not invented durable session state.
- Claiming the pinned fork lacked subscription passthrough: it is present in source. **No independent fork modification has been needed.**
- Any future proposal for an ACE model proxy, standalone streaming server, OAuth credential evaluator, private Bifröst reimplementation or Bifröst-internal retrieval rewrite must first prove a concrete missing upstream extension point and obtain an explicit owner architecture decision.

## Evidence and remaining risk

- The pinned fork contains native ChatGPT passthrough and forwards the caller's token; the ACE plugin now binds this route and the existing Bifröst physical-send hook in a local synthetic request path.
- Local Go tests can prove correct prepared body, rejections and synthetic final-wire capture. They cannot prove a real Hermes installation points to this Bifröst listener, authenticates the subscriber to the real ChatGPT backend, or preserves a multi-turn SSE/tool loop under real model load.
- Bifröst's `/chatgpt_passthrough/backend-api/codex/responses` uses the *native passthrough streaming path*. Verify C06 streaming, cancellation and retry behavior on the exact installed binary. **Do not** treat the static ACL alone as a successful real stream.
- The obsolete delivery-stub endpoint was **removed** in the v3 internal contract migration. Bifröst exclusively owns provider dispatch, streaming and response accounting; ACE only prepares context and evaluates exact send-attempt policy.

**Result:** The runtime architecture has one model Gateway, one context engine and a thin extension boundary. The public / private provider wire and quality claims remain separately testable.
