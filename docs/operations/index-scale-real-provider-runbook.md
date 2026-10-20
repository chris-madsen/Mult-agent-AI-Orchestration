# W04 real-provider index scale runbook

This runner prepares the W04 **measurement**, not the acceptance verdict. It uses the real configured ACE Qdrant + embedding + Tree-sitter + TypeScript-LS path with lexical fallback disabled.

## Prerequisites

Before running:

- build/runtime dependencies are installed;
- Qdrant is reachable through `ACE_QDRANT_URL`;
- the selected embedding worker/model is available locally;
- Tree-sitter Python runtime is available;
- if production-pinned embedding is being evaluated, export the same exact pinned model/artifact variables that will be used by the release candidate.

The runner creates a temporary Git repository and a persistent ACE state directory inside the temporary root for the duration of one invocation.
Each phase allows up to 30 minutes by default; set `ACE_INDEX_SCALE_PHASE_TIMEOUT_MS`
between 60,000 and 3,600,000 when the selected host needs a different bounded
limit. A timeout is a failed measurement and must be retained as such.

## 1k run

```bash
npm run test:real-index-scale -- \
  --files 1000 \
  --changed 1 \
  --output artifacts/index-scale/1000-files.json
```

## 10k run

```bash
npm run test:real-index-scale -- \
  --files 10000 \
  --changed 1 \
  --output artifacts/index-scale/10000-files.json
```

For a broader change-only sample, repeat with a predeclared changed-file count, for example `--changed 10`. Do not change the workload after seeing results if it is being used as release evidence.

## What one invocation does

1. generates and commits an exact synthetic TypeScript repository with the requested baseline file count;
2. starts ACE from empty state and records the **cold** startup/index/query phase;
3. restarts ACE unchanged and requires `index_mode=warm_reused`;
4. makes the working tree dirty with:
   - exactly `--changed N` modified existing files,
   - one pure rename,
   - one deletion,
   - one genuinely untracked file;
5. restarts ACE and records the **change-only** phase;
6. asserts the runtime reports the expected changed/added/deleted/renamed deltas;
7. writes machine-readable timing, cache-hit/miss, vector-reuse, delta and identity summaries.

The JSON keeps only safe identities/metrics. The temporary worktree is removed at the end.

## Repetition and claims

A single invocation proves only that the scenario completed and produced one set of measurements. For performance claims, Codex must repeat the frozen 1k and 10k workloads enough times to report the predeclared statistic (for example median/p95), retain every run including failures, and record the exact host/provider identities.

Do not interpret a warm reuse PASS as DBC-13 closure by itself. DBC-13 still needs the release-selected provider stack, restart/interrupted-writer evidence, and the exact retained artifacts required by the DBC manifest.
