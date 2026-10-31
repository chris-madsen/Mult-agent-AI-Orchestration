# Bifrost Codex Responses upstream gate — 2026-10-31

**Status:** `BLOCKED_UPSTREAM` for the no-API-key Hermes Codex OAuth route. This is a static source and GitHub-state review only; it is not provider-wire, Hermes E2E, or production evidence.

## Scope

The target is the full Hermes agent using its existing `openai-codex` OAuth store, exact model `openai-codex/gpt-6-luna-xhigh`, and `reasoning_effort=xhigh`, routed through Bifrost Responses. API-key and Chat Completions fallback are excluded. ACE must own exactly one projection path, and private requests require `store:false` plus an attempt-bound final-egress/usage receipt.

No Bifrost code was copied or modified. No experimental upstream revision was pinned.

## Exact pinned source inspected

- Repository: `maximhq/bifrost`
- Source commit: `fe7634a6c828927d05ffdd57c62be0aaab04193f`
- License: Apache-2.0 (`LICENSE`)
- Core module: `core/go.mod` declares Go `1.27.3`

Relevant source boundaries:

- `transports/bifrost-http/integrations/openai.go:720-790` registers the generic `/v1/responses` route; `:792-829` registers `/v1/responses/input_tokens`.
- `core/providers/openai/openai.go:1967-2010` implements generic OpenAI Responses. It may call `shouldFallbackResponsesToChat`; `store:false` is applied only when the provider's `disableStore` option is enabled.
- `core/providers/openai/openai.go:5211-5232` implements `CountTokens` by resolving a provider key and calling `/v1/responses/input_tokens`.
- `core/providers/openai/large_payload.go:32-69` streams the original request body in large-payload mode. `core/providers/utils/utils.go:2635-2647` returns `RawRequestBody` directly when `UseRawRequestBody` is enabled, bypassing typed conversion.
- In the ACE checkout, `integrations/bifrost/ace-connector/plugin/main.go:108-137` only projects `/v1/chat/completions` and labels it `openai.chat.completions`; `:195-196` leaves `PostLLMHook` as a no-op.
- The retained ACE wire review `docs/reviews/2026-10-25-bifrost-gateway-wire-e2e.md` is `MOCK-PASS` for one Chat Completions route only; it explicitly does not certify Responses, streaming, or a real provider.

Generic OpenAI Responses support is not proof of a Codex subscription OAuth route. The pinned Bifrost tree contains no exact `gpt-6-luna-xhigh` model entry. The Bifrost token-count endpoint is a candidate provider-native counter, but its compatibility with this exact model and caller OAuth route is unverified; it also does not establish the model's effective context window.

The pinned Hermes runtime is a separate boundary and must not be conflated with Bifrost readiness. Hermes tag `v0.22.3` resolves to commit `5b147ab036d6d19131bff8d20701b5001eab844a`. At that commit, `agent/reasoning_effort.py` declares `xhigh` in the Codex reasoning ladder, `hermes_cli/codex_models.py` lists `gpt-6-luna` in the static Codex catalog, and `agent/transports/codex.py` strips only the explicit Hermes `-900k` context alias before the wire. It does not define a special `gpt-6-luna-xhigh` alias or strip an `-xhigh` suffix. Therefore this PR may preserve an owner-selected exact slug for later provider validation, but it does **not** prove that slug is routable. Provider-wire acceptance remains blocked until the real authenticated route accepts the exact model identity.

ACE also must not hard-code a guessed context window for this configuration. Hermes `v0.22.3` already owns provider-aware Codex context resolution (including live metadata and its own fallback/opt-in context variants), so the Harbor adapter leaves `context_length` unset instead of overriding it locally.

## Unmerged upstream candidates observed on 2026-10-31

| PR | Head | State / review | Scope |
|---|---|---|---|
| [#4548](https://github.com/maximhq/bifrost/pull/4548) | `900cd63273b936a531014ff72d9c5447f02f0c4c` | Open; review required | Detect ChatGPT subscription token and route Responses to `chatgpt.com` |
| [#8008](https://github.com/maximhq/bifrost/pull/8008) | `f192f0f97e79f4d810255d59cc211a1db6a48a43` | Open; review required | Preserve caller OAuth credentials for OpenAI passthrough |
| [#9142](https://github.com/maximhq/bifrost/pull/9142) | `81ba7fd91dcc7fc1a6afc069515c0375a42df81f` | Open; changes requested | Capture usage from terminal Responses passthrough events |
| [#9177](https://github.com/maximhq/bifrost/pull/9177) | `0c0e2cba9be3ed14121964a71eba5b91176196b6` | Open; changes requested; CodeQL and dependency-review checks failed | Follow-up for Responses stream completion and usage |

PR #4548 sets `UseRawRequestBody` on its passthrough route and separately sets `Params.Store=false`. The pinned raw-body path returns the original body without applying the typed conversion; the PR's added tests do not prove that the final provider-bound raw body contains `store:false`. This is a static safety gap requiring an upstream fix or a final-wire test, not a claim that a live private-data leak was observed.

PR #9177's current review requests failure events to reach the post-hook as failures and a deterministic integration test of the real parked-stream binding. Its current open/review state is not sufficient evidence for final usage receipts. PR #4548 and #8008 are also not merged/released dependencies.

## Gate decision

Do not add the ACE Responses route or provider-usage receipt against these unmerged heads. Do not enable API-key routing, Chat Completions translation/fallback, a local JWT/OAuth shim, or a custom SSE proxy. Do not treat `CountTokens` as R6 readiness until the exact model, OAuth route, context window, privacy authorization, and returned count are verified.

Resume route implementation only after either:

1. the required support is merged/released and pinned to an exact clean upstream commit; or
2. the owner explicitly approves a specific experimental Bifrost commit for this route.

Before strict use, evidence must cover caller OAuth preservation, final Responses egress with `store:false` on normal and raw/large-payload paths, disabled Chat Completions fallback, protected-field fidelity, and correlated usage on completed and failed streams. R6 additionally needs a verified exact-model counter and context window. Until then, R6/G3 are `BLOCKED`; no provider-wire, Hermes E2E, benchmark, or production claim is made.
