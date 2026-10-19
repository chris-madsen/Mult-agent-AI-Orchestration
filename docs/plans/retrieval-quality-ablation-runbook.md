# Retrieval quality / compactness ablation runbook

This is the reproducible W03 evidence format. It does **not** choose hybrid/vector/lexical automatically.

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
      "latencyMs": 42.5
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

Provider-authored precision/recall labels are not accepted as evidence.

## Development fixture

`benchmarks/retrieval/quality-development-v1.json` is only a versioned development fixture for testing the evaluator. Its status is `development_fixture_not_release_holdout`.

Do not use it as W03/DBC release evidence. The normative run must use a separately frozen, unseen multi-repository holdout with `status: "frozen_holdout"`.

## Neutral ablation report

After collecting runs for lexical/vector/hybrid (and any controlled reranker ablation), render one neutral report:

```bash
npm run report:retrieval-quality -- \
  benchmarks/retrieval/<frozen-holdout>.json \
  benchmarks/reports/retrieval-ablation.json \
  /path/to/lexical-run.json \
  /path/to/vector-run.json \
  /path/to/hybrid-run.json
```

The report deliberately selects no winner.

## Predeclare the gate

Before looking at the final holdout outcomes, create a policy containing:

- selected strategy;
- exact holdout SHA-256;
- required holdout status, normally `frozen_holdout`;
- minimum quality thresholds;
- optional payload/duplicate/expand/native-read/latency ceilings.

Threshold values are not defined by this runbook; they must be chosen before the final holdout result is inspected.

Then run:

```bash
npm run gate:retrieval-quality -- \
  benchmarks/retrieval/<frozen-holdout>.json \
  /path/to/selected-strategy-run.json \
  /path/to/predeclared-policy.json \
  benchmarks/reports/retrieval-quality-verdict.json
```

A run cannot silently substitute the development fixture: both exact SHA-256 and declared holdout status are checked.

## What Codex still needs to run

The remaining W03 evidence needs real strategy runners on a frozen multi-repository TS/JS holdout, including behavior-not-name, hard distractors, same-name symbols, RU↔EN, aliases, dirty source and unsupported/syntax-error cases. Codex should retain raw ranked candidates, ContextBundle payload sizes, expansion calls, repeated native reads and latency for each case.

Hybrid/reranking should be implemented only if the measured ablation justifies it. A new service is not accepted merely because it improves a development fixture.
