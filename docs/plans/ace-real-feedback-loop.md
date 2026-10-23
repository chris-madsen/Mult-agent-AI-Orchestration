# ACE Real Feedback Loop — Full Completion Plan

> **For agentic workers:** use Superpowers `subagent-driven-development` for independent implementation slices. Each code slice requires a spec review, a quality review, focused verification, and a pull request targeting `main`.
>
> **Source:** [the original ACE feedback-loop plan](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/main/docs/plans/ace-real-feedback-loop.md)
>
> **Status rule:** this is an execution plan and evidence ledger. It is not a benchmark result, a production approval, or a 5x claim.

**Goal:** obtain a reproducible quality-first answer about verified code retrieval and agent economics using the real ACE MCP path, a native Hermes baseline, and an ACE-optional Hermes natural-use arm on the same underlying GPT model.

**Architecture:** preserve the existing MCP facade, exact-source reread, provider receipts, source-coverage semantics, OAuth auth-file route, and fail-closed statuses. Do not replace an unavailable provider with a mock or lexical success.

**Auth decision:** Harbor Hermes jobs use Hermes provider `openai-codex` and import the existing host `~/.codex/auth.json` into the ephemeral task container. A manually supplied `OPENAI_API_KEY` or `OPENROUTER_API_KEY` is not required for this subscription route. A task-specific remote verifier may declare its own requirement; that is separate from agent authentication.

---

## Non-negotiable constraints

- Current owner decisions, Accepted ADRs, OpenSpec contracts, and `AGENTS.md` override this plan.
- Current verified source bytes outrank index payloads and derived documentation.
- Pin source, task/dataset, runtime/model, image, configuration, and artifact SHA-256 identities before comparison.
- Raw external repositories, agent transcripts, and provider payloads stay outside the ACE checkout. Commit only English summaries and hashes.
- Missing or failed required providers produce `BLOCKED`, `NOT_READY`, `PARTIAL`, `UNKNOWN`, or `INVALID`; never an empty success or fabricated zero.
- Native and ACE-optional are the primary comparison. ACE-forced runs are diagnostic only.
- Do not run Harbor scale/repeats/holdout before the one-task smoke and provenance gates are ready.
- Do not reuse synthetic CST/LSP fixtures, old forced-Harbor reports, old 3x3/5x reports, or zero-call natural runs as new feedback.
- No 5x, production-readiness, provider-approval, or owner-approval claim is allowed from this plan alone.

## Current evidence ledger

| Area | Current status | Limitation |
|---|---|---|
| Provider implementation | **IMPLEMENTED/CONTRACT-TESTED** | MCP, ast-grep, LSP, FastEmbed, Qdrant, receipts, and fail-closed reporting exist. This is not agent-E2E evidence. |
| CST to LSP | **REAL STAGE-0 PASS / LIMITED COVERAGE** | A real source checkout produced one current/direct LSP-confirmed class symbol through MCP. Three optional arrow-function cases remain unconfirmed because the provider did not expose an exact name anchor; they are not counted as direct evidence. |
| Hermes authentication | **IMPLEMENTED / REAL HERMES SMOKE PENDING** | Exact-current preflight validates host `~/.codex/auth.json`; the Harbor adapter imports it for Hermes `openai-codex` without API-key fallback. Credentials are not retained in manifests or logs. |
| Local provider stack | **LOCAL PROVIDERS READY / HERMES HARBOR SMOKE PENDING** | Node/npm, ast-grep, TypeScript LSP, dense/sparse FastEmbed, Qdrant, Harbor and Docker remain required. Host Codex CLI is no longer a runtime prerequisite for the Hermes route; ChatGPT OAuth state is imported directly. A new real Hermes smoke is required after this agent change. |
| Harbor natural-use feedback | **NOT RUN — INPUTS FROZEN** | Twenty source-bound SWE-Atlas task identities and main/holdout selection are frozen, but job generation/smoke cannot pass the local image/verifier gate. No natural, forced, zero-call, paired, repeat, or holdout result is accepted. |
| RepoBench-R | **BLOCKED — NO SOURCE COMMIT MAPPING** | The pinned official records expose repository/file/context data but no exact source commits. Acquisition stopped before download or synthetic checkout creation. |
| Failure-driven fix | **NOT STARTED** | No natural-use Harbor trial exists from which to select a correlated failure; no production code change was made for this slice. |
| Production/5x/owner approval | **NOT CLAIMED** | These remain separate evidence gates. |

