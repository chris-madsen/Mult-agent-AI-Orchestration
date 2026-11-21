# ACE ↔ Bifröst native Responses connector

**Updated for the owner’s 2026-11-21 subscription-only architecture decision.** This is the Go connector for the TypeSpec-owned `ace.context.v3` local projection and physical-send authorization API. ACE receives native Responses, prepares verified code context, and signs a short-lived request-bound receipt. Bifröst performs actual provider dispatch; the model provider—not ACE—validates the user's ChatGPT/Codex subscription OAuth token.

For active requirements and runbooks see [OpenSpec C04](../../../openspec/changes/013-gateway-g11-production-acceptance/phases/C04.md), [RESP-006](../../../openspec/changes/013-gateway-g11-production-acceptance/specs/gateway-native-responses/spec.md), and [subscription OAuth integration](../../../docs/operations/gateway-subscription-oauth.md).

## Actual local ACE authorization (after C04 correction)

- ACE **does not** inspect/attest the origin, refresh state or entitlement of OAuth credentials. There is no `OAUTH_ROUTE_UNVERIFIED` unconditional deny path. Subscription OAuth is owned by Hermes and authenticated by ChatGPT/Codex.
- The prepared projection receipt is signed and tied to exact request/workspace/session correlation, source data class, provider/model, prepared body digest, deadline and policy version. The per-attempt physical-send guard checks final provider route/destination and serialized native request body, `store:false`, secret and authorized data classes, then single-use attempt ID.
- If those checks pass and the audit sink records the safe attempt metadata, ACE returns **`ALLOW`**; otherwise **`BLOCK`** or typed error. No API-key OAuth fallback, direct provider bypass or alternate Chat/Completions transport is implemented. Retried sends require a new attempt ID and independent authorization.
- A permitted model-bound prompt with private conversation plus private source requires policy permission for **both** classes. Audit records contain only safe IDs, hashes, route identity and reason—not OAuth tokens, raw code or conversation.
- The valid final provider destination path can be the ordinary native `/v1/responses` **or** the exact official subscription `https://chatgpt.com/backend-api/codex/responses`. **Allowing the syntax does not grant permission**: `ACE_CONTEXT_ALLOWED_LLM_DESTINATIONS_JSON` must list the exact configured destination. A subscription-only deployment must **not** allowlist `https://api.openai.com/v1/responses`.

## Critical upstream compatibility, not yet certified

The connector's current Go plugin is built against a **pinned review fork**:

`chris-madsen/bifrost@72f03b4b0d4a93b08e9fc0e5ebfe3447248af2a0`

The **exact pinned fork** already includes `NewChatGPTPassthroughRouter` in `transports/bifrost-http/integrations/passthrough.go`, which preserves the caller's ChatGPT bearer and forwards the POST to `https://chatgpt.com/backend-api/codex/responses`. Its OpenAI provider `Passthrough` and `PassthroughStream` use the Bifröst Core request pipeline. ACE now attaches at the **existing post-auth HTTP transport hook on this route**, not an independent Gateway or custom OAuth implementation.

