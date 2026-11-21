# Hermes + Bifröst + ACE — native ChatGPT subscription route

**Authority:** [ADR-021](../docs/references/ADR-021-bifrost-single-gateway-ace-context-service.md), [OpenSpec 013](../../openspec/changes/013-gateway-g11-production-acceptance/). Updated 2026-11-21 for the current pinned Bifröst fork and ACE code. **There is exactly one agent-facing LLM Gateway: Bifröst.** The local TypeSpec v3 HTTP service is a Go↔TypeScript context/RPC seam, not a reverse proxy or a second LLM call.

## Source-verified existing features

- **Hermes** uses its own `openai-codex` subscription OAuth store. Hermes refreshes bearer tokens; ChatGPT validates them. ACE does not inspect, copy, refresh, validate or log these credentials.
- **Pinned Bifröst fork (ACE checksum-only follow-up on the original approved commit):** `chris-madsen/bifrost@72f03b4b0d4a93b08e9fc0e5ebfe3447248af2a0` already implements `NewChatGPTPassthroughRouter` in `transports/bifrost-http/integrations/passthrough.go`. The router forwards `POST /chatgpt_passthrough/backend-api/codex/responses` to **`https://chatgpt.com/backend-api/codex/responses`**. In `router.go`, `applyPassthroughCallerAuth` keeps the ChatGPT subscriber `Authorization` header and skips key selection. It is **not** an API-key route to `api.openai.com`.
- Bifröst's `Bifrost.Passthrough` / `PassthroughStream` already pass these requests through the standard Core plugin pipeline; its OpenAI provider uses the existing outgoing transport. The pinned fork also has a physical-send guard.
- **ACE Go plugin in PR #319** now admits this exact native subscription POST in `HTTPTransportPreHook`, preserves the original bare Codex model and bearer header, calls ACE's local projection API, installs the existing Bifröst per-send guard and admits the corresponding `BifrostPassthroughRequest` in `PreLLMHook`. The read-only Codex `GET /chatgpt_passthrough/backend-api/codex/models` is not a model-generation request and is allowed to Bifröst. No separate Bifröst fork or new OAuth implementation was necessary.
- The TypeScript `authorizePhysicalSend` checks **ACE source policy and last serialized provider attempt**, not subscription validity. The provider returns 401/403 if the bearer is invalid; no API-key fallback.

## One real request: ownership

```text
Hermes (subscription bearer, model + native Responses body)
  -> Bifröst POST /chatgpt_passthrough/backend-api/codex/responses
       -> ACE plugin post-auth hook
          -> local /internal/ace-context/v3/project (verified context, no model call)
       -> same Bifröst PassthroughStream / Passthrough request
          -> ACE plugin pre-LLM binding
       -> same Bifröst provider transport/physical-send hook
          -> local /internal/ace-context/v3/authorize-attempt (source policy only)
       -> https://chatgpt.com/backend-api/codex/responses
  <- Bifröst native provider response/stream returned to Hermes
```

The local ACE endpoints do not accept `Authorization: Bearer <ChatGPT token>`; they use a different connector-only secret and never call the provider. Never set `HERMES_CODEX_BASE_URL` to an ACE localhost projection endpoint.

## Configuration — no second gateway

Set `ACE_CONTEXT_RPC_URL=http://127.0.0.1:8765/internal/ace-context/v3/project` for the Bifröst Go plugin and `ACE_CONTEXT_RPC_SHARED_SECRET` to the same high-entropy value as its `ACE_CONTEXT_RPC_TOKEN` on the colocated ACE process. The plugin now validates the complete loopback URL and version at **Init**, not after the first agent request. The plugin's optional `context_rpc_url` map setting may override the URL only with an equally valid v3 loopback project endpoint; the obsolete `responses_projection_url` key is rejected explicitly.

The internal `record-delivery` endpoint was removed from v3: final provider delivery and usage telemetry belong to Bifröst, not ACE.


Set `HERMES_CODEX_BASE_URL` to the Bifröst **passthrough base**, with the trailing prefix:

```text
http://127.0.0.1:<bifrost-port>/chatgpt_passthrough
```

