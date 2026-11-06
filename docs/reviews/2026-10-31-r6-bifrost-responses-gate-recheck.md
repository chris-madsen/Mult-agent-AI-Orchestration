# R6 Bifrost Responses gate recheck

**Date:** 2026-10-31

**Scope:** recheck the approved R6 gates in `.hermes/plans/2026-10-31_185031-ace-r1-r6-resync-followup.md`, §5, against current Bifrost source/PRs and ACE composition. This is a status review, not route implementation or authorization for data egress.

## Decision

**R6 remains BLOCKED; no Chat Completions route or fallback was used.** Bifrost has made real progress on a dedicated Codex OAuth/Responses passthrough and terminal usage handling. That path is not the required ACE-integrated public `/v1/responses` route, and it does not close the raw-body privacy, model-counter/context-window, or ACE final-delivery-receipt gates. No Bifrost provider request or private-code transmission was made.

## Current Bifrost evidence

The inspected Bifrost `dev` head was `d5a36220c7fea61e9b50e501a7fc63080520c3c8`. Merged commit `43e55b2a61a1873a402f49366df49f9c2f964cd2` is an ancestor of that head.

| Upstream item | Current state at review | What it proves / does not prove |
| --- | --- | --- |
| PR #9074, head `5c672a95809c83494621a11a94c885d02fa1d53e` | Merged into `dev` on 2026-10-27 | Adds the dedicated ChatGPT/Codex passthrough model-list path and caller OAuth-key preservation for passthrough requests. Current `NewChatGPTPassthroughRouter` allows only `GET /chatgpt_passthrough/backend-api/codex/models` and `POST /chatgpt_passthrough/backend-api/codex/responses`; it is not a general proxy or the required standard `/v1/responses` route. |
| PR #9196, merge commit `43e55b2a61a1873a402f49366df49f9c2f964cd2` | Merged into Bifrost `main` on 2026-10-27; commit is present in current `dev` | Carries the dedicated OAuth/Responses work and terminal-stream completion logic. Current Bifrost code recognizes `response.completed`, `response.failed`, `response.incomplete`, and `error`, and extracts usage from terminal Responses payloads. This is provider-side usage telemetry, not an ACE receipt bound to final provider egress. |
| PR #4548, head `900cd63273b936a531014ff72d9c5447f02f0c4c` | Open against `dev`; review required; last updated 2026-08-26 | The current diff enables raw request-body forwarding. It contains no explicit `Store=false` assignment, and the open review identifies that typed-request mutation does not protect the raw-body path. No privacy test/proof for this path was found; do not pin or use it for ACE data. |
| PR #8008, head `f192f0f97e79f4d810255d59cc211a1db6a48a43` | Open against `dev`; review required; last updated 2026-10-06 | Its OAuth/key-selection change is still open for the broader OpenAI passthrough path. The PR explicitly limits the caller-credential skip to raw passthrough; typed OpenAI `/v1/responses` is not thereby proven to preserve Codex OAuth. The dedicated route from #9074 is a separate, narrower capability. |
| PR #9142, head `81ba7fd91dcc7fc1a6afc069515c0375a42df81f` | Open against `dev`; changes requested; last updated 2026-10-26 | Remains unmerged. Do not infer its review state is a failure of all provider-side usage extraction: current `dev` already has terminal Responses usage parsing through the merged #9196 path. It still does not supply ACE's attempt-bound final-delivery receipt. |
| PR #9177, head `0c0e2cba9be3ed14121964a71eba5b91176196b6` | Open against `dev`; changes requested; last updated 2026-10-27 | Its terminal-stream behavior was brought to `main` by #9196 and is present in current `dev`; the open PR itself is not proof that current `dev` lacks stream completion. |
| PRs #9141 / #9152 | Open against `dev`; changes requested | Related Codex model-list/tool forwarding follow-ups remain unmerged; no full Hermes tool-capability E2E was established. |

The merged dedicated route uses a custom `chatgpt_passthrough` path, not the requested standard Bifrost `/v1/responses` ingress. The standard-route OAuth/privacy proof remains absent. A successful Bifrost usage log would still be insufficient: ACE needs a final-send receipt correlated with the exact projection and provider attempt.

## Current ACE composition

- `src/transport/gateway-projection-http.ts:44-58` advertises only `openai.chat.completions`; `record-delivery` returns HTTP 501 (`PROVIDER_WIRE_NOT_CERTIFIED`).
- `integrations/bifrost/ace-connector/plugin/main.go:177-178` rejects requests without `ChatRequest`; `PostLLMHook` at `:195-196` is a no-op. This is not a Responses final-egress integration. It was not invoked because Chat Completions is prohibited for this task.
- `src/bin/ace-mcp.ts:1133-1145` constructs `makeContextAssembler()` without a token counter.
- `src/domain/context-assembly.ts:65-66,90,135` falls back to `ceil(text.length / 4)` and labels it `character_estimate`. `src/application/context-transform-service.ts:174-186` marks that output `partial`, not model-ready.
- `src/application/gateway-projection-service.ts:65` derives `budgetTokens` from remaining deadline time rather than a verified model context window/output reserve.
- The approved plan's corrected requested pair is model ID `openai-codex/gpt-6-luna` and `reasoning_effort=xhigh` as separate values. Neither exact support on the selected route nor the effective context window/pre-send model counter was verified. In the runner, `BIFROST_SOURCE_ROOT`, `ACE_BIFROST_BASE_URL`, `ACE_CONTEXT_MODEL`, and `ACE_CONTEXT_WINDOW` were unset.

## Gate matrix

| Gate | Status | Reason |
| --- | --- | --- |
| Hermes through the required Bifrost `/v1/responses` route | **BLOCKED** | The implemented ACE connector is Chat-only; the merged upstream Codex route is a custom passthrough path, while the standard route's OAuth path is not certified. |
| Raw-body privacy / `store:false` | **BLOCKED** | #4548 remains open with a raw-body path and no verified enforcement/test. No egress was attempted. |
| Bifrost-side terminal Responses usage | **PARTIAL / present upstream** | Current Bifrost `dev` observes terminal usage; this does not create ACE's exact-attempt delivery receipt. |
| ACE final provider-egress receipt | **BLOCKED** | `record-delivery` is 501 and `PostLLMHook` is a no-op. |
| Model-compatible pre-send counter and effective context window | **BLOCKED** | No counter/window is wired; character estimation is explicitly partial. Post-response usage parsing is not a substitute for pre-send budgeting. |
| Exact model/effort and full Hermes Responses E2E | **NOT RUN** | No Bifrost endpoint/runtime was configured; model/window identity and safety prerequisites are unverified. |
| Private-code egress | **NOT AUTHORIZED / NOT PERFORMED** | The user has not granted destination-specific permission. |

## Stop conditions

Do not implement a Chat Completions adapter or fallback, do not pin an unmerged Bifrost commit, and do not run ACE against the Codex passthrough. Resume R6 only after the owner-approved Responses ingress and `store:false` privacy invariant are proven, the exact model/effort/window and compatible existing counter are verified (otherwise return `BLOCKED`/`NOT_READY`), and ACE can record a redacted attempt-bound receipt at final provider egress. Only then run the synthetic Hermes pair; private source requires separate authorization.

No production, benchmark, token-savings, or agent-E2E claim changes in this review.