Maintained upstream Bifröst transport `transports/v2.6.0` has a native subscription-preserving `/chatgpt_passthrough/backend-api/codex/responses` route (see [official Codex guide](https://github.com/maximhq/bifrost/blob/transports/v2.6.0/docs/cli-agents/codex-cli.mdx)). It forwards the original caller's ChatGPT `Authorization` to ChatGPT, while a Bifröst virtual key is carried separately in `x-bf-vk`. This removes any need to implement ACE's own OAuth mechanism.

**Integration state:** source inspection confirms the subscription route already exists in the pinned fork; ACE's Go plugin now handles its native `POST /chatgpt_passthrough/backend-api/codex/responses` at `HTTPTransportPreHook` and admits only that same exact provider/path/model in `PreLLMHook`. Go mock HTTPS/provider-byte tests and CI build are **local evidence only**. Actual deployment, model response, Hermes loop, SSE cancellation, WebSocket and Harbor acceptance remain independent real-world tests. Avoid unnecessary Bifröst forks or double-provider dispatch.

## Request and trust boundaries

1. Hermes targets the existing Bifröst **`/chatgpt_passthrough`** base URL with its own subscription bearer in Authorization; a Bifröst virtual key, if required, is supplied separately in `x-bf-vk`. Hermes must not target an ACE HTTP endpoint as its LLM base URL.
2. `HTTPTransportPreHook` binds the actual incoming message to its workspace and creates the ACE request identity. Caller-provided session headers are *correlation*, not authentication.
3. Post-auth `HTTPTransportPreHook` calls the ACE projector, mutates the **same** native request body and installs the Bifröst Core per-physical-send guard; `PreLLMHook` verifies the binding and guards the real `PassthroughRequest`. `PREPARED` alone cannot authorize dispatch.
4. The guard stages final native body bytes, obtains an ACE single-use attempt decision and permits transmission only on `ALLOW`. A later plugin mutation or an unknown route invalidates the receipt; retry/fallback attempts cannot reuse a permit.
5. On an unexpected upstream 401/403, surface the provider authentication error. Never retry via an OpenAI API key or another provider/model.
6. Bifröst does not attest the coding host's full durable transcript or compaction history. The current connector honestly marks that as `unattested`; the known request bytes and signed source evidence remain the only proven context.

## Current configuration

For a private single-workspace Bifröst instance, set in the **Bifröst plugin process**:

```bash
ACE_BIFROST_TENANCY_MODE=single-workspace
ACE_BIFROST_WORKSPACE_ID=<registered-workspace>
ACE_CONTEXT_RPC_TOKEN=<private-shared-secret>
```

Set the same secret as `ACE_CONTEXT_RPC_SHARED_SECRET` in the local ACE context process. Never share it in logs or repository files. This authenticates the connector process; no multi-tenant identity claim is made.

The ACE context engine reads independent explicit destination/model/data-class permission:

```bash
ACE_CONTEXT_EXTERNAL_LLM_OPT_IN=true
ACE_CONTEXT_ALLOWED_LLM_PROVIDERS_JSON='["openai"]'
ACE_CONTEXT_ALLOWED_LLM_MODELS_BY_PROVIDER_JSON='{"openai":["<selected-Bifrost-model-id>"]}'
ACE_CONTEXT_ALLOWED_LLM_DESTINATIONS_JSON='["https://chatgpt.com/backend-api/codex/responses"]'
ACE_CONTEXT_ALLOWED_LLM_DATA_CLASSES_JSON='["private_source","private_conversation"]'
```

These are ACE's **source/route policy settings**, not OAuth credentials and not a new proxy. The exact outbound URL is already produced by the pinned Bifröst ChatGPT passthrough, as verified in source; a real deployment still needs to demonstrate successful live provider egress. The default streaming allowlist is empty; nonempty `ACE_CONTEXT_ALLOWED_LLM_STREAMING_ROUTES_JSON` requires separate C06 proof. Configure Hermes's existing OAuth store and a compatible `HERMES_CODEX_BASE_URL` without copying tokens to ACE.

## Local deterministic verification

```bash
# From repository root:
npx tsx --test test/responses-projection-service.contracts.test.ts
npm run check
npm run test:gateway-only-audit

# From integrations/bifrost/ace-connector:
go test ./...
```

Build the current fork-pinned plugin from repository root:

```bash
GOWORK=off GO_BIN=/absolute/path/to/go1.27.4/bin/go \
  BIFROST_SOURCE_ROOT=/absolute/path/to/bifrost-checkout \
  BIFROST_COMMIT=72f03b4b0d4a93b08e9fc0e5ebfe3447248af2a0 \
  ./scripts/build-bifrost-ace-plugin.sh
```

The script requires clean pinned Bifröst and ACE checkouts and embeds **both actual Git commit SHAs** (ACE and the verified external Bifröst checkout) into the plugin; `Init` rejects either missing provenance. The host-build digest derives from these exact injected SHAs, **not** from a separately maintained constant. The script returns the plugin SHA-256. Passing this build, Go tests and local HTTPS mocks is **not** a real subscription-provider trial. Full C03–C05 certification requires a real, correlated provider acknowledgement through the installed Hermes + Bifröst + ACE route; C07/C08 additionally require real Hermes/Harbor trials. **There is only one agent-facing LLM Gateway: Bifröst.**

### ACE context RPC initialization contract

`ACE_CONTEXT_RPC_URL` must contain the full canonical loopback project endpoint, e.g. `http://127.0.0.1:8765/internal/ace-context/v3/project`, and `ACE_CONTEXT_RPC_TOKEN` must match the colocated ACE process's `ACE_CONTEXT_RPC_SHARED_SECRET`. Bifröst's plugin `Init` rejects non-loopback URLs, query strings, mismatched v2 paths and the obsolete `responses_projection_url` map key. The optional configuration override key is `context_rpc_url` and has the same validation. This is a versioned internal policy/context seam, never an independent model-facing endpoint. The provider-delivery stub was removed from v3 because Bifröst owns final response accounting.
