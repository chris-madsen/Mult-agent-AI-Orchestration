# Graphiti Memory Cost Control

Status: implemented admission control, not production-ready Graphiti economics.

## What is implemented

- Codex history is always preserved in the exact local archive first.
- Ordinary transcript episodes are `archive_only` by default.
- A bounded deterministic policy admits only durable decisions, architecture choices, durable constraints, unresolved questions, user preferences, or an explicit `ace_memory: "project"` annotation.
- An explicit `ace_memory: "archive_only"` annotation wins over text signals.
- Episodes larger than 4,000 characters remain in the archive and are not sent to an LLM-backed Graphiti extraction call.
- The Graphiti MCP process is created lazily and only if at least one episode is admitted for projection.
- Import output records the admission kind and reason. A skipped projection is not reported as a successful Graphiti projection.
- `evaluateMemoryEconomics` computes break-even reuse only from provider-reported token counters. Missing counters produce `unknown`; character counts, request counts, and latency are never presented as tokens.

## What remains open

The official Graphiti MCP boundary currently gives ACE an enqueue/result boundary, not the internal LLM and embedding token counters for each episode. Therefore ACE cannot yet claim a measured memory token ROI or automatically reject a projection based on a live provider budget. The cost evaluator is a pure domain contract ready for those observations, but no unknown value is fabricated.

The real Graphiti + FalkorDB local ingestion, extraction, recall, and deletion E2E remains unchecked until that runtime is available and its evidence is retained. This change does not promote a fake or HTTP-only fixture into production evidence.

## Operational contract

```text
raw Codex history -> exact local archive (always)
                  -> admission policy
                     -> archive_only (no Graphiti process/call)
                     -> project (official Graphiti MCP, pending receipt)
```

Deletion retains the existing fail-closed ordering: purge derived Graphiti data first, then tombstone the original archive episode.
