# W04 real-provider index scale evidence — 2026-10-20

**Source commit:** `c79afd87686579fe11174c4fd2182c2357ef9cc5`  
**Runner:** `npm run test:real-index-scale -- --files N --changed 1`  
**Provider path:** ACE MCP → FastEmbed worker → Qdrant → Tree-sitter → TypeScript-LS  
**Qdrant:** `qdrant/qdrant:v1.19.2@sha256:b7b0444c4c351c970b98e90a6f89c2ee4287c65b44e52b4cb503fa5b2aa927ad`  
**Node:** `v24.15.0`  
**Host:** Linux 6.2.6-76060206-generic, x86_64, Intel Core i7-9750H, 12 CPUs

The runner used `ACE_ENABLE_EXPERIMENTAL_QDRANT=true` and
`ACE_ALLOW_LOCAL_FALLBACK=false`. Both runs used the effective embedding
identity prefix `6b8415e1559a` and structural identity prefix `0ec80d6b4183`.
Coverage failures were zero in every phase.

## Retained raw artifacts

| Fixture | Artifact | SHA-256 |
|---:|---|---|
| 1,000 files | [`index-scale-2026-10-20-1000.json`](./index-scale-2026-10-20-1000.json) | `be7d2fa1f77b54178daaa579233d57bb53d332d85e47206705c9d99408e6c0c5` |
| 10,000 files | [`index-scale-2026-10-20-10000.json`](./index-scale-2026-10-20-10000.json) | `0fb51c7aa06c8a75f047294d53bf12065a0245fa93065ab918c43afc1216fa8e` |

## Successful runs

All timings are wall-clock milliseconds reported by the runner. `change-only`
uses one modified existing file, one rename, one deletion and one genuinely
untracked file.

| Fixture / phase | Elapsed | Index mode | Indexed / candidates | Cache hits (structural / candidate) | Reused vectors | Delta changed / added / deleted / renamed | Complete |
|---|---:|---|---:|---:|---:|---:|---|
| 1k cold | 102,625 | rebuilt | 1,000 / 1,000 | 0 / 0 | 0 | 0 / 1,000 / 0 / 0 | yes |
| 1k warm | 8,402 | warm_reused | 1,000 / 1,000 | 0 / 1,000 | 1,000 | 0 / 0 / 0 / 0 | yes |
| 1k change-only | 10,183 | rebuilt | 1,000 / 1,000 | 0 / 997 | 997 | 1 / 1 / 1 / 1 | yes |
| 10k cold | 983,239 | rebuilt | 10,000 / 10,000 | 0 / 0 | 0 | 0 / 10,000 / 0 / 0 | yes |
| 10k warm | 24,814 | warm_reused | 10,000 / 10,000 | 0 / 10,000 | 10,000 | 0 / 0 / 0 / 0 | yes |
| 10k change-only | 33,162 | rebuilt | 10,000 / 10,000 | 0 / 9,997 | 9,997 | 1 / 1 / 1 / 1 | yes |

## Failed attempts retained as negative evidence

- The first 1k run exposed an observability defect: an unchanged warm run
  reported `deltaAdded=1000`. The runtime fix makes a published current
  snapshot compare against itself, producing zero warm deltas.
- A 10k attempt before child-lifecycle cleanup failed with `ENOTEMPTY` while
  removing the temporary structural cache. The runner now waits for every MCP
  child to exit, force-kills after a bounded grace period, and uses bounded
  recursive cleanup retries.
- A subsequent 10k attempt reached the cold phase timeout of the original
  15-minute limit. The phase limit is now configurable and defaults to a
  bounded 30 minutes; the successful cold phase took 983 seconds.

## Claim boundary

This is one real-provider scale run on one host and one pinned Qdrant image.
It is evidence for the bounded W04 cold/warm/change-only scenario, not a
production-performance approval. Repeated measurements, concurrent readers and
writers, interrupted-writer/restart recovery, selected-provider approval,
resource budgets and the remaining W01–W15 gates are still required.
