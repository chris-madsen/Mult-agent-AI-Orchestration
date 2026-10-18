# Paired retrieval-impact benchmark

This is a **new unfrozen development task**, NOT a validated holdout or evidence of 5×. It requires finding the correct behavior across files with same-name retry concepts and verifying independent payment behavior.

Run **native Codex and Codex+ACE** on identical task/image/model/settings using Harbor; preserve both raw job directories. The ACE environment must mount the actual harness, configure Qdrant and the embedding provider approved for the benchmark, plus Tree-sitter and TypeScript LS, and instrument MCP calls. Do not silently enable lexical fallback. Give the directories to `npm run gate:harbor -- <native-job-dir> <ace-job-dir> <report.json>`. The gate fails on missing Codex traces, zero ACE calls, unequal number of trials, or reduced quality.

The old trivial TODO smoke is **not** a substitute. The deterministic task can be used for development, but a stronger frozen, hidden task suite with multiple repositories is required for any efficacy or 5× claim.
