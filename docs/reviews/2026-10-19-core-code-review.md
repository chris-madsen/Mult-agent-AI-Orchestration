# Core Code Review — 2026-10-19

## Scope

Reviewed core domain, adapters, and MCP gateway implementation:
- `src/domain/retrieval.ts`
- `src/domain/workspace.ts`
- `src/domain/memory.ts`
- `src/domain/evaluation.ts`
- `src/adapters/local-context-provider.ts`
- `src/adapters/node-workspace-port.ts`
- `src/adapters/file-memory-archive.ts`
- `src/adapters/file-artifact-store.ts`
- `src/adapters/evaluation-fingerprint.ts`
- `src/adapters/codex-usage-events.ts`
- `src/gateway/mcp-gateway.ts`

Focus: semantic correctness and consistency with the repository’s stated invariants. This does not claim production readiness or complete coverage of every source file.

## Critical findings

### 1. `complete` is computed incorrectly

In `mergeEvidence`:

```ts
complete: partialSources.length === 0 && allWarnings.length === 0
```

This conflates incompleteness with conflicts. A documentation/code conflict produces a warning, but does not mean a required source is missing. A bundle with fresh code and documentation evidence can be marked incomplete solely because ACE detected a contradiction.

Recommended separation:
- `complete`: no missing or failed required sources.
- `partialSources`: unavailable, stale, raced, denied, or otherwise not fully usable sources.
- `hasConflicts` / `conflictStatus`: contradiction detected between evidence sources.

### 2. Race detection is local to one read, not to the context request

`local-context-provider.ts` verifies each selected path with `readExact`, which detects a change during that individual read. It does not revalidate the working tree after reading all ranked candidates and before returning the `ContextBundle`.

A file may change after its exact read but before the bundle is returned. The bundle can still label that evidence `current`, even though the workspace changed during the broader request.

This conflicts with the repository invariant that selected source must be revalidated against the working tree, or explicitly marked stale/changed.

Recommended fix:
- Capture an observation generation/epoch before candidate selection.
- Recheck it before returning the bundle.
- On change, re-read affected evidence or mark the request `changed_during_request`.

### 3. Ranking ignores freshness by construction

`local-context-provider.ts` calls:

```ts
searchCode(options.index, options.workspaceId, input.query, {
  digestFor: () => undefined,
})
```

The digest lookup always returns `undefined`, so every ranked candidate receives `freshness: 'unknown'` during ranking. Freshness is recomputed only for the top 20 candidates.

Consequences:
- `searchCode` cannot emit `indexed digest differs from current source`.
- Ranking cannot prioritize current evidence over stale evidence.
- `RankedCandidate.freshness` is effectively unused during ranking.

If freshness-blind lexical ranking is intentional for the local fallback, document it explicitly. Otherwise, pass a real digest lookup or make freshness-aware ranking an explicit later capability.

### 4. Memory blob deletion has an import/delete race

In `file-memory-archive.ts`, `importEpisode` writes the content blob before episode metadata:

```ts
await writeFile(contentPath(...), content, { flag: 'wx' });
await writeFile(metadataPath(...), metadata, { flag: 'wx' });
```

`deleteEpisode` removes metadata, then deletes the blob if `hasOtherReference` finds no other metadata reference.

A separate process can observe:
1. Process A writes a content blob.
2. Process B deletes an episode with the same content digest.
3. Process B finds no other metadata reference and removes the blob.
4. Process A writes metadata pointing to the now-missing blob.

The file lock protects operations within one archive instance, but does not close this cross-process ordering gap.

Recommended directions:
- Use a reference count or digest-scoped tombstone.
- Write metadata first with an explicit pending/content-available state.
- Make deletion aware of in-flight imports.
- Use a transactional store for cross-process correctness.

### 5. Workspace snapshot silently degrades on Git failure

`node-workspace-port.ts` catches external-command failures and returns:

```ts
{
  headRevision: 'unavailable',
  files,
  removedPaths: [],
}
```

This treats several distinct failures alike:
- Not a Git repository.
- Broken `.git` directory.
- Permission failure.
- Corrupt Git state.
- Unexpected Git output.

The resulting snapshot can look valid while being materially incomplete. This conflicts with the requirement that outages degrade truthfully and missing required providers produce partial/not-ready results.

Recommended fix:
- Distinguish `NOT_A_GIT_REPOSITORY`, `GIT_UNAVAILABLE`, and `GIT_STATE_INVALID`.
- Return an explicit partial/degraded snapshot status.
- Do not report an apparently complete snapshot when Git metadata could not be observed.

## Important findings

### 6. `isExternalCommandFailure` is too broad

The helper treats any error with a `code` property as an external command failure. Node filesystem and process errors can also carry `code`. Non-Git failures may be misclassified as a Git outage and trigger silent snapshot degradation.

### 7. `readExact` race check is narrow

The implementation compares `stat` before and after `readFile`:

```ts
if (
  before.size !== after.size ||
  before.mtimeMs !== after.mtimeMs ||
  before.ino !== after.ino
)
```

This detects changes during the read window, but not changes immediately before or after it. A working-tree observation generation or post-read snapshot check is needed for ACE’s digest-based freshness guarantee.

