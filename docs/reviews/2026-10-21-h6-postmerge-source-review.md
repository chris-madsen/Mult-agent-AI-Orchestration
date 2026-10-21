# ACE H6 post-merge source review (PRs #123–#134)

**Reviewed:** 2026-10-21  
**Base:** `main@2aa9804c4ce1287318f7b8dbc6dc9623ded16405`  
**Tip:** `main@2fe96a88968fb393dd57cf3771d08efbcfa251fa`  
**Scope:** all 47 changed paths / 38 commits in that compare range, emphasizing current-runtime context delivery and H6 benchmark, reranker and Harbor evidence paths. Reviewed source, PR/change inventory, contracts and evidence ledgers.  
**Evidence level:** static inspection; no checkout/provider runtime, test suite or Harbor trials executed as part of *this* review. Do not upgrade a static finding to a reproduced bug without a RED fixture.

## Summary and product boundary

ACE remains an agent-neutral, MCP-exposed multi-layer hybrid context engine for coding agents. Current-code search is local (structural ast-grep, dense and Qdrant sparse/BM25 + RRF, optional reranker and LSP). Vertex RAG supplies only explicitly authorized project documentation; Graphiti/FalkorDB + exact local archive provide temporal memory. Exact live source bytes outrank derived code-index/documentation/memory claims. This review is about **trustworthy evidence** for H6, not redesigning ACE or creating multi-agent task coordination.

**Implemented and no longer open solely because of the previous review:** #124 corrects same-file duplicate-byte accounting; #125 adds versioned, workspace-scoped per-evidence receipts for changed bundles; #126 introduces durable trace sink with failure propagation; #127 covers real process restarts. #130–#133 add capability probing, generic multi-repository runner, reranker freeze/evaluation and four-arm Harbor job preparation. #134 records an H6 ledger. Keep these milestones distinct from provider-E2E, scored five-strategy quality, Harbor results and owner approval.

**Evidence as recorded in [H6 ledger](./2026-10-21-h6-evidence-after-pr-133.md):** external v3 holdout is 24 cases over two repositories; a dense diagnostic has Recall@5 0.375 and MRR about 0.2014; six evaluated rerankers failed the separate selection gate; Harbor v0.24.0 is present but real four-arm trials are blocked by missing Codex/OAuth and Docker runtime in the Linux/WSL environment. These are **repo-documented observations**, not re-run/independently verified benchmarks. The ledger's statement that PRs #130–#133 were pending reflects its creation time; all were merged by the reviewed tip. No 5× or production approval is established.

## Findings

### H6-CR-01 — P1 — source/compiled-runtime identity is not enforced by the generic runner