The existing Hermes OpenAI Codex adapter appends `/backend-api/codex/responses`. Supply the Bifröst virtual key via the supported separate `x-bf-vk` mechanism if the configured listener requires it; **do not** overwrite the ChatGPT `Authorization` bearer. Keep the existing Hermes OAuth state private.

The Bifröst **ACE plugin process** requires `ACE_BIFROST_TENANCY_MODE=single-workspace`, `ACE_BIFROST_WORKSPACE_ID=<registered-workspace>` and `ACE_CONTEXT_RPC_TOKEN=<private-connector-secret>`. ACE Core uses the same token as `ACE_CONTEXT_RPC_SHARED_SECRET`. These are process-to-process service credentials, **not a second OAuth sign-in**.

ACE must explicitly permit the source and subscription destination (example with one fixed selected model):

```bash
ACE_CONTEXT_EXTERNAL_LLM_OPT_IN=true
ACE_CONTEXT_ALLOWED_LLM_PROVIDERS_JSON='["openai"]'
ACE_CONTEXT_ALLOWED_LLM_MODELS_BY_PROVIDER_JSON='{"openai":["<actual-Codex-model-id>"]}'
ACE_CONTEXT_ALLOWED_LLM_DESTINATIONS_JSON='["https://chatgpt.com/backend-api/codex/responses"]'
ACE_CONTEXT_ALLOWED_LLM_DATA_CLASSES_JSON='["private_source","private_conversation"]'
```

Exact provider/model/destination allowlists are **ACE data-leak/final-receipt permissions**, not duplicated LLM routing or OAuth. Bifröst remains the runtime router. The optional `ACE_CONTEXT_ALLOWED_LLM_STREAMING_ROUTES_JSON` is required for an approved streaming route according to the TypeSpec v3 policy. The native ChatGPT POST is handled as a stream by Bifröst even if the body omits a `stream` flag; validate the *effective* streaming route separately before claiming C06. Do not infer the provider's context window or token counter from the ACE process.

A missing `session-id` or `x-bf-session-id` is not a login failure. ACE generates an **unattested request-scoped correlation ID** rather than incorrectly treating a header as authoritative durable conversation identity. Explicit authenticated multi-tenant workspace inference is not implemented: isolate one Bifröst listener/workspace.

## Verification (separate levels of proof)

1. **Code contract/Go plugin build:** `npm run verify:pr`, `npm run test:gateway-only-audit`, `npx tsx --test test/bifrost-plugin.contracts.test.ts`, and `go test ./...` inside `integrations/bifrost/ace-connector`. From the ACE repository root, build the exact pinned Bifröst `.so` using `scripts/build-bifrost-ace-plugin.sh` with both source trees clean.
2. **No-token local integration:** `integrations/bifrost/ace-connector/plugin/main_test.go` uses a synthetic subscriber header, mocked local ACE TypeSpec projection, native Bifröst context-transport guard and localhost HTTPS provider capture. Confirm prepared native body, absence of an invented `?provider=`, per-send allow and reject-on-route-change, and single outbound synthetic TLS request. No real subscription token or real provider is used.
3. **Real C03–C05:** already permitted by the owner for bounded disposable/public-source trials. On the user's configured host only, verify Hermes's real bearer reaches Bifröst's ChatGPT passthrough, the ACE hook actually executes, the **same protected body** reaches ChatGPT, and a correlated provider acknowledgement is retained. Capture redacted request hashes/IDs, the installed Bifröst commit and plugin SHA, actual model, errors and trace. Do not bypass ACE or switch to a paid API key to obtain a green response.
4. **Real C06–C08 and benchmarks:** independently verify streaming cancellation, multi-turn tool/reasoning continuity, and paired Hermes baseline versus Hermes+Bifröst+ACE Harbor task quality/latency/provider token usage. A mock fixture is not an E2E acceptance or token-savings result.

**Evidence state:** code integration and deterministic CI can pass without live egress. We have **not** executed or certified the configured user's real Hermes subscription, provider acknowledgement, Harbor quality/economics or release. This runbook does not create a new permission gate or declare live tests impossible.
