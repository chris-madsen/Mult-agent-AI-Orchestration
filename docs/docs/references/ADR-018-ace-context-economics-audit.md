# ACE/Hermes Harbor context-economics audit (PR #164)

**Review status:** implementation has **blocking architecture/economics gaps**. Runtime readiness and quality successes do not constitute context-cost savings.  
**Code base:** PR #164 plus cross-cutting Hermes plugin, ACE bridge, retrieval service, Harbor adapter, token/evidence collectors, pinned upstream Hermes v0.22.3.  
**Evidence boundary:** historical Codex reports are committed; the PR describes a recent local Hermes 9/9 test with artifacts under /tmp, but the corresponding raw Hermes trial archives and per-request provider observations are **not in Git**. New Hermes token totals cannot be independently reproduced from this commit alone.

## Executive finding: root cause

1. **P0 / Wrong optimization:** `integrations/hermes/ace_context_engine/engine.py::_select_context_strict` copies every provider message and appends `[ACE verified context]` to the latest user content. It never selects a smaller transcript. It is **augmentation**, not replacement. Source retrieval can be valid but added text always consumes additional request tokens.
2. **P0 / Native compaction accidentally replaced:** `agent/agent_init.py::_build_context_engine` (Hermes v0.22.3) selects exactly one context engine. An external ACE engine substitutes the default `ContextCompressor`. ACE has `should_compress() == False`, `compress() == identity` and does not provide `prune_tool_results_only`. Native Hermes instead has compaction and proactive tool-result pruning. Hence the pair compares **built-in compaction vs no compaction + retrieval**, not simply without/with ACE retrieval. This requires a composite engine or a separate request interception seam that preserves native compressor.
3. **P1 / Unequal model configuration:** `scripts/harbor_hermes_codex_oauth.py::_provider_config` previously added `model.context_length=128000` only for ACE. This has now been aligned across arms in this PR.
4. **P1 / Missing wire-level proof:** ACE receipt `providerRequestId` refers to an internal ACE retrieval/provider trace, **not** the LLM API call leaving Hermes. A valid ACE receipt proves retrieval and local request projection, not actual model-bound delivery. New local estimates/digests prove append-only growth, not upstream bytes or true model token counts. Need provider-side capture or signed provider-request correlation for every attempt.
5. **P1 / Cache confounder:** an appended user-message block changes the token sequence and can affect provider prefix caching; neither 9/9 reward nor aggregate token totals explain cache hit ratios, resends, or increased agent-tool turns. Break down cached-input, uncached-input, output, cost and number of provider attempts.
6. **P1 / Insufficient task/verifier depth:** three local Harbor task tests each contain a small functional assertion. `tests/test.sh` awards 1.0 if tests pass and the log exists. This is legitimate narrow functional verification but does not establish that ACE retrieval was necessary, that its source was used, or that long-context/token-replacement works. No generalization to five-fold savings.
7. **P1 / Mutable image tag:** `scripts/build-harbor-ace-runtime.mjs` and runtime probe previously verified the local digest then executed a mutable tag on equality. Fixed: execute immutable verified image ID instead.

## Historic published evidence (do NOT label as Hermes evidence)

`benchmarks/reports/ace-retrieval-paired-3x3-final-indexkey.json` is a **Codex** experiment (CSV labels: `native-codex`, `codex-plus-ace`), 9 trials per arm, all quality=1.0. Native total 891,950 tokens vs ACE 1,571,768 (**76.2% more**); costs USD 0.0569132 vs 0.08538924 (**50.0% more**); 9 successful ACE calls and provider receipts in ACE arm. It demonstrates that ACE was called in that specific prior run, but neither performance nor savings. `ace-retrieval-paired-3x3-abs.json` has ACE calls **zero**, so it must not count as successful ACE integration despite quality=1.0.

No artifact or locally observed PR-#164 Hermes token number should be inferred from either report.

## Fixes in this PR

- Executable Docker image now immutable after ID verification.
- Paired Hermes native/ACE config pins the same model context window.
- Hermes v1 receipts expose `deliveryMode=augmentation`, original/projection token **estimates**, added estimate, and SHA-256 digest of both request-only projections. Their fields are validated for self-consistency and explicitly do NOT claim real provider usage/savings.
- Additional unit/contract tests on these fixes; CI must pass.

## Required before acceptance as a token-saving project

**Gateway/host integration — blocked design work:**
- Introduce a genuine context-selection IR: immutable system/control, tool-call/result dependency graph, protected latest turn, provider-native reasoning and opaque metadata, source-covered replaceable historical content.
- Preserve native Hermes compaction behavior through a composite `ContextCompressor + ACE selector`, or integrate ACE after compressor using a host seam without disabling default pruning. Run a paired test where both arms have identical compression settings and thresholds.
- Only replace prior context if a semantically valid smaller projection is possible. `not_beneficial` must be a declared no-op, not a 'savings' receipt. Use real provider usage for comparison.

**Proof / instrumentation:**
- Emit one event **per outbound LLM API attempt** including attempt IDs, exact provider/model, raw projected hash, cache usage, tool count, input/output tokens, and cost (without raw prompt contents); correlate each with ACE projection.
- Track transformations, skips, failures, and fallbacks explicitly. Require `aceAppliedRequests == observedProviderRequests` for strict ACE benchmark. Do not infer this from bridge retrieval receipts.
- Define reward, provider-usage and timing reconciliation over pinned source+task+image+model+agent+compiler versions; report 95% uncertainty bands for repeated comparable tasks.
- Add long realistic sessions, repeated source inspections, structured reasoning/tool calls, cache warm/cold arms, and verified synthetic tasks that cannot trivially pass without selected contextual information.
- Separate `quality=pass`, `ACE delivery=verified`, and `economy=improved` (three independent gates). `9/9 reward=1.0` only closes the first.

## Reproduction checklist

1. Freeze exact Hermes v0.22.3 SHA, PR HEAD, ACE plugin+bridge+runtime digests and all task-image IDs.
2. Save manifest of both `config.yaml` files; diff should permit only plugin hook configuration.
3. Run baseline and ACE with the same built-in compaction policy (requires composite adapter implementation), same cache condition and same task seed.
4. Capture provider request-count and usage per API request, ACE projection SHA, status, evidence source revision and task reward.
5. Reject a report missing raw provider-bound proof; archive raw artifacts outside checkout but publish an immutable reference/digest suitable for verification.
6. Compute raw totals and billable costs. Accept savings only on positive verified net improvement with non-inferior quality.

## Audit caveats

This is a focused **cross-layer code-path audit**, not a claim that every file in the entire repository was line-by-line examined. Broader modules (Graphiti, Qdrant, LSP, MCP, backup/restore and deployment) have their own contracts; none can logically compensate for append-only LLM context delivery. Detailed native compressor composition and wire-level egress measurement require a separate implementation and a new Harbor run.
