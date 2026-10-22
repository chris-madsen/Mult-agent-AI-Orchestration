# ACE Real Feedback Loop — One-Pass Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use Superpowers `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Each slice is a separate review gate and should normally be a separate PR when it changes repository code.
>
> **Source plan:** [the original feedback-loop plan](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/main/docs/plans/ace-real-feedback-loop.md)
>
> **Status rule:** this document is an execution plan with an evidence ledger. It is not a benchmark result and does not promote a capability to production.

**Goal:** obtain a reproducible answer to whether ACE improves verified code retrieval and agent task economics without reducing task quality.

**Architecture:** preserve the current MCP facade, exact-source reread, provider receipts, source coverage and fail-closed status semantics. Compare native and ACE-optional Harbor trials on frozen inputs; use ACE-forced runs only to diagnose retrieval behavior, never as the natural-use result.

**Tech Stack:** TypeScript/Node.js, Effect, ast-grep, TypeScript Language Server, FastEmbed, Qdrant, MCP SDK, Harbor and Codex.

---

## Authority and non-negotiable constraints

- Current owner decisions, Accepted ADRs, applicable OpenSpec contracts and `AGENTS.md` override this plan.
- Current verified source bytes outrank index payloads and derived documentation.
- Missing or failed required providers produce `BLOCKED`, `NOT_READY`, `PARTIAL` or `UNKNOWN`; they never become an empty success or a zero cost.
- A real provider trace is required for provider claims. A contract test, mock, synthetic metric or configured MCP entry is not agent-E2E evidence.
- Pin source revision, task/dataset revision, runtime/model identity, image digest, configuration digest and artifact SHA-256 before comparing trials.
- Keep raw evidence outside the ACE checkout when it contains external repositories or agent transcripts. Store only a versioned summary and hashes in the repository.
- Do not run Harbor scale/repeat/holdout jobs while the one-task smoke is unavailable or the required endpoint/image provenance is missing.
- Use `npm run test:affected` during code changes and `npm run verify:pr` once before handoff for source changes. Documentation-only edits still require `git diff --check` and plan validation.
- Do not claim a 5× improvement, production readiness or owner approval from this plan.

## Current evidence ledger

