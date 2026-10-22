# ACE Real Feedback Loop — Full Completion Plan

> **For agentic workers:** use Superpowers `subagent-driven-development` for independent implementation slices. Each code slice requires a spec review, a quality review, focused verification, and a pull request targeting `main`.
>
> **Source:** [the original ACE feedback-loop plan](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/main/docs/plans/ace-real-feedback-loop.md)
>
> **Status rule:** this is an execution plan and evidence ledger. It is not a benchmark result, a production approval, or a 5x claim.

**Goal:** obtain a reproducible quality-first answer about verified code retrieval and agent economics using the real ACE MCP path, a native Codex baseline, and an ACE-optional natural-use arm.

**Architecture:** preserve the existing MCP facade, exact-source reread, provider receipts, source-coverage semantics, OAuth auth-file route, and fail-closed statuses. Do not replace an unavailable provider with a mock or lexical success.

**Auth decision:** Harbor Codex jobs use the existing ChatGPT/Codex OAuth route through `CODEX_FORCE_AUTH_JSON=1` and the host `CODEX_HOME/auth.json`. A manually supplied `OPENAI_API_KEY` or `OPENAI_API_BASE` is not required for Codex subscription execution. A task-specific remote verifier may declare its own requirement; that is separate from agent authentication.

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
| CST to LSP | **PROVIDER-PATH PASS / NATURAL COVERAGE OPEN** | Existing stage-0 evidence uses a synthetic TypeScript fixture. A real repository trace and coverage matrix are still required. |
| Codex authentication | **OAUTH ROUTE IMPLEMENTED** | Preflight uses `CODEX_HOME/auth.json` and `CODEX_FORCE_AUTH_JSON=1`; absence of an API key is not a blocker. Exact current runtime still needs a fresh preflight. |
| Local provider stack | **NOT_READY UNTIL FRESH PREFLIGHT** | Node/npm, Harbor, Docker, Qdrant, FastEmbed, sparse worker, LSP, image identities, and current source digest must be checked together. |
| Harbor natural-use feedback | **NOT ACCEPTED** | Historical local smoke and forced/zero-call runs do not prove retrieval benefit on SWE-Atlas QnA. |
| RepoBench-R | **BLOCKED UNTIL SOURCE MAPPING** | Existing acquisition/adapter tooling must prove exact repository revisions and unique gold spans. No synthetic source is allowed. |
| Failure-driven fix | **NOT STARTED** | Requires a correlated natural-use failure or an explicit `NO_ACTIONABLE_FAILURE`. |
| Production/5x/owner approval | **NOT CLAIMED** | These remain separate evidence gates. |

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

## AUTH-01 — OAuth-first preflight

**Files:** `scripts/feedback-loop-preflight.ts`, `src/domain/feedback-preflight.ts`, and the existing preflight contract owner.

- Validate `CODEX_HOME/auth.json` metadata and OAuth token presence without logging token bytes.
- Record `authenticationRoute = CODEX_FORCE_AUTH_JSON=1 with the host Codex auth route; credentials are not retained`.
- Do not require `OPENAI_API_KEY` or `OPENAI_API_BASE`.
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
- Codex CLI and OAuth auth file;
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
- Pin model, reasoning effort, task image digests, source revision, ACE config digest, and OAuth route.
- Generate native and ACE-optional jobs through the existing generator.
- Native job must not load ACE config; ACE-optional job must load it.
- Enforce serial execution: `n_concurrent_trials=1`, `n_attempts=1`.

**Done:** task, job, experiment, source, image, auth, and runtime manifests agree byte-for-byte or the slice is `BLOCKED`.

## HARBOR-02 — One-task smoke

Run one frozen task in this order:

1. native Codex without ACE;
2. ACE-optional Codex with ACE available but not forced.

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
CODEX_FORCE_AUTH_JSON=1 harbor run --config <generated-job>
```

Every evidence slice must retain a manifest, exact commit, artifact hashes, request correlation, and one of `READY`, `BLOCKED`, `UNKNOWN`, `INVALID`, or `ACE_NOT_USED`.

All repository changes must be made on a reviewable branch and delivered through a PR targeting `main`. No 5x or production-readiness claim is permitted before the applicable real-provider, agent-E2E, benchmark, security, and owner-approval gates pass.