### Current evidence snapshot

The following evidence is retained outside the checkout under `/tmp/ace-feedback/` and is bound to implementation commit `bd7d2a62f3ad45cedf454b4803b0ce1d3dd671d2`:

- OAuth-first preflight: `/tmp/ace-feedback/20261022T180000Z/preflight/manifest.json`, SHA-256 `da400ee50dfbe0459102e48c24367f481cedc84e326031b05ecd3d703ae8c63f`; status `BLOCKED` only for Harbor jobs and local image inspection, with all local provider/auth checks ready.
- Real CST→LSP stage: `/tmp/ace-feedback/20261022T180000Z/stage0/manifest.json`, status `PASS`; raw MCP SHA-256 `7366acb41687677298ecc25fa19bbe3146df395e9f25862645825aabe4b6a010`, provider trace SHA-256 `bb0931a67878be2b76751bad5207904552482a06f0ca9d765b0b2b257da6b697`, receipt SHA-256 `2bf6e5b251bfb871f2820b5f663b8a721cca49b64571546df8766b5cc503f242`.
- Frozen SWE-Atlas registry: registry SHA-256 `da1446bce05eabbd72a25eb9eef5a2f5db94645ce88c28e2497581433b3d2e60`; source checkout commit `b0611b05a9f4f09b25aafad96617f9ec64ad722b`; source digest `f378424588b7b6eb3ed001fcd0450a63909bbd5af1d1eb10957cd9c27d1664f3`; task manifest SHA-256 `65bdefdc29f9fb42ff8db1b6a0809c20d745512024cd17a3a6bd170eaebc4e38`.
- Registry image digests were observed remotely but are not local runtime evidence: wp-calypso `sha256:b2fb707a7ce2f6f6c1f500d1ec7ed3f5143f72fb0bbc8fe3bf1ab6691400c105`; simple-login `sha256:b82cb15631e92ade58b8cf10493550f03a54dc5a8f25d3f31ef41afc186ee2c1`.
- RepoBench-R blocker: `/tmp/ace-feedback/20261022T181000Z/repobench-r/manifest.json`, SHA-256 `dba797e7d11d10582a369fd5ba240a3dc01b5b646eb8aec81658f213bbbb6733`; no source-bound retrieval metrics were produced.

These artifacts prove preparation and diagnostic gates only. They do not prove Harbor quality, token/cost savings, 5x improvement, production readiness, or owner approval.

## Execution graph

```text
AUTH-01 OAuth-first preflight
  └─> STACK-01 exact-current local provider stack
       ├─> STAGE0-01 real CST→LSP evidence
       ├─> RB-01 source-bound RepoBench-R mapping ─> RB-02 retrieval diagnostics
       └─> HARBOR-01 freeze tasks/jobs
            └─> HARBOR-02 smoke ─> HARBOR-03 reconcile
                 └─> HARBOR-04 ten-task paired run
                      └─> HARBOR-05 repeats and untouched holdout
                           └─> FIX-01 failure card/one fix ─> FIX-02 diagnostic/untouched rerun
```

---

## AUTH-01 — Hermes OAuth-first preflight

**Files:** `scripts/feedback-loop-preflight.ts`, `src/domain/feedback-preflight.ts`, and the existing preflight contract owner.

- Validate `~/.codex/auth.json` metadata and OAuth token presence without logging token bytes.
- Record the Hermes `openai-codex` authentication route and pin the custom Harbor adapter plus MCP entrypoint digests.
- Do not require `OPENAI_API_KEY`, `OPENAI_API_BASE` or `OPENROUTER_API_KEY` for the agent route.
- Remove the global API verifier from the required base checks.
- Check a remote verifier only when the selected Harbor task explicitly requires one.
- Emit preflight manifest schema version 2 and reject stale schema-1 manifests for current trials.

