# Code review: ACE/Hermes token economics and excessive benchmark scaffolding

**Date:** 2026-10-26
**Scope:** repository-wide benchmark/economics review; **not** an inline review of PR #169 only.
**Baseline:** `main@fcd537f1751df4761b836844b3f250258479dcc6`; current unmerged implementation evaluated separately at **PR #169 `a9173daffb09013a4a1f2d4fe87faf65c2df5954`**.
**Disposition:** **BLOCKING for any token-savings claim**; the repo is not yet empirically shown to make Hermes cheaper with ACE. The necessary next action is one measured paired trial, not more infrastructure.
**Execution plan:** [2026-10-26 ACE/Hermes economics and cleanup](../plans/2026-10-26-ace-hermes-economics-and-cleanup-plan.md) (also accessible as root `plan.md`).
**Tracking:** [Issue #171](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/issues/171), [PR #169](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/pull/169).

## 1. Historical results: negative evidence, not Hermes evidence

| Artifact and instrument | Native | ACE arm | Valid inference |
| --- | ---: | ---: | --- |
| `benchmarks/reports/ace-retrieval-paired-3x3-final-indexkey.json`: **Codex**, 9 runs per arm | 9/9 passed; **891,950** total tokens; **$0.0569132** | 9/9 passed; **1,571,768** total tokens; **$0.08538924**; ACE called 9 times | **+76.2% tokens, +50.0% reported cost** with equal task reward. Adverse diagnostic result, **not a Hermes ContextEngine measurement**. |
| `benchmarks/reports/ace-local-smoke-natural-paired-repeat5.json`: **Codex**, 5 runs per arm | **362,152** total tokens | **300,432** total tokens | `successfulAceContextCalls=0` **in both arms**. The apparent lower spend cannot be credited to ACE. |

The first result is important but not directly portable to Hermes because the invocation path and measurement instrumentation differ. Neither historical artifact establishes savings for the current Hermes plugin. Cached input, provider attempts, and downstream indexing/provider costs must be reported separately when supported; an unknown cost is not $0.

`benchmarks/harbor/ace-local-smoke-paired/instruction.md` asks only to replace `TODO` with `DONE`. That is a plumbing smoke, **not** a retrieval-demanding economics trial. The existing `benchmarks/harbor/ace-retrieval-impact/instruction.md` is substantially better: find the connection-retry budget defect behaviorally, preserve unrelated payment retries and exports.

## 2. Findings, severity and evidence

### R1 — P0: actual Hermes/ACE saving remains unmeasured

There is **no retained, independently reproducible, provider-measured Hermes native vs Hermes+ACE pair on the current implementation**. Green unit/contract CI, bridge receipts, approximate context-length differences and task verifier passes each prove different things, none alone proves token savings.

**Required:** one real task and one native/ACE pair, with source/agent/model/image/config pinned, task quality, provider usage and outbound ACE context attribution. Stop on missing credentials or instrumentation; record `BLOCKED`/`UNKNOWN`, never invent data.

### R2 — P0: request-local receipt != outbound LLM evidence

`integrations/hermes/ace_context_engine/engine.py` writes a receipt whose `providerRequestId` identifies **ACE retrieval/provider work**, not necessarily the actual Hermes outbound model request. The plugin's `_estimated_tokens` is a content-character heuristic; it omits provider wrappers, caching, tool schemas and multimodal accounting. Even `deliveryMode=replacement` only claims a locally smaller projected content estimate.

**Required:** correlate applied ACE projection with each real model-bound attempt and its measured input/cached/output tokens. Label unverifiable attribution `UNKNOWN`. Do not count no-op projections as applied savings.

### R3 — P0: current ACE projection is narrow, not a general context optimization

**At `main` baseline** the Hermes plugin appends `[ACE verified context]` to the latest user message while retaining all prior request messages; it inherently increases request-local content. **PR #169** changes this: `AceContextEngine` inherits native `ContextCompressor`, and `select_context` only accepts a net-smaller projection after replacing old **exactly identical** large tool-output duplicates; otherwise it records `not_beneficial/no_op` and leaves the input unchanged. The plugin has **not** implemented general source-covered selective historical context replacement. Do not represent the narrow dedupe as generalized ACE savings or the 5× goal.

**Required:** empirically exercise a real applicable replacement before claiming the feature worked. If the one-task pair shows `no_op`, report it and then choose a controlled replacement experiment with protected system/latest turn/tool dependencies; no heuristic dropping of essential code context.

### R4 — P1: baseline parity fixed in config, not proven in live runtime

At `main`, ACE plugin displaces native Hermes compression; its old `should_compress=False` and identity `compress` confound A/B. **PR #169** fixes the intended design by inheriting native `ContextCompressor` and setting identical 128K/model/compression config for both arms in `scripts/harbor_hermes_codex_oauth.py`. This is a **code/config fix**, not yet an in-process verification that effective threshold, cleanup, cache policy and fallback are identical.

**Required:** capture effective native and ACE config/runtime identities, test actual compactor behavior and rule out inadvertent fallback before the trial.

### R5 — P1: benchmark and test maintenance cost has grown ahead of evidence

At baseline `main`, a path-name inventory found **43 `.ts` files containing `harbor` or `feedback`**, counting scripts, domain/adapters and tests (**420,928 bytes, ~421 KB**); `test/` contains **97 `.test.ts` files**. These are *inventory statistics*, not claims that every file is dead code. Multiple generations coexist: `harbor-three-arm` and `harbor-four-arm` domain/gates, freezing, aggregation and reports. Only a narrow subset is on the one-pair critical path.

**Candidates for dependency audit**, not blind deletion:
- `src/domain/harbor-three-arm.ts`, `src/domain/harbor-four-arm.ts`, `src/domain/harbor-four-arm-evidence.ts`;
- `scripts/harbor-three-arm-gate.ts`, `scripts/harbor-four-arm-gate.ts`, `scripts/freeze-harbor-four-arm-jobs.ts`;
- `scripts/render-harbor-paired-report.ts`, `scripts/render-harbor-retrieval-report.ts`;
- associated test owners, `package.json` scripts, CI and spec/evidence consumers.

The three Codex-named TypeScript files are `scripts/recall-codex-history.ts`, `src/adapters/codex-session-history.ts`, `src/adapters/codex-usage-events.ts`: legacy session/usage adapters, **not** another primary coding agent. `openai-codex` in the Hermes Harbor adapter is the **Hermes OAuth provider route**, not Codex CLI. Preserve archival compatibility and authentication unless a dependency/usage audit proves a specific path dead.

### R6 — P2: avoid full test and benchmark suites in the hot editing loop

The present `PR #169` sets `npm run test:fast` to `test:affected` while retaining full `verify:pr`. The complete deterministic CI on its audited HEAD succeeded (549 TypeScript and 20 Hermes Python tests), but these are **not** provider-economics data. Use one owned targeted test during fixes, full `npm run verify:pr` once for PR gate, and real Harbor only for actual measurement. Delete or merge tests **only after** proving their invariants remain covered.

## 3. Expected minimal architecture and evidence boundary

```text
native arm: Hermes + native ContextCompressor -> LLM -> task verifier
ACE arm:    Hermes + native-equivalent compressor + ACE selector -> LLM -> verifier
                |                       |
           same configuration      applied context / no-op receipt
                                               |
                              outbound request correlation + provider usage
```

Do not add a second agent, speculative Bifrost gateway, new four-arm runners, synthetic TODO economics metrics, extra TS layers or a second independent report format to answer the first A/B question. Existing Bifrost plans/ADRs have separate gates and must not be silently repurposed.

## 4. Decision / review exit criteria

1. **P0 evidence:** one reproducible native-vs-ACE Hermes task report with measured quality and real provider usage, plus `ACE_APPLIED`/`NO_OP`/`UNKNOWN` provenance. A `NO_OP` result is valid diagnostic evidence **but not a token-economy success**.
2. **P1 root cause:** if quality/cost/tokens regress, identify the exact cause, fix **that** mechanism, repeat the same pair before scaling.
3. **P2 cleanup:** publish a dependency-backed inventory, then a **separate cleanup PR with a negative net diff where justified**, keeping historical traces/reports and required adapters.
4. **P3 validation:** only after promising one-pair evidence, run repeated comparisons and independent holdouts; preserve 5× as an unproven target.

**This review is completed as a static/repository-evidence audit, not as a fresh real-provider test.** It does not approve production or merge PR #169. See the [canonical executable plan](../plans/2026-10-26-ace-hermes-economics-and-cleanup-plan.md).