### 8. Snapshot and exact-read symlink policies disagree

`walkFiles` skips symbolic links:

```ts
if (entry.isSymbolicLink()) continue;
```

But `readExact` resolves the final path with `realpath` and permits reads whose final target remains inside the workspace root.

A file reachable through an internal symlink can therefore be read by context verification even though it was never observed by `snapshot`. This creates a mismatch between workspace observation and readable evidence.

### 9. Artifact handles do not bind to an expected digest

`file-artifact-store.ts` returns a random UUID handle and separately returns the digest. `readRange` returns whatever digest the current file has.

A caller can compare the returned digest externally, but the API does not enforce that retrieved bytes match the digest associated with the original artifact reference.

Recommended API evolution:

```ts
readRange(handle, cursor, maxBytes, expectedDigest?)
```

Or make the handle content-addressed.

### 10. One missing cumulative field poisons the whole total

In `normalizeUsageLedger`, cumulative deltas are computed field-by-field. If `cachedInputTokens` is missing from one sample, `subtractMeasurements` returns `unknown`, and `addMeasurements` propagates that unknown through the entire ledger total.

This is overly pessimistic: valid deltas from other samples are discarded.

Recommended behavior:
- Track per-field continuity.
- Mark only the affected interval or field as unknown.
- Preserve known deltas from other samples.

### 11. `qualityPassRate` mixes completion and quality

`makeComparisonReport` computes:

```ts
successfulRuns / runMetrics.length
```

where `successfulRuns` requires `state === 'Recorded'` and `quality === 'passed'`.

Aborted and `RecordedIncomplete` runs reduce this rate even though they are not quality failures. The field name suggests a quality metric, but it is a combined completion-and-quality metric.

Recommended metrics:
- `completionRate`
- `qualityPassRate` over recorded runs
- `abortedRate`
- `incompleteRate`

## Lower-severity findings

### 12. Lexical tokenizer drops useful short terms

`queryTerms` discards terms of length one. This removes potentially meaningful identifiers such as `x`, `i`, `_`, or `$`.

It also uses an ASCII-oriented regex, despite the project’s stated RU↔EN exploratory evaluation and TypeScript/Tree-sitter integration.

### 13. Lexical score is a boost, not meaningful ranking

`searchCode` uses:

```ts
(exactIdentifier ? 100 : 0) + matched / Math.max(terms.length, 1)
```

It does not account for term frequency, field weight, candidate length, or position. Acceptable for a fallback, but not semantic or production ranking.

### 14. Evidence deduplication can discard distinct evidence

`mergeEvidence` deduplicates by:

```ts
source | citation | sourceDigest | content
```

Two evidence items with identical content but different `evidenceId`, `proofClass`, `conflictKey`, or `expansionHandle` can collapse into one. Use narrower identity or preserve distinct evidence metadata.

### 15. Conflict detection covers only code versus documentation

`mergeEvidence` reports a conflict only when both `code` and `documentation` are present.

Conflicts between:
- code and LSP,
- code and structural evidence,
- code and memory,
- memory and documentation

are not detected.

Given that memory contains derived claims, this is a meaningful gap.

### 16. `makeEpisode` does not validate content digest

`makeEpisode` accepts any `contentDigest` string and does not verify it against `content`. Digest verification happens only later in `importEpisode`.

The domain constructor should validate digest format and content binding, or explicitly document that integrity is enforced only at persistence time.

### 17. Decision supersede does not validate successor identity

`transitionDecision` permits `supersede` only from `Accepted`, but does not validate that:
- `successorId` exists,
- `successorId !== decisionId`,
- the successor graph is acyclic.

Those checks may belong to a higher-level service, but the current domain function permits self-supersession if callers do not add them.

### 18. Evidence hash relies on an unstated invariant

`evaluation-fingerprint.ts` creates a provisional report with a placeholder hash, serializes it, hashes the result, and creates the final report.

This works only because `comparisonEvidenceSource` excludes `evidenceHash`. That invariant is implicit and should be protected by a test or explicit comment.

## Priority

| Priority | Finding |
|---|---|
| P0 | Memory blob deletion/import race |
| P0 | Silent workspace snapshot degradation |
| P0 | Request-level race detection missing |
| P1 | `complete` conflates incompleteness and conflict |
| P1 | Freshness ignored during ranking |
| P1 | Usage totals overreact to one missing cumulative field |
| P1 | `qualityPassRate` conflates completion and quality |
| P2 | Symlink policy mismatch |
| P2 | Artifact digest not enforced by API |
| P2 | Narrow conflict detection |
| P2 | Evidence deduplication may lose metadata |
| P3 | Lexical tokenizer/ranking limitations |
| P3 | Decision successor validation |
| P3 | Implicit evidence-hash invariant |

## Overall assessment

The repository’s engineering discipline is unusually strong: it explicitly separates implemented behavior from provider readiness, forbids mock-only production claims, and requires evidence-backed completion.

The main risk is not dishonest status reporting, but several places where implementation does not yet fully enforce the project’s own correctness invariants.

Highest-value next fixes:
1. Request-level workspace revalidation.
2. Truthful Git snapshot degradation.
3. Race-free memory archive deletion/import protocol.
