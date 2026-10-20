# W15 backup/restore evidence — 2026-10-20

This receipt was generated from the exact branch commit
`0550256bfa7c24b692ce138796769aa345cd42ae` before the evidence files were
added. It records only a synthetic local archive round-trip; it is not a
production backup or restore approval.

## Retained evidence

- Raw run: `benchmarks/reports/backup-restore-raw-run-0550256.json`.
- Evaluated receipt: `benchmarks/reports/backup-restore-evidence-0550256.json`.
- Local round-trip artifact:
  `benchmarks/reports/operations-local-memory-roundtrip-0550256.json`.
- The retained artifact SHA-256 is
  `88abfda4269fa392429cd4b41ca2e63a4f6e519730d0942d16bc7b01ab2b2832`.

The real local run executed `BACKUP_CREATED`, `VERIFIED`, and `RESTORED` for
two synthetic archive/projection-outbox files. The restored files were byte
identical and the restore destination was isolated from the source and bundle.

## Verdict

The evaluator returned `operations-backup-restore-incomplete`:

- `OPS-01` local archive backup/verify/restore: PASS.
- `OPS-06` isolated restore safety: PASS.
- `OPS-02` Graphiti/FalkorDB restore: BLOCKED; no supported local Graphiti MCP
  command or approved provider backup was available.
- `OPS-03` Qdrant/PVC restore: BLOCKED; no retained Qdrant/PVC restore run was
  executed.
- `OPS-04` restart reconciliation after provider restore: BLOCKED because the
  restored provider lifecycle is unavailable.
- `OPS-05` retention/deletion after provider restore: BLOCKED; the synthetic
  archive round-trip cannot prove derived survivor/tombstone behavior.

This evidence closes neither W06/W07 nor the production release gate. It does
not establish Graphiti local-only behavior, Qdrant/PVC durability, Kubernetes
restore behavior, or owner approval.
