# Provider trace receipt runbook

This W12 evidence helper proves **request-correlated query-time provider execution** for one ACE ContextBundle. It does not replace startup/index provider evidence.

## Inputs

Retain:

1. the exact ContextBundle JSON returned for the request, including `requestId` and typed `sourceCoverage`;
2. the append-only provider trace JSONL produced for the same run.

The trace format is safe metadata only. The receipt validator rejects unexpected JSON fields so raw query/source/token payload cannot be smuggled into acceptance evidence.

## Query-time provider mapping

For a **required** source branch the receipt expects:

| Required source | Correlated query-time providers |
| --- | --- |
| `code` | embedding, Qdrant, final source verification |
| `structural` | TypeScript Language Service |
| `documentation` | Vertex RAG |
| `memory` | Graphiti |

Tree-sitter is intentionally absent from this per-request mapping because it runs during startup/index construction, not every query. DBC-01 must retain separate startup/index evidence for Tree-sitter rather than inventing request correlation that did not occur.

Optional/not-requested branches do not block this receipt.

## Generate

```bash
npx tsx scripts/provider-trace-receipt.ts \
  artifacts/run/context-bundle.json \
  artifacts/run/provider-trace.jsonl \
  artifacts/run/provider-trace-receipt.json
```

For a hard acceptance step:

```bash
ACE_REQUIRE_TRACE_RECEIPT_COMPLETE=true npx tsx scripts/provider-trace-receipt.ts ...
```

A complete receipt requires:

- every required source has `coverageStatus = satisfied`;
- every provider mapped to that required source has at least one event with the exact ContextBundle request ID;
- none of those required-provider events failed.

Wrong request IDs are ignored. Missing or failed required-provider traces remain explicit failures.

## Claim boundary

`provider-trace-complete` proves only that the required **query-time** branches for this request have correlated safe trace events consistent with source coverage. It does not by itself prove retrieval quality, startup Tree-sitter/index correctness, Harbor value, or production readiness.
