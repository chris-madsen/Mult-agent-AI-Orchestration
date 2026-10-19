# Paired retrieval-impact benchmark

This is a **new unfrozen development task**, NOT a validated holdout or evidence of 5×. It requires finding the correct behavior across files with same-name retry concepts and verifying independent payment behavior.

Run **native Codex and Codex+ACE** on identical task/image/model/settings using Harbor; preserve both raw job directories. The ACE environment must mount the actual harness, configure Qdrant and the embedding provider approved for the benchmark, plus Tree-sitter and TypeScript LS, and instrument MCP calls. Do not silently enable lexical fallback. Give the directories to `npm run gate:harbor -- <native-job-dir> <ace-job-dir> <report.json>`. The gate fails on missing Codex traces, zero attributable ACE calls, unequal number of trials, or reduced quality. A passing **diagnostic** gate is not production DBC-12 acceptance.

The old trivial TODO smoke is **not** a substitute. The deterministic task can be used for development, but a stronger frozen, hidden task suite with multiple repositories is required for any efficacy or 5× claim.

## Three-arm benchmark protocol

Use the same frozen task manifest, model, reasoning budget, and verifier in all arms:

1. **Native natural:** `benchmarks/harbor/ace-suite/retrieval-native-paired-job.json` (no ACE MCP).
2. **ACE optional natural:** `benchmarks/harbor/ace-suite/retrieval-ace-natural-job.json` (ACE MCP configured, no forced ACE call).
3. **ACE forced diagnostic:** `benchmarks/harbor/ace-suite/retrieval-ace-paired-job.json` (additional must-call instruction; useful for wiring, **not** natural efficiency).

After running the jobs and preserving raw Harbor agent logs, run:

```bash
npm run gate:harbor -- \
  <native-result.json> <natural-ace-result.json> <natural-report.json> \
  benchmarks/harbor/ace-suite/retrieval-ace-natural-job.json
```

For the forced diagnostic, pass the forced ACE result and its job configuration instead.
The gate reads the committed `extra_instructions` field to label the experiment
and records the config digest. Without per-MCP-request correlated provider traces
and measured local compute cost, it reports `diagnostic-only`, not DBC-12 closure.

**Do not tune the frozen holdout after inspecting the outcome.** Track whether
Codex used ACE voluntarily and whether it then reread the same source using native
tools. Measure cold setup separately from repeated warm retrieval calls.
