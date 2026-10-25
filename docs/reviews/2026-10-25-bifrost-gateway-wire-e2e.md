# Bifrost ACE gateway wire proof — 2026-10-25

**Status:** MOCK-PASS for one OpenAI Chat Completions route. This is provider-wire evidence against a disposable local mock upstream, not real-provider or production approval.

## Exact identities

- Bifrost source: `maximhq/bifrost@fe7634a6c828927d05ffdd57c62be0aaab04193f`
- Bifrost binary: `/home/ilja/.hermes/cache/scratch/bifrost-http-exact`
- ACE plugin artifact: `/home/ilja/.hermes/cache/scratch/ace-gateway-projection.so`
- Plugin SHA-256: `e570beef6aab4159d2fe07f0b334a79bfc197fd676b22723a72f99465425979f`
- Mock ACE and provider servers: `/home/ilja/.hermes/cache/scratch/wire_servers.py`
- Captured ACE request: `/home/ilja/.hermes/cache/scratch/bifrost-wire/ace-request.json`
- Captured provider body: `/home/ilja/.hermes/cache/scratch/bifrost-wire/provider-body.json`
- Captured ACE request SHA-256: `dacb4ea2df33eded9eb752b4041e9301b8757726b05d5fb745395977233d278f`
- Captured provider body SHA-256: `ef737075f1ef663b6c9441075f30679531eae03d6560727cbcb9ed8b9fe44824`
- Captured response SHA-256: `3f6c08c3b4f02f6c532bb8d1e443d5d54f9c89d7ec0e24e83f0ec52c83f168b2`

## Positive path

Command path:

```text
agent request
  -> Bifrost HTTPTransportPreHook
  -> Go ACE connector
  -> mock ace.gateway.v1 project endpoint
  -> Bifrost request body replacement
  -> OpenAI provider adapter
  -> mock provider HTTP endpoint
```

Input body used by the current exact-plugin run:

```json
{"model":"openai/gpt-fixture","messages":[{"role":"user","content":"hello current"}]}
```

The mock ACE projection inserted an ACE system message. The final mock-provider body was:

```json
{"model":"gpt-fixture","messages":[{"role":"system","content":"[ACE fixture context]"},{"role":"user","content":"hello current"}]}
```

Observed result: Bifrost returned HTTP 200, the mock provider received the transformed body, and the response carried Bifrost request/provider correlation headers.

## Strict negative path

A second Bifrost process ran with the host attestation absent and `ACE_GATEWAY_STRICT=true`.

Observed result:

- Bifrost returned HTTP 503 with `ACE host identity attestation is unavailable`.
- Mock provider body digest remained unchanged:
  - before: `ef737075f1ef663b6c9441075f30679531eae03d6560727cbcb9ed8b9fe44824`
  - after: `ef737075f1ef663b6c9441075f30679531eae03d6560727cbcb9ed8b9fe44824`
- No provider request was made for the blocked attempt.

## Limitations

- The upstream provider was a local deterministic mock, not OpenAI or another external provider.
- The ACE endpoint in this proof was a mock projection responder; ACE HTTP transport unit/contract tests are separate.
- Final provider-wire proof exists for the exact Bifrost/plugin/mock configuration above only. Anthropic, Responses, streaming input, retries/fallbacks and provider-managed history remain uncertified.
- Governance/config-store emitted startup warnings because this disposable Bifrost fixture intentionally used an in-memory/no-config-store setup; they did not prevent the tested HTTP route from running.
