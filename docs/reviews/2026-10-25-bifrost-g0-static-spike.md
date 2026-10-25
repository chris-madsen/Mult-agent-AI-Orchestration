# Bifrost G0 static seam spike — 2026-10-25

**Status:** STATIC-REVIEWED only. No Bifrost plugin, mock upstream capture, provider-wire test, real provider call or production approval was performed.

## Exact reference

- Repository: `maximhq/bifrost`
- Source revision: `fe7634a6c828927d05ffdd57c62be0aaab04193f`
- Host toolchain observed: Go `go1.18.1 linux/amd64`
- Checkout: external scratch checkout under `/home/ilja/.hermes/cache/scratch/`; no Bifrost source was copied into ACE.

## Static findings

1. `HTTPTransportPreHook` runs after transport authentication and before Bifrost core request handling. It receives a serializable request and can mutate the body or return a response/error that short-circuits the provider path. This is the viable authenticated ingress seam for the first connector slice.
2. Hook ordering is `HTTPTransportPreHook` → `PreRequestHook` → `PreLLMHook` → provider call. `PreRequestHook` mutations are committed to the top-level request and visible to fallbacks, but its ordinary error return is non-blocking; it cannot be the strict rejection boundary by itself.
3. `PreLLMHook` runs per effective provider attempt, including fallback attempts. It is therefore needed for attempt reauthorization, but its mutations do not provide the initial authenticated body boundary and fallback visibility must not be inferred from shallow-copy behavior.
4. The HTTP middleware applies modified request bytes back to fasthttp before entering the router. The source snapshot/copy and final application are separate from provider conversion; ingress mutation is not final-wire proof.
5. Raw request bodies are installed on the Bifrost request only when the route/context selects raw-body handling. The Anthropic raw-body builders can still delete or set fields such as `thread`, `model` and `max_tokens`; raw passthrough is not a losslessness guarantee.
6. OpenAI Responses conversion has provider feature handling that can remove, hoist or rewrite unsupported fields. A route must be certified per provider/model/build and cannot claim G3 from the presence of a transport hook.

## Initial route decision

The first candidate remains OpenAI Chat Completions with explicit full history and no provider-managed continuation. Large/unknown-length or streaming **input** bodies are not certified by this spike and must be rejected or explicitly downgraded until a bounded complete-body path and final-send observation exist.

## Open unknowns / next gate

- No actual mock upstream capture was run; final outbound bytes are unverified.
- Plugin registration/order and a final-send guard still require a pinned Bifrost build test.
- Retry/fallback request bytes and provider/model changes require attempt-level capture.
- Bifrost's Go 1.18 toolchain observation is not a production pin or compatibility approval.

The result closes only the static portion of G0. It does not close provider-wire, G3/G4, real-agent, Harbor or production gates.