**Tests:** valid ChatGPT auth with no API key is ready; missing/malformed auth is blocked; generated jobs carry `CODEX_FORCE_AUTH_JSON=1`; manifests contain no credentials.

**Done:** focused tests and typecheck pass, and the preflight distinguishes OAuth agent authentication from task-specific verifier readiness.

## STACK-01 — Exact-current local provider stack

Prepare a clean disposable checkout at the exact commit under test and verify:

- Node/npm and locked dependencies;
- ast-grep and TypeScript LSP;
- FastEmbed dense and sparse/BM25 workers;
- Qdrant reachable from both host and Harbor container;
- Harbor version, `harbor run --help`, and dataset registry;
- Docker and task image inspection;
- Hermes adapter provenance and ChatGPT/Codex OAuth auth file;
- built runtime/source manifest identity.

Run the OAuth-first preflight and save:

```text
/tmp/ace-feedback/<run-id>/preflight/manifest.json
```

If any mandatory dependency is unavailable, retain `BLOCKED` with the exact reason and stop all Harbor jobs. Do not use a mock, lexical fallback, guessed endpoint, or API-key workaround.

## STAGE0-01 — Real CST to LSP evidence

- Use a real pinned TypeScript repository, not the synthetic fixture.
- Exercise `ast-grep → local index → Qdrant → ace_context → TypeScript LSP` through the real MCP executable.
- Forbid manual `semanticAnchor` injection.
- Cover class/function/method, same-name scopes, Unicode, imports/re-exports, overloads, and nested declarations.
- Retain raw MCP/provider traces and exact source/runtime digests.
- Report indexed symbols, anchored symbols, LSP-confirmed symbols, LSP-unconfirmed symbols, and errors by language.
- Preserve `uncertain` for ambiguous declarations and open issues for unsupported language/name-node cases.

**Done:** at least one real source symbol has `LSP definition confirmed` through an actual `ace_context` response and the coverage manifest is commit-bound.

## RB-01 — RepoBench-R source mapping

- Pin the official records URL, dataset revision, config, split, and SHA-256.
- Obtain clean source checkouts at exact revisions for every selected repository.
- Resolve each gold context to one unique file and exact byte range.
- Mark missing or ambiguous rows `INVALID`; never convert them into misses.
- Run the existing acquisition and resolution tools only after all mappings are explicit.
- If the official records cannot be mapped to exact source, retain `BLOCKED` and stop this branch.

**Done:** source-bound manifest with valid mappings, or an honest `BLOCKED/INVALID` report.

## RB-02 — Retrieval diagnostics

After `RB-01=READY`:

- Run dense, sparse, and hybrid through the real MCP on one source generation.
- Do not use an unapproved reranker.
- Retain request IDs, ranked candidates, paths, byte ranges, AST/LSP verdicts, source digests, provider traces, payload bytes, and latency.
- Compute Recall@1/3/5, MRR, exact-span grounding, unknown/uncertain rate, duplicate rate, payload size, and latency.
- List worst cases: miss, wrong scope, unverified anchor, stale source, oversized context, duplicate/native-read overhead.

## HARBOR-01 — Freeze real Harbor inputs

- Use `scale-ai/swe-atlas-qna` and pin Harbor registry/version plus source repository commits.
- Select exactly 10 main tasks and 10 untouched holdout tasks.
- Hash task inputs and source checkouts.
- Pin Hermes version, `openai-codex` model, reasoning effort, task image digests, source revision, adapter/MCP entrypoint digests, and OAuth route.
- Generate native and ACE-optional Hermes jobs through the existing generator.
- Native job must expose no ACE MCP server; ACE-optional job must expose exactly the pinned ACE stdio MCP server.
- Enforce serial execution: `n_concurrent_trials=1`, `n_attempts=1`.

**Done:** task, job, experiment, source, image, auth, and runtime manifests agree byte-for-byte or the slice is `BLOCKED`.

## HARBOR-02 — One-task smoke