Status snapshot: local branch `e371927712a7789f9f0b743eceb5eb7464d4f9a1` (PR #154), compared with current `origin/main` `79c5b71215148a93c19b14c511c20cc061c85306`. The PR is open; its evidence is not a merge or production approval.

| Area | Current status | Evidence and exact limitation |
|---|---|---|
| ast-grep name anchors and CST→LSP runtime path | **PROVIDER-PATH PASS** | `artifacts/feedback/stage0-20261022143741/manifest.json`: current runtime commit `e371927...`, no manual anchor injection, 12 indexed symbols, 9 anchored symbols, 6 LSP-confirmed symbols, 0 unconfirmed required cases. The fixture is synthetic TypeScript; this is not a claim about every language or a natural agent task. |
| Local provider preflight | **PARTIAL** | `artifacts/feedback/preflight/manifest.json` is `READY` at commit `a413e6...`; later follow-up manifests record missing explicit model/image/verifier configuration. Re-run at the exact trial commit with frozen Harbor jobs before Harbor evidence. |
| Real MCP retrieval traces | **AVAILABLE FOR DIAGNOSTICS** | Stage-0 raw MCP, provider and retrieval traces are retained under `artifacts/feedback/stage0-20261022143741/`; they prove the provider path, not agent benefit. |
| Harbor one-task native vs ACE-optional smoke | **NOT RUN / BLOCKED** | PR #154 records that the verifier endpoint and exact SWE-Atlas task images are unavailable in the current environment. No agent-quality or token-economics result exists. |
| Harbor 10-task paired run and independent repeats | **NOT RUN** | Depends on the smoke gate and exact frozen job provenance. |
| RepoBench-R acquisition and source-span mapping | **BLOCKED** | Acquisition/adapter scripts exist, but the official records do not provide enough exact source-revision mapping for a truthful source-bound evaluation. No synthetic repository or placeholder score is allowed. |
| Failure-driven ACE fix and untouched re-run | **NOT STARTED** | There is no accepted natural-use Harbor failure with complete correlation from which to select one causal ACE change. |
| 5×, production readiness and owner approval | **NOT CLAIMED** | No evidence stage has changed these gates. |

The following slices are the remaining work. Completed provider-path work is recorded above and is not duplicated as a new implementation task.

## Execution graph

```text
FB-01 exact-current preflight
  ├─> FB-02 freeze Harbor task/image provenance
  │     └─> FB-03 one-task native + ACE-optional smoke
  │           └─> FB-04 reconcile smoke evidence
  │                 ├─> FB-05 freeze and run 10-task paired set
  │                 │     └─> FB-06 repeat on independent trials/holdout
  │                 └─> FB-07 create one failure card and one targeted fix
  │                       └─> FB-08 rerun diagnostic + untouched case
  └─> RB-01 RepoBench-R source mapping
        └─> RB-02 retrieval ranking/grounding evaluation
```

FB-01/FB-02 are admission checks and should be cheap. FB-03 is the first heavy workflow and must not run until its prerequisites are `READY`. RB-01/RB-02 are independent and may remain blocked without blocking the first Harbor smoke.

---

## Harbor slices

### FB-01 — Re-run exact-current provider admission

**Purpose:** establish a fresh, source-bound readiness manifest before any agent trial.

**Files/artifacts:**
- Read: `scripts/feedback-loop-preflight.ts`
- Read: `benchmarks/harbor/ace-retrieval-codex-config.toml`
- Create outside the repository: `/tmp/ace-feedback/${RUN_ID}/preflight/manifest.json`

- [ ] Create a clean disposable checkout at the exact commit under test; do not use a checkout containing `docs/plans/plan.md` or `docs/plans/plan2.md` as the frozen source.
- [ ] Run:

```bash
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE="/tmp/ace-feedback/$RUN_ID"
mkdir -p "$EVIDENCE"
npm run preflight:feedback-loop -- \
  --output "$EVIDENCE/preflight" \
  --qdrant-url http://127.0.0.1:6333
```

- [ ] Require `node`, `npm`, ast-grep, TypeScript Language Server, FastEmbed, Qdrant, Harbor and Codex authentication to be `ready`.
- [ ] Treat missing `OPENAI_API_BASE`, `OPENAI_API_KEY`, explicit model/reasoning identity or task image digest as `BLOCKED`; do not infer them from the host or from a dashboard.
- [ ] Retain the manifest and its SHA-256. If blocked, stop this graph and record the exact missing provider; do not start Harbor.

**Done when:** the manifest is `READY` at the exact source commit, or an honest `BLOCKED` manifest identifies the external dependency preventing the next slice.

**Out:** Harbor execution, benchmark claims and source changes.

---

### FB-02 — Freeze the Harbor task, source and image identity

**Purpose:** make native and ACE-optional trials byte-comparable before running an agent.

**Files/artifacts:**
- Read: `scripts/harbor-task-identities.ts`
- Read: `scripts/freeze-feedback-task-manifest.ts`
- Read: `scripts/prepare-harbor-feedback-jobs.ts`
- Read: `benchmarks/harbor/ace-retrieval-codex-config.toml`
- Create outside the repository: `/tmp/ace-feedback/${RUN_ID}/tasks/`, `/tmp/ace-feedback/${RUN_ID}/jobs/`

- [ ] Obtain the pinned Harbor registry JSON and exact SWE-Atlas source checkout; verify the checkout is clean and at the registry commit.
- [ ] Run task identity freezing with the actual registry and checkout:

```bash
npm run harbor:task-identities -- \
  --registry /tmp/ace-feedback/${RUN_ID}/registry.json \
  --dataset-id scale-ai/swe-atlas-qna \
  --version ${PINNED_REGISTRY_VERSION} \
  --source-root /tmp/ace-feedback/${RUN_ID}/swe-atlas \
  --output /tmp/ace-feedback/${RUN_ID}/tasks/task-identities.jsonl
```

- [ ] Select exactly ten main IDs and ten untouched holdout IDs from that output. Freeze them once:

```bash
mapfile -t SELECTED_IDS < <(jq -r '.id' /tmp/ace-feedback/${RUN_ID}/tasks/task-identities.jsonl | sort)
test "${#SELECTED_IDS[@]}" -ge 20
MAIN_IDS=("${SELECTED_IDS[@]:0:10}")
HOLDOUT_IDS=("${SELECTED_IDS[@]:10:10}")
MAIN_ARGS=()
HOLDOUT_ARGS=()
for id in "${MAIN_IDS[@]}"; do MAIN_ARGS+=(--main-id "$id"); done
for id in "${HOLDOUT_IDS[@]}"; do HOLDOUT_ARGS+=(--holdout-id "$id"); done
: "${PINNED_REGISTRY_VERSION:?set from the pinned Harbor registry}"
: "${PINNED_DATASET_REVISION:?set from the pinned dataset export}"
: "${PINNED_DATASET_SHA256:?set from the pinned dataset export}"
npm run freeze:feedback-tasks -- \
  --tasks /tmp/ace-feedback/${RUN_ID}/tasks/task-identities.jsonl \
  --dataset-revision ${PINNED_DATASET_REVISION} \
  --dataset-sha256 ${PINNED_DATASET_SHA256} \
  --output /tmp/ace-feedback/${RUN_ID}/tasks/frozen \
  "${MAIN_ARGS[@]}" \
  "${HOLDOUT_ARGS[@]}"
```

- [ ] Inspect every task image with `docker image inspect`; record its exact SHA-256 digest. A tag without a digest is a blocker.
- [ ] Prepare matching native and ACE-optional jobs with the same model, reasoning effort, serial execution, task input, source revision, timeouts and image digest. Use `scripts/prepare-harbor-feedback-jobs.ts`; do not hand-edit provenance fields after generation.
- [ ] Run the preflight again with the generated native/ACE jobs and experiment manifest. Reject contradictory model, source, task or image identity.

**Done when:** `task-manifest.json`, job manifests and preflight manifest bind the same frozen task/source/model/runtime/image identity, or a retained `BLOCKED` artifact explains which external identity is unavailable.

**Out:** actual Harbor execution and result scoring.

---

### FB-03 — Run one native and one ACE-optional smoke trial

**Purpose:** prove the real agent/container/MCP boundary before spending on a larger run.

**Files/artifacts:**
- Read: generated jobs from FB-02
- Read: `benchmarks/harbor/ace-retrieval-codex-config.toml`
- Create outside the repository: `/tmp/ace-feedback/${RUN_ID}/raw-agent-native/` and `/tmp/ace-feedback/${RUN_ID}/raw-agent-ace/`

- [ ] Confirm FB-01 and FB-02 are `READY`; otherwise stop without launching Harbor.
- [ ] Run exactly one task in the native arm and one identical task in the ACE-optional arm, serially, with separate state/artifact directories.
- [ ] Verify inside the first ACE container that `ace_context` is callable, Qdrant is reachable from the container, the source mount is the pinned checkout and provider trace files are writable.
- [ ] Preserve raw agent logs, verifier output, MCP requests/responses, provider receipts, source revision, task SHA, image digest and request correlation.
- [ ] If the ACE-optional arm makes zero ACE calls, record `ACE_NOT_USED`; do not call that a retrieval or token-saving result.

**Done when:** both trials finish with a verifier outcome and complete provenance, or a raw `BLOCKED`/`ACE_NOT_USED` result explains why no paired feedback exists.

**Out:** 10-task economics and any ACE code change.

---

### FB-04 — Reconcile and render the smoke evidence

**Purpose:** ensure the first trial is structurally usable before scaling it.

**Files/artifacts:**
- Read: `scripts/collect-feedback-loop.ts`
- Read: `scripts/render-feedback-summary.ts`
- Create outside the repository: `/tmp/ace-feedback/${RUN_ID}/summary/`

- [ ] Run the collector with the frozen task manifest, experiment manifest, native result and ACE result:

```bash
npm run collect:feedback-loop -- \
  /tmp/ace-feedback/${RUN_ID}/tasks/frozen/task-manifest.json \
  /tmp/ace-feedback/${RUN_ID}/experiment-manifest.json \
  /tmp/ace-feedback/${RUN_ID}/raw-agent-native/result.json \
  /tmp/ace-feedback/${RUN_ID}/raw-agent-ace/result.json \
  /tmp/ace-feedback/${RUN_ID}/summary
```

- [ ] Require matching source/task SHA, valid verifier results, raw usage for both arms, ACE call count, MCP/provider correlation and no unverified acknowledgements.
- [ ] Render the human summary and label missing metrics `UNKNOWN`; never coerce them to zero.
- [ ] Record the smoke as infrastructure evidence only. Do not infer causal token savings from one task.

**Done when:** the collector emits a reconciled summary or a fail-closed reason naming the missing/contradictory artifact.

**Out:** changing prompts, models, ranking or ACE implementation.

---

### FB-05 — Run the frozen ten-task paired set

**Gate:** FB-04 has a reconciled smoke result and the owner has accepted the pinned model, cost and quality thresholds before the run.

**Purpose:** obtain the first directional natural-use comparison, not a 5× claim.

- [ ] Run exactly the ten frozen main tasks in native and ACE-optional arms, serially and with independent state per task.
- [ ] Keep model, reasoning effort, tool policy, timeouts, source revision, image digest and task input identical between arms.
- [ ] Capture provider-reported input/cached-input/output tokens, cost USD, tool-output bytes/tokens, ACE calls, native file reads, duration, errors and verifier quality.
- [ ] Collect with the same command and artifact schema as FB-04.
- [ ] Publish a versioned summary under `benchmarks/reports/` only after raw artifacts exist outside the repository and their hashes are recorded.

**Done when:** all ten task pairs have an explicit quality verdict and measured-or-unknown economics. A negative or inconclusive result is a valid outcome.

**Out:** holdout tuning and production promotion.

---

### FB-06 — Repeat on independent trials and untouched holdout

**Gate:** FB-05 has no unresolved provenance contradiction and quality non-inferiority has been checked before interpreting economics.

- [ ] Repeat the same ten-task selection at least twice more without changing the frozen task manifest or runtime identity.
- [ ] Run the untouched holdout only after the repeated main-set artifacts are retained.
- [ ] Calculate paired deltas, p50/p95 duration, raw and uncached token breakdown, cost and failure rates; keep unknown components unknown.
- [ ] Do not tune prompts, retrieval parameters or task selection using holdout outcomes.
- [ ] Report whether ACE was actually used in each optional trial; separate `ACE_NOT_USED` from a genuine ACE result.

**Done when:** repeated and holdout artifacts are independently hashable and the report states quality first, economics second, with all limitations.

---

### FB-07 — Create one failure card and select one causal ACE change

**Gate:** FB-05 or FB-06 contains at least one correlated failure or unnecessary native read. If no such case exists, record `NO_ACTIONABLE_FAILURE` and stop this slice.

**Files/artifacts:**
- Read: `src/domain/feedback-loop-experiment.ts`
- Read: `src/adapters/retrieval-benchmark-trace.ts`
- Create outside the repository: `/tmp/ace-feedback/${RUN_ID}/failure-cards/${CARD_ID}.json`

- [ ] Select one failure without changing the frozen input.
- [ ] Record task ID, source/task revision and digest, query, ranked candidates, exact ranges, LSP verdict, delivered bytes, ACE/native calls, request IDs and the specific failure class: recall, scope, LSP, dedupe, stale source, oversized context, discovery or unnecessary native read.
- [ ] Identify one smallest ACE mechanism that could change that failure. Do not bundle prompt, provider, ranking and cache changes.
- [ ] If production code must change, open a separate implementation slice with a RED regression in the existing cheapest test owner; do not edit code as part of this diagnostic card.

**Done when:** one failure has one falsifiable hypothesis and one bounded change, or the card explicitly says no causal ACE change is justified.

---

### FB-08 — Re-run the diagnostic case and one untouched case

**Gate:** FB-07 produced a reviewed implementation PR and its affected tests passed.

- [ ] Re-run the exact failed task with the same source/task/model/runtime identity.
- [ ] Verify the original failure changed for the stated reason; do not accept a result that merely changed the ranking without preserving source proof.
- [ ] Run one untouched task that was not used to select the fix.
- [ ] Compare before/after raw traces and record regression, improvement or inconclusive outcome.
- [ ] Keep the fix out of the default path until owner review and benchmark evidence justify promotion.

**Done when:** the change is classified as `IMPROVED`, `REGRESSED` or `INCONCLUSIVE` with raw correlated evidence and no holdout contamination.

---

## RepoBench-R slices

### RB-01 — Acquire official records and prove source mapping

**Purpose:** either produce a source-bound RepoBench-R manifest or retain a precise blocker.

**Files/artifacts:**
- Read: `scripts/repobench-r-acquire.ts`
- Read: `scripts/repobench-r-resolve-context.ts`
- Read: `scripts/repobench-r-adapter.ts`
- Create outside the repository: `/tmp/ace-feedback/${RUN_ID}/repobench-r/`

- [ ] Pin the official Hugging Face records URL, dataset revision, config (`python_cff`, `python_cfr`, `java_cff` or `java_cfr`) and split.
- [ ] Obtain clean source checkouts at exact revisions for every repository referenced by the selected records. Do not synthesize repositories.
- [ ] Run acquisition with one explicit source-revision mapping and checkout mapping per repository:

```bash
npm run acquire:repobench-r -- \
  --records-url "${REPOBENCH_RECORDS_URL}" \
  --revision "${REPOBENCH_DATASET_REVISION}" \
  --config "${REPOBENCH_CONFIG}" \
  --split "${REPOBENCH_SPLIT}" \
  --output /tmp/ace-feedback/${RUN_ID}/repobench-r \
  --source-revision "${REPO_ID}=${SOURCE_REVISION}" \
  "${REPO_ID}=/tmp/ace-feedback/${RUN_ID}/sources/${REPO_ID}"
```

- [ ] Resolve gold context paths and require unique source occurrence; classify unresolved or ambiguous rows as `INVALID`, not as misses.
- [ ] Run the adapter only after acquisition and resolution manifests are `READY`.
- [ ] If exact source revisions cannot be established, write the tool's `BLOCKED` manifest and stop this branch. Do not create a substitute dataset.

**Done when:** official records, source checkouts, source manifests and gold paths are all digest-bound, or an honest `BLOCKED`/`INVALID` report is retained.

---

### RB-02 — Run retrieval ranking and grounding diagnostics

**Gate:** RB-01 is `READY` with no invalid rows in the selected evaluation subset.

- [ ] Convert the resolved rows to the existing `RetrievalHoldout`; do not change the evaluator or inject gold context into runtime queries.
- [ ] Run `dense`, `sparse` and `hybrid_rrf` through the real MCP against the same source generation, without an unapproved reranker.
- [ ] Retain per-query request ID, ranked candidate ID, path/range, AST/LSP verdict, source digest, payload bytes, latency and provider trace.
- [ ] Calculate Recall@1/3/5, MRR, exact-span grounding, unknown/uncertain rate, duplicates, payload size and latency. Use an explicit tokenizer for token estimates and keep agent billing separate.
- [ ] List worst cases and their concrete failure class; do not report only an average.

**Done when:** ranked results and source-grounding diagnostics are reproducible from the frozen manifest, even if retrieval quality is poor.

---

## Evidence and reporting contract

Raw external artifacts belong under `/tmp/ace-feedback/${RUN_ID}/` or another explicitly configured evidence root:

```text
manifest.json
raw-agent-native/
raw-agent-ace/
provider-trace.jsonl
retrieval-rows.jsonl
metrics.json
```

The versioned summary in `benchmarks/reports/` must include at least:

| Task/query | Source/task SHA | Gold found@k | LSP proof | ACE called? | Native tokens | ACE tokens | Quality delta | Token ratio | Failure |
|---|---|---|---|---|---:|---:|---|---:|---|
| measured ID | measured | measured/unknown | measured/unknown | yes/no | measured/unknown | measured/unknown | measured/unknown | measured/unknown | specific or none |

Unknown is not zero. A missing trace, timeout, malformed response or unverified acknowledgement is not evidence of absence or successful deletion. Historical failures remain historical; they are not rewritten into a pass.

## Final decision gates

- `PROVIDER-PATH PASS`: real MCP/provider trace exists for the exact source and runtime; this does not prove agent benefit.
- `SMOKE READY`: one native and one ACE-optional trial have complete source/task/image/model provenance and verifier results.
- `DIRECTIONAL FEEDBACK`: the ten-task paired set has quality-first results and measured-or-unknown economics.
- `REPEATABLE FEEDBACK`: independent repeats and untouched holdout preserve frozen identities and raw evidence.
- `RETRIEVAL DIAGNOSTIC`: RepoBench-R or another approved source-bound holdout has exact gold mapping and reproducible ranked results.
- `PRODUCTION READY`: not implied by any item above; requires applicable real-provider, security, DBC, release and explicit owner-approval gates.

No slice may claim 5×. The target remains a hypothesis to measure against a strong native baseline.
