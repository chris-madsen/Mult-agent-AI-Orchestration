# Retrieval quality / compactness ablation runbook

This is the reproducible W03 evidence format. It does **not** choose hybrid/vector/lexical automatically until the dense-only non-inferiority gate has passed.

The release-grade frozen artifact is created in an external evidence
directory. Its path, SHA-256, repository revisions and source-manifest
digests are supplied by the benchmark run and are not committed to ACE.
Development fixtures must not be relabeled as release evidence.

## One holdout, every strategy

Every ablation must run against the same frozen holdout file and preserve its SHA-256. A run contains one observation per case:

```json
{
  "strategy": "hybrid-v1",
  "holdoutSha256": "<actual holdout SHA-256>",
  "observations": [
    {
      "caseId": "behavior-case",
      "retrievedCandidateIds": ["candidate-a", "candidate-b"],
      "payloadCharacters": 1234,
      "duplicateSourceHits": 0,
      "expansionCalls": 1,
      "nativeReadDuplicates": 0,
      "latencyMs": 42.5,
      "stageRanks": {
        "dense": [], "sparse": [], "fused": [], "workingContext": [],
        "reranked": [], "delivered": []
      },
      "stageLatencyMs": {"retrieval": 40.0, "delivery": 2.5}
    }
  ]
}
```

The evaluator computes from the ranked IDs itself:

- Recall@1 / @3 / @5;
- critical-case Recall@5;
- MRR and nDCG@5;
- mean initial payload characters;
- duplicate source hits;
- `ace_expand` calls;
- repeated native reads after ACE;
- latency p95.

Frozen runs additionally require `sourceCommit`, `runnerVersion`, non-empty
`providerIdentities`, and all six stage-rank arrays. The runtime benchmark
boundary writes raw runtime candidate IDs plus source digest/range metadata;
the evaluator labels candidates with the canonical
`sha256(repositoryId + repoPath + sourceDigest + exact range)` identity so
workspace IDs cannot leak into holdout scoring.

Provider-authored precision/recall labels are not accepted as evidence.

## Development fixture

`benchmarks/retrieval/quality-development-v1.json` is only a versioned development fixture for testing the evaluator. Its status is `development_fixture_not_release_holdout`.

Do not use it as W03/DBC release evidence. The normative run must use a separately frozen, unseen multi-repository holdout with `status: "frozen_multi_repository_holdout"`.

A release-grade holdout must bind every repository before any final strategy result is inspected:

```json
{
  "schemaVersion": 1,
  "status": "frozen_multi_repository_holdout",
  "repositories": [
    {
      "id": "repo-a",
      "revision": "<exact immutable Git SHA>",
      "sourceManifestSha256": "<SHA-256 of the exact source manifest>"
    },
    {
      "id": "repo-b",
      "revision": "<exact immutable Git SHA>",
      "sourceManifestSha256": "<SHA-256 of the exact source manifest>"
    }
  ],
  "cases": [
    {
      "id": "repo-a-behavior-case",
      "repositoryId": "repo-a",
      "query": "behavior-first query",
      "relevantCandidateIds": ["candidate-id"],
      "critical": true
    }
  ]
}
```

The evaluator rejects a `frozen_multi_repository_holdout` unless:

- at least two repositories are bound;
- repository IDs are unique;
- every repository carries an exact revision and source-manifest SHA-256;
- every case names one of the bound repositories;
- every bound repository contributes at least one case.

This prevents a nominal "multi-repository" claim from silently measuring one repository or swapping source bytes after results are known.

## Neutral ablation report

After collecting runs for sparse/dense/hybrid RRF/hybrid+rereanker/hybrid+rereanker+Working Context, render one neutral report:

```bash
npm run report:retrieval-quality -- \
  benchmarks/retrieval/<frozen-holdout>.json \
  benchmarks/reports/retrieval-ablation.json \
  /path/to/sparse-run.json \
  /path/to/dense-run.json \
  /path/to/hybrid-rrf-run.json \
  /path/to/hybrid-reranker-run.json \
  /path/to/hybrid-reranker-working-context-run.json
```

The report deliberately selects no winner.

The five-strategy gate requires all runs and rejects a missing reranker or
Working Context arm before scoring:

```bash
npm run gate:retrieval-ablation -- \
  <external-evidence>/frozen/holdout.json \
  benchmarks/reports/retrieval-ablation-verdict.json \
  /path/to/sparse-run.json \
  /path/to/dense-run.json \
  /path/to/hybrid-rrf-run.json \
  /path/to/hybrid-reranker-run.json \
  /path/to/hybrid-reranker-working-context-run.json
```

This gate may select dense-only as the fallback when no candidate is
non-inferior. It does not fabricate missing provider, reranker or agent
evidence.

## Predeclare the gate

Before looking at the final holdout outcomes, create a policy containing:

- selected strategy;
- exact holdout SHA-256;
- required holdout status, normally `frozen_holdout`;
- minimum quality thresholds;
- optional payload/duplicate/expand/native-read/latency ceilings;
- `minRepositoryCount` (at least 2 for the release-grade multi-repository claim).

Threshold values are not defined by this runbook; they must be chosen before the final holdout result is inspected.

For the final candidate gate, pass the dense-only reference run as the fifth
argument when the policy declares `nonInferiority.baselineStrategy`:

```bash
npm run gate:retrieval-quality -- \
  benchmarks/retrieval/<frozen-holdout>.json \
  /path/to/selected-strategy-run.json \
  /path/to/predeclared-policy.json \
  benchmarks/reports/retrieval-quality-verdict.json \
  /path/to/dense-only-baseline-run.json
```

A run cannot silently substitute the development fixture: both exact SHA-256 and declared holdout status are checked. When `nonInferiority` is declared, the gate fails closed if the baseline is missing, names a different strategy, has a different case/repository shape, or if critical Recall@5, MRR or nDCG@5 regresses beyond the predeclared tolerance. Compactness and latency are considered only after this quality gate.

## What Codex still needs to run

The remaining W03 evidence needs real strategy runners on a `frozen_multi_repository_holdout`, including behavior-not-name, hard distractors, same-name symbols, RU↔EN, aliases, dirty source and unsupported/syntax-error cases. Repository revisions and source-manifest digests must be frozen before the final runs. Codex should retain raw ranked candidates, ContextBundle payload sizes, expansion calls, repeated native reads and latency for each case.

Hybrid/reranking should be implemented only if the measured ablation justifies it. A new service is not accepted merely because it improves a development fixture.