Run one frozen task in this order:

1. native Hermes without ACE;
2. ACE-optional Hermes with ACE available through native MCP but not forced.

Inside the ACE container verify `ace_context`, Qdrant reachability, source mount, provider receipts, task verifier, and raw JSONL retention. A zero ACE-call result is `ACE_NOT_USED`, not savings.

**Done:** both arms have verifier outcomes and complete provenance, or raw `BLOCKED`/`ACE_NOT_USED` artifacts explain the result.

## HARBOR-03 — Reconcile smoke

Use the existing collector and renderer to verify:

- source/task/model/reasoning/image identity;
- raw and cached-input usage;
- ACE/native call counts;
- request/provider correlation;
- raw artifact hashes;
- quality outcome.

Keep missing metrics `UNKNOWN`. This is an infrastructure gate, not an economics result.

## HARBOR-04 — Ten-task paired run

- Run the 10 frozen tasks in native and ACE-optional arms with independent state per task.
- Retain quality, input/cached/output tokens, cost, tool-output bytes/tokens, ACE calls, native reads, latency, failures, and timeouts.
- Evaluate quality non-inferiority before interpreting economics.
- Treat negative and inconclusive results as valid.

## HARBOR-05 — Repeats and untouched holdout

- Repeat the frozen main set at least twice more.
- Do not change tasks, prompts, model, reasoning, or retrieval settings.
- Run untouched holdout only after main repeats are retained.
- Keep `ACE_USED`, `ACE_NOT_USED`, failed, and unknown telemetry separate.
- Report paired deltas, p50/p95 latency, quality/failure rates, raw/cached token breakdown, and cost.
- Never tune on holdout outcomes.

## FIX-01 — Failure card and one targeted change

If natural-use evidence contains an actionable correlated failure:

- record task/query/candidates/ranges, AST/LSP verdict, calls, request IDs, and raw traces;
- classify recall, scope, LSP, stale-source, dedupe, oversized-context, discovery, or unnecessary-read failure;
- state one falsifiable causal hypothesis;
- make one minimal ACE-only change;
- add a RED regression in the existing cheapest test owner;
- do not combine prompt, model, ranking, provider, and cache changes.

If no actionable failure exists, record `NO_ACTIONABLE_FAILURE` and make no production change.

## FIX-02 — Validate the targeted change

- Re-run the exact failed task with unchanged frozen inputs.
- Verify the original failure changed for the stated reason.
- Run one untouched task.
- Compare raw traces before/after.
- Classify `IMPROVED`, `REGRESSED`, or `INCONCLUSIVE`.
- Keep the change out of the default path until review and evidence justify promotion.

## Evidence and reporting

Store raw external artifacts under:

```text
/tmp/ace-feedback/<run-id>/
```

Commit only English summaries and hashes under `benchmarks/reports/`. Every report must contain exact source/task/runtime identities, quality-first conclusions, measured-or-unknown token/cost fields, failure classes, limitations, and no invented values.

## Verification and delivery

For code changes:

```bash
npm run test:affected
npm run verify:pr
```

For real runtime evidence:

```bash
<generated run-native.sh or run-ace-optional.sh>
```

Every evidence slice must retain a manifest, exact commit, artifact hashes, request correlation, and one of `READY`, `BLOCKED`, `UNKNOWN`, `INVALID`, or `ACE_NOT_USED`.

All repository changes must be made on a reviewable branch and delivered through a PR targeting `main`. No 5x or production-readiness claim is permitted before the applicable real-provider, agent-E2E, benchmark, security, and owner-approval gates pass.


## Agent migration note — 2026-10-23

Owner decision ADR-015 changes only the current feedback-loop harness: Hermes is now primary, GPT remains routed through the ChatGPT/Codex subscription via `openai-codex`, and ACE is registered as a native Hermes MCP server. Earlier Codex preflight/smoke artifacts above are retained as historical evidence only and do not satisfy the new Hermes agent-E2E gate. The next executable gate is a fresh one-task Hermes native vs Hermes+ACE smoke before any 10-task run, repeats or holdout.
