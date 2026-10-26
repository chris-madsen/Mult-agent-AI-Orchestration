# Execution plan: real ACE/Hermes token-economics measurement, then benchmark cleanup

**Date:** 2026-10-26
**Status:** **PROPOSED — awaiting explicit owner approval**. Do not interpret a plan file or `/approve` syntax as proof that authorization, agent runtime access or provider credentials are present.
**Tracker:** [Issue #171](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/issues/171)
**Source review:** [2026-10-26 ACE/Hermes benchmark-bloat review](../reviews/2026-10-26-ace-hermes-token-economics-and-benchmark-bloat-review.md)
**Repo root entry point:** `plan.md` is a symlink to **this exact file** so, after checkout of the docs PR or merge, Hermes can open `/approve plan.md` without maintaining duplicate plan copies.
**Scope:** narrow measurement first; separate, evidence-driven deletion later. This is a scoped follow-up to `docs/plans/ace-real-feedback-loop.md`, **not** a competing production/gateway roadmap. Current owner instructions, Accepted ADRs, OpenSpec and `AGENTS.md` take precedence.

## Objective and success definition

Answer the practical question **"On the same task/model with native Hermes baseline, does ACE actually reduce provider-measured tokens and cost without reducing task quality?"** in the fewest moving parts. The immediate acceptable output is an **honest measurement, including a negative/unknown result**. Do not claim 5×. The second objective is to remove demonstrably redundant benchmark paths **without deleting historical evidence or useful contracts**.

**Preconditions:** a checkout containing the benchmark code under test, trusted host with Hermes, Docker, Harbor, pinned ACE runtime image/bundle and a dedicated Hermes `openai-codex` OAuth store. If unavailable, record a concrete `BLOCKED` status and stop; do not generate fake trial data.

### No-go rules for this execution

- Before first valid paired run: **no new three-/four-arm machinery, reporter/parser framework, dashboard, other agent, TODO economics benchmark or general rearchitecture**.
- No changes to historical benchmark JSON, raw sessions, accepted ADRs, provider-auth storage or immutable task verifier to manufacture a gain.
- Do not write raw provider requests, secrets or task checkouts into this repo. Retain hashes, manifests and report pointers here; raw artifacts outside the checkout.
- Do not merge the separate cleanup work into PR #169. Source changes belong in scoped implementation PR(s); cleanup follows only after an interpretable baseline.
- Use **targeted tests on the edit loop**, one `npm run verify:pr` at handoff, live Harbor only for measurement.
- Not a production approval or instruction to relax source verification, privacy, host attestation or tool-call/result integrity.

## Stage 0 — Freeze and verify a fair runnable pair (P0; no new infrastructure)

- [ ] Check out the **actual proposed Hermes implementation** (PR #169 HEAD `a9173daffb09013a4a1f2d4fe87faf65c2df5954` at plan authoring time, or record its newer tested SHA); do **not** measure old `main` and label it as this fix.
- [ ] Confirm native vs ACE use the **same** Hermes version, model, reasoning effort, source revision, container digest, toolset, task instructions, provider/auth route, native compression threshold/pruning and cache condition. Verify the **effective** engine and compressor at runtime; equal YAML is insufficient.
- [ ] Record exact plugin/bridge/bundle digests and input task image digest; confirm real host credentials without printing tokens. If plugin registration falls back to native or ACE is disabled, classify the ACE run invalid.
- [ ] Run existing focused local checks if needed: `npm run test:hermes-context-plugin`; run `npm run test:affected -- --base origin/main` only when modifying source; defer full `verify:pr` to code handoff.

**Exit:** a reproducible pinned pair (two effective configs + source/task/binary/image hashes) and successful auth/runtime preflight, or a precise `BLOCKED` reason.

## Stage 1 — Run exactly one nontrivial paired task (P0; first economics signal)

- [ ] Task: **`benchmarks/harbor/ace-retrieval-impact`**, not `ace-local-smoke-paired`. It requires finding/fixing the connection retry-budget implementation while preserving payment retries. Verifier unchanged.
- [ ] Run **one native and one ACE-optional** Hermes trial, serially, with identical user task, model/reasoning and source. Do not force a tool-call in only one arm. No multi-seed, warmup marathon or holdout yet.
- [ ] Prefer the existing fast entry point **only if** its duration bound permits completion and its actual task, identities and reports are correct:

```bash
# Trusted host only. All variables must be set to real verified values.
# OUTPUT MUST be outside the ACE repository.
npm run bench:feedback-fast -- \
  --source-root "$SOURCE_CHECKOUT" \
  --task-path benchmarks/harbor/ace-retrieval-impact \
  --ace-runtime-bundle "$ACE_RUNTIME_BUNDLE" \
  --task-image "$TASK_IMAGE_REFERENCE" \
  --task-image-digest "$TASK_IMAGE_REFERENCE=sha256:$TASK_IMAGE_SHA256" \
  --model "$MODEL" \
  --reasoning medium \
  --output "$EXTERNAL_RUN_DIR" \
  --max-runtime-sec 180
```

  The existing `scripts/run-fast-feedback-loop.ts` bounds the entire procedure to **1–180 s**, not each agent attempt. It may time out on real retrieval tasks: **TIMEOUT/BLOCKED is an honest result**, not task failure or proof of cost savings. If it cannot complete a meaningful task, use the **existing** prepare/preflight/Harbor/collect scripts with an appropriately bounded host run, or make only a justified minimal runner timeout change — **do not create a second runner**. Preserve one attempt per arm for the initial diagnostic.
- [ ] Record **per actual outbound LLM API attempt**: true provider/model/mode, request+projection correlation, applied-vs-no-op ACE, `input_tokens`, `cached_input_tokens`, calculated uncached input (only when measured fields support it), `output_tokens`, aggregate tokens, requests/retries, tool turns, elapsed time, reported cost and auxiliary provider/indexing cost as **measured / estimated / unknown**.
- [ ] Bind task verifier pass/fail independently of economy; store raw logs outside the checkout; retain sanitized report, artifact path and SHA-256 in an evidence summary. Do **not** interpret bridge `providerRequestId` as an actual model request ID.

**Minimum table:** task + SHA, arm, task pass/fail, provider attempts, ACE `APPLIED/NO_OP/NOT_USED/UNKNOWN`, provider measured input/cached/output/total tokens, cost, latency, limitations.

**Exit:** one genuine `native vs ACE` pair with real provider data and proof that an accepted ACE projection reached the model-bound attempt, **or** explicit `BLOCKED/UNKNOWN` including which required measurement is missing. **NO_OP is not a win even if observed tokens happen to differ.** The first pair is a diagnostic, not statistical validation.

## Stage 2 — Correct exactly what Stage 1 exposes (P1)

Choose the first concrete failure and do **not** build all paths in parallel:

- [ ] **ACE never used / no-op**: inspect actual `select_context` invocation, source retrieval, eligible historical spans and why exact duplicate tool-output replacement was inapplicable. If meaningful source-covered shrinking is necessary, design a **minimal** selector preserving system/control, recent user turn, tool-call/result linkages, metadata and source obligations. Do not remove historical messages solely to save tokens.
- [ ] **Higher input/cached tokens or cost**: reconcile host compaction, retries/fallbacks, cache prefix churn, repeated tool reads, retrieval chatter and auxiliary indexing/inference. Fix measured cause, not a speculative hotspot.
- [ ] **Worse quality/security**: disable/revert the risky projection; preserve verifier, provenance and fail-closed behavior. Do not trade correctness for token savings.
- [ ] **Provider-bound usage/correlation missing**: instrument the **single existing request seam** necessary for proof rather than add a new benchmark framework.
- [ ] Add the **smallest deterministic regression** to an existing owning test file, run focused checks, then **repeat the exact same one-pair task** with new source SHA and same other identities.

**Exit:** recorded `RED symptom → root cause → minimal code diff → focused test → paired rerun`. If savings still absent, state that. Do not scale repeats until there is an interpretable mechanism/measurement.

## Stage 3 — Deduplicate benchmark code in a separate cleanup PR (P2)

- [ ] Build an inventory for the **43-path Harbor/feedback TS subset** (baseline inventory, includes tests): each `file → importing modules → package CLI → CI workflow → applicable ADR/OpenSpec → historical report reader`. Label each `active hot path`, `historical compatibility`, `redundant but referenced`, or `dead/unreachable`.
- [ ] Start with old three-/four-arm gates/reporters/freeze scripts, **not** the active Hermes A/B runner. Investigate any path before deletion; preserve `test/` coverage protecting unique provider, integrity and schema invariants.
- [ ] Keep the **three Codex session/usage files** if they still back real historical replay; `openai-codex` Hermes OAuth remains supported. Do not delete evidence JSON or session archive.
- [ ] Remove genuinely dead scripts and tests; consolidate duplicate implementations only if behavior and evidence readers remain stable. Aim for **negative net production/infrastructure code diff**, not a vanity deletion count.
- [ ] Confirm Stage-1 command/report still works; run changed tests during development (`npm run test:affected`), **one full** `npm run verify:pr` before PR handoff. Document exact files removed, dependents checked and preservation rationale.

**Exit:** a separate reviewable cleanup PR, explicit dependency-backed deletion ledger, no regression in baseline/ACE measurements or retained evidence, and fewer actively maintained paths. Do not merge blindly.

## Stage 4 — Validate reproducibility *only after a useful diagnostic result* (P3)

- [ ] Repeat on same controlled task with at least 3 paired runs and report variance.
- [ ] Add a small independent retrieval-requiring holdout/task; split cold vs warm cache correctly.
- [ ] Compare **task quality first**, then fully metered token/cost/latency distributions. Treat `>=5×` as the unproven long-term target; publish regressions and uncertainty honestly.

**Exit:** repeatable measured improvement at non-inferior quality *or* explicit negative result with recommendations.

## Immediate handoff for Hermes (after owner approval)

1. Read **this plan** and the linked review in full; verify the current branch/head and current repository files against the recorded snapshots.
2. Execute **Stage 0 and Stage 1 first**. No new components until a real missing requirement is reproduced.
3. If the runtime/credentials are unavailable, output **BLOCKED with exact missing prerequisites**, not a speculative implementation binge; do not claim experiments were executed.
4. Bring back an evidence report that states separately `quality`, `ACE delivery`, and `token economics`. Obtain owner review before Stage 2 semantic redesign or Stage 3 destructive cleanup.
5. Every source/code change goes through a PR targeting `main`; **do not automatically approve or merge** PRs based only on this plan.

**Approving this plan authorizes a constrained execution sequence, not the invention of evidence or blanket deletion of old benchmark files.**
