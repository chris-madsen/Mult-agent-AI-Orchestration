# ADR-021 — Bifröst is the sole LLM Gateway; ACE is an internal Context Engine

**Status:** Accepted — explicit owner architecture decision
**Date:** 2026-11-21
**Scope:** Hermes/Codex subscription model requests; ACE+Bifröst integration
**Amends:** ADR-017 implementation details and ADR-020's exact /v1/responses URL restriction; does not restore non-Responses generation.

## Problem

ACE's original local v2 projection API and the Bifröst Go plugin were described as another Gateway. A hard-coded `/v1/responses` requirement in ACE intercepted the API-key-compatible route but rejected Bifröst's already shipped ChatGPT/Codex **subscription OAuth** route. A separate ACE OAuth attestation blocker and SDLC rule then made `ALLOW` unreachable even when the model request was authorized. Duplicating Bifröst's HTTP ingress, OAuth, provider routing, retries, streaming and cost accounting would increase code without improving context quality.

## Owner decision

1. **One LLM Gateway: Bifröst.** Hermes targets Bifröst's existing `/chatgpt_passthrough` base endpoint. Bifröst handles ingress and provider dispatch through `POST /chatgpt_passthrough/backend-api/codex/responses`, forwards the existing ChatGPT subscription bearer to the ChatGPT backend, and owns retries, streaming and provider response semantics. No direct Hermes → ACE generation endpoint or independent ACE model proxy exists.
2. **ACE remains a TS/Effect Context Engine.** CBM, Qdrant, LSP, Vertex document retrieval, source identity, verified context assembly and policy run within ACE. ACE returns only a prepared *additive* context projection and an authorization decision for the actual provider attempt. It never calls the LLM provider and never handles subscription token refresh or billing.
3. **Thin Go connector through Bifröst's maintained hooks.** For the native ChatGPT Responses passthrough, the Bifröst post-auth `HTTPTransportPreHook` invokes ACE's local TypeSpec v3 service to add verified context to the same request. The Bifröst `PreLLMHook` checks the request-bound transport identity; Bifröst's existing terminal physical-send guard obtains ACE's source/data/destination policy decision for each actual final send. This is **not** a second LLM gateway or a second provider request.
4. **Reuse before build.** The exact pinned fork `chris-madsen/bifrost@72f03b4b0d4a93b08e9fc0e5ebfe3447248af2a0` already ships `NewChatGPTPassthroughRouter` and the retained subscriber bearer forwarding in `transports/bifrost-http/integrations/passthrough.go`, as well as the physical-send guard in `core/providers/utils/physicalsend.go`. Do not add an OAuth implementation, alternative API-key routing, a new middleware stack or a private Bifröst fork change merely to consume this route. Change Bifröst itself only if tests demonstrate a missing supported hook, and prefer upstream fixes.
5. **Two native Responses ingress paths, one protocol.** Bifröst's OpenAI-compatible `/v1/responses` remains available as a native protocol in generic contexts; the explicit **Hermes subscription-only** route is `/chatgpt_passthrough/backend-api/codex/responses`. The latter has final provider target `https://chatgpt.com/backend-api/codex/responses` and **must never** fall back to `https://api.openai.com/v1/responses` or another provider. Do not add compatibility aliases, Chat Completions or model-invoked ACE tools.
6. **No fabricated coding-host state.** Session headers are correlation data only, not OAuth authorization. A missing session header may receive a per-request `unattested-` correlation identity; it must not claim durable/compacted Hermes conversation history.
7. **Keep the ACE local wire internal, not provider-facing.** `ace.context.v3` is the new versioned, TypeSpec-generated, authenticated Go ↔ TS application boundary. `project` computes context; `authorize-attempt` enforces ACE's verified-source/data-class requirements. The host-and-source-specific health/capabilities endpoints remain local. No `/v1/responses` LLM proxy is implemented inside ACE.
8. **Evidence is separate.** Source inspection, deterministic local HTTPS capture and pinned Go builds establish implementation feasibility, not a live subscriber response. C03–C05 provider-wire evidence, real Hermes multi-turn loop, C06 streaming and paired C08 Harbor evaluation must be measured before production release/economics claims. The previously granted limited C03–C05 provider test permission is not re-requested.

## Responsibilities

| Concern | Owner | ACE responsibility |
|---|---|---|
| ChatGPT sign-in, subscription OAuth refresh | Hermes + ChatGPT | None |
| Native HTTP ingress, subscription passthrough, model dispatch, retries, stream, provider usage | Bifröst | None; reject route changes only against an existing ACE receipt |
| Verify source SHA, retrieve code/docs, select and assemble context | ACE Core | Authoritative |
| Additive native Responses projection | ACE Core via Bifröst hook | Preserve original tool, reasoning, multimodal and opaque input |
| Private-source data permission / exact final attempt integrity | ACE policy inside existing Bifröst physical-send guard | Authoritative for ACE source disclosure |
| Provider 401/403, model errors and provider accounting | Bifröst + provider | Do not replace token, change model or retry via API key |
| Model context windows or cost counters | Provider/Bifröst | Consume measured evidence; do not invent token ceilings |

## Consequences / acceptance

- No additional ACE agent-facing port, LLM reverse proxy, credential validator or provider adapter may be introduced.
- Retain authenticated loopback RPC as a narrow cross-language application seam; its name does not make it a Gateway.
- Negative tests must demonstrate that unsupported routes, model/provider switches, missing ACE binding, altered provider bytes and failed audits **cannot** reach the provider. Positive tests must prove the existing ChatGPT route can run the ACE projector and terminal guard using synthetic local provider bytes.
- Deploy and compare real Hermes without ACE vs Hermes+Bifröst+ACE on the same subscribed model and coding tasks, recording quality, latency and token use separately. Do not claim success from mocks.

See [subscription implementation runbook](../../operations/gateway-subscription-oauth.md) and [G11 OpenSpec 013](../../../openspec/changes/013-gateway-g11-production-acceptance/).

## Owner amendment — same-day internal RPC rename

The owner explicitly rejects the ambiguous ACE-as-Gateway naming. The former internal v2 wire is superseded by **`ace.context.v3`**, served only over loopback at `/internal/ace-context/v3/*`. This is a **breaking internal connector/engine contract migration**: deploy the matching TypeScript context service and Bifröst Go plugin together; never introduce an agent-facing ACE LLM endpoint, an alias forwarding to the old RPC, or a second provider dispatch path. Check the pinned Bifröst HTTP hooks and physical-send guard after redeployment. A correctly built plugin and local mock do not certify real ChatGPT/Hermes E2E.