**Static evidence:** `parseBindings` compares only `git rev-parse HEAD` to the frozen revision; it never checks tracked/untracked/dirty-tree bytes. [`scripts/retrieval-benchmark-runner.ts:105-124`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/scripts/retrieval-benchmark-runner.ts#L105-L124). The executed MCP runtime chooses `dist/bin/ace-mcp.js` merely when that path exists, otherwise source via tsx; it does not validate that `dist` was compiled from `runtimeCommit`. [`scripts/retrieval-benchmark-runner.ts:309-323`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/scripts/retrieval-benchmark-runner.ts#L309-L323). The report then claims a `runtimeCommit` from `git rev-parse HEAD` and holdout repository revisions. [`scripts/retrieval-benchmark-runner.ts:409-450`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/scripts/retrieval-benchmark-runner.ts#L409-L450).

**Consequence:** a checkout with dirty code or stale `dist` can yield real-looking scored observations attributed to the wrong effective source/runtime. This violates exact-commit/frozen-source evidence semantics even if provider identities and trace receipts are otherwise valid.

**RED cases:** create a temporary Git repo with identical HEAD but changed tracked/untracked relevant source, and a valid `dist` with a deliberately mismatched build fingerprint. Both must fail before the first scored MCP call. Clean matching builds should pass.

**Fix:** explicitly verify clean source/manifest identity for each mapped repository and runtime root; require an attributable build digest/commit or compile from the selected pinned code in an isolated runner directory. Retain source-manifest SHA, effective executable digest, Node/SDK/model identities in the run manifest; reject unauthorized changes and stale runtime. Avoid altering immutable v3 holdout labels.

### H6-CR-02 — P1 — absent payload measurement is treated as a reranker compactness win

**Static evidence:** `evaluateRerankerRun` turns a missing `deliveredPayloadCharacters` into zero via `?? 0`. [`src/domain/reranker-evaluation.ts:247-289`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/src/domain/reranker-evaluation.ts#L247-L289). `selectRerankerCandidate` can accept a non-inferior candidate simply because `candidate.deliveredPayloadCharactersMean < baseline.deliveredPayloadCharactersMean`. [`src/domain/reranker-evaluation.ts:297-325`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/src/domain/reranker-evaluation.ts#L297-L325). The *candidate* evaluation script emits `rankedDocumentIndexes` and latency, **without** `deliveredPayloadCharacters`. [`scripts/reranker-evaluation.ts:94-110`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/scripts/reranker-evaluation.ts#L94-L110). The baseline converter, by contrast, populates the payload field from measured retrieval observations. [`scripts/reranker-baseline-from-retrieval.ts:32-53`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/scripts/reranker-baseline-from-retrieval.ts#L32-L53).

**Consequence:** if a candidate ties the baseline on quality, it may be approved as more compact because **unknown is misinterpreted as zero**. The six currently evaluated candidates were rejected for real ranking regressions; this issue concerns future candidates, not a claim that those six were falsely accepted.

**RED cases:** identical quality with baseline 100 measured characters and candidate payload missing must be rejected; explicit candidate measured 80 with matching task/selection depth may pass subject to all gates. Missing per-case values must stay unknown, never zero.

**Fix:** frozen reranker runs require measured candidate and baseline payload on the same exact delivery path, or disable compactness tie-breaking while unknown; consider latency/cost tolerances and quality dominance at the predeclared selection gate. Never count reranking (alone) as a reduction in returned bodies without evidence.

### H6-CR-03 — P1 — frozen Harbor task/config inputs are not byte-verified

**Static evidence:** the job freezer only checks that each task path exists and that its `sha256` **looks** like 64 hex characters; it does not hash and compare the actual task bytes. [`scripts/freeze-harbor-four-arm-jobs.ts:47-57`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/scripts/freeze-harbor-four-arm-jobs.ts#L47-L57). It creates arm configs from three filenames without reading/digesting their contents, and emits an external binding containing task-manifest and **generated job JSON** hashes but not config content hashes. [`scripts/freeze-harbor-four-arm-jobs.ts:59-100`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/scripts/freeze-harbor-four-arm-jobs.ts#L59-L100). The four-arm design validator checks only strategy words in the **config path**, not effective config identity. [`src/domain/harbor-four-arm.ts:67-97`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/src/domain/harbor-four-arm.ts#L67-L97). The gate checks a boolean `qualityNonInferior`, nonempty trace/usage path arrays, and declared counters, rather than independently verifying the trace bytes and task success; evidence validation must happen upstream. [`src/domain/harbor-four-arm.ts:203-241`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/src/domain/harbor-four-arm.ts#L203-L241).

**Consequence:** two supposedly frozen jobs can consume changed tasks or swapped configs while presenting identical declared manifest/revision/job metadata. A downstream report may be treated as comparable without proof of exact executable inputs.

**RED cases:** wrong declared task SHA, changed task file after binding, changed dense/hybrid/delta TOML bytes, non-existent or nonmatching config path and mismatched task-manifest revisions must all reject. Sidecar hashes alone are not source-truth validation.

**Fix:** verify **actual** task definition/environment bytes against their declared digests, hash and pin all three effective Codex MCP configs, model/provider/runtime image identities and task repository revisions in a canonical signed/bound run manifest, and verify them again at run/report gate. Explicitly validate sources of quality and usage counters, including per-trial success; unverified evidence is `BLOCKED`, not a release pass.

### H6-CR-04 — P2 — native file-read duplication metric is reported as observed zero without instrumentation

**Static evidence:** `const sourceVerificationReads = events.length === 0 ? 0 : 0;` followed by `nativeReadDuplicates: sourceVerificationReads`, and `expansionCalls: 0`. [`scripts/retrieval-benchmark-runner.ts:359-387`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/scripts/retrieval-benchmark-runner.ts#L359-L387). The runner never calls `ace_expand`, so zero expansion calls is a legitimate *runner behavior*; it is **not** evidence of zero duplicate native reads across the broader agent workflow.

**Consequence:** a benchmark may pass a `maxNativeReadDuplicatesMean` constraint on an invented zero. The measurement must be `unknown`/unavailable until instrumented, not silently zero.

**RED cases:** a run with missing native-read events cannot claim zero; a fixture with a known duplicate read must report its count; a metrics gate requiring that field fails closed if unmeasured.

**Fix:** add real native-tool/read instrumentation or remove this field from the release-grade observation and require a separate explicit measurement status.

### H6-CR-05 — P2 — reranker holdout range extraction is not Unicode byte-exact

**Static evidence:** `textForRange` converts source bytes to a JavaScript string and calculates source columns using UTF-16 string indexes; no byte-range/UTF-8 verification is performed. [`scripts/freeze-reranker-holdout.ts:109-124`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/scripts/freeze-reranker-holdout.ts#L109-L124). The structural candidate contract uses UTF-8 byte positions for exact anchors and spans. [`src/domain/retrieval.ts:16-47`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/src/domain/retrieval.ts#L16-L47).

**Consequence:** multibyte Unicode ahead of a target (or surrogate pairs) can select a different body than the range bound into the canonical candidate ID. Current frozen evidence is not declared invalid without checking its exact source cases; this is a prospective correctness gap.

**RED cases:** ranges across Cyrillic, combining characters, emoji, CRLF and multline UTF-8 text, with original byte-range digest and source-reconstruction oracle.

**Fix:** share the existing exact-byte UTF-8/range verification primitive, reject ambiguous column units, and validate selected candidate bytes/digest before writing new frozen fixtures. **Do not rewrite an existing frozen holdout in place.**

## Tests reviewed and limitations

New test coverage exists for receipt restart, durable trace and frozen evaluator rules. The generic runner's new [test](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/2fe96a88968fb393dd57cf3771d08efbcfa251fa/test/retrieval-benchmark-runner.contracts.test.ts) mostly asserts source text/presence of expected strings, not the actual runner against a matching/mismatched Git checkout and compiled runtime. Harbor tests check schema/shape and prescribed repetitions, but do not exercise task or TOML SHA mismatches. Existing reranker selection tests demonstrate quality/payload thresholds, not unknown-as-zero behavior.

No real CI/test execution or private external artifact validation was available in this review. The H6 ledger and private `D:\ace-external\...` files were read only as documented evidence; their hashes were not recomputed here.

## Next work / acceptance

Use the **existing** [2026-10-21 hybrid completion plan](../plans/2026-10-21-cursor-like-hybrid-context-completion-plan.md), not a competing redesign. Do P1 fail-closed provenance/metrics tests before any scored five-arm ablation or four-arm Harbor approval; P2 metrics and UTF-8 range tests before promoting corresponding quality claims; then provision and run frozen H6 provider/Harbor suites; preserve the separate Graphiti, Vertex, k3s, supply-chain and signed owner release gates.

Every implemented fix requires a small PR to `main`, reproducible RED cases, `npm run test:affected` for the edit loop, `npm run verify:pr` for handoff, and real-provider/agent E2E **when relevant**. Failed/unavailable steps stay `NOT_RUN` or `BLOCKED`; do not mark unexecuted checks passed.
