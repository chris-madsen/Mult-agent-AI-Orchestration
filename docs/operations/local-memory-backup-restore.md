# Local ACE memory backup and restore

This procedure covers only ACE-owned local memory source truth:

- immutable session archive metadata/content blobs;
- tombstones;
- the nested durable Graphiti projection outbox.

It **does not** back up FalkorDB/Graphiti database state, Qdrant vectors/PVCs, Kubernetes Secrets, cloud corpora, or the user worktree. Those remain separate operational evidence before the full release preflight can accept `operations-backup-restore`.

## Quiescence is mandatory

Stop memory imports, deletes and projection reconciliation before backup or restore. The CLI requires an explicit acknowledgement:

```bash
export ACE_MEMORY_BACKUP_ACK_QUIESCED=true
```

The adapter also refuses an active `.archive-write.lock`. The acknowledgement is not a distributed lock; it records the operator precondition.

## Backup

```bash
ACE_MEMORY_BACKUP_ACK_QUIESCED=true npm run memory:backup -- \
  backup /absolute/ace-memory-archive /absolute/backups/ace-memory-2026-10-20
```

The backup:

- refuses overlapping source/destination paths;
- refuses symbolic links and non-regular filesystem objects;
- copies into a sibling staging directory;
- SHA-256 verifies source versus copied bytes;
- records exact relative path, size and digest membership;
- writes `manifest.json` only after copies succeed;
- atomically renames the completed staging directory into place.

## Verify

Verification is read-only and does not need the quiescence acknowledgement:

```bash
npm run memory:backup -- verify /absolute/backups/ace-memory-2026-10-20
```

Verification requires exact file membership plus every recorded size and SHA-256. Extra, missing or modified files fail the bundle.

## Restore

Restore never overwrites an existing destination:

```bash
ACE_MEMORY_BACKUP_ACK_QUIESCED=true npm run memory:backup -- \
  restore /absolute/backups/ace-memory-2026-10-20 /absolute/restored-ace-memory
```

The bundle is fully verified first, files are copied into a new sibling staging directory and re-hashed, then staging is atomically renamed to the requested destination.

After restore, point a stopped/test ACE memory process at the restored root and run archive/outbox integrity plus Graphiti reconciliation before promotion.

## Full production evidence

A successful local archive round-trip is necessary but not sufficient for W07/W15. Codex still needs to demonstrate the selected FalkorDB/Graphiti backup/restore procedure, Qdrant/index recovery where applicable, Kubernetes/PVC behavior, restart reconciliation and owner retention/deletion requirements. Only the combined retained evidence may use the full release label `operations-backup-restore`.

## Machine-checkable operations evidence

The combined production evidence has six stable checks:

| ID | Required proof |
| --- | --- |
| `OPS-01` | ACE immutable archive + projection outbox backup, verify and restore preserve exact membership/digests |
| `OPS-02` | Selected Graphiti/FalkorDB persistence backup + restore returns the expected derived state |
| `OPS-03` | Qdrant/index recovery restores or truthfully rebuilds current snapshot membership without stale-current claims |
| `OPS-04` | ACE/provider restart after restore reconciles pending work and reaches the expected readiness state |
| `OPS-05` | Retention/deletion behavior after restore preserves survivors and keeps deleted episodes/tombstones deleted |
| `OPS-06` | Restore occurs into an isolated destination and does not mutate the user worktree or unrelated secrets/state |

Record the real run in a repository-contained JSON file with one record for every check. `PASS`/`FAIL` require the exact safe command, observations and retained artifact SHA-256. `NOT_RUN`/`BLOCKED` require an explicit limitation.

Finalize it with:

```bash
npm run evidence:backup-restore -- \
  artifacts/operations/raw-run.json \
  artifacts/operations/backup-restore-evidence.json
```

For a hard gate:

```bash
ACE_REQUIRE_BACKUP_RESTORE_EVIDENCE=true npm run evidence:backup-restore -- ...
```

Only all six checks passing on the exact current commit emits `evidence = operations-backup-restore`. Any missing/failed/not-run check or retained-artifact digest mismatch remains incomplete and cannot satisfy the unified production preflight.
