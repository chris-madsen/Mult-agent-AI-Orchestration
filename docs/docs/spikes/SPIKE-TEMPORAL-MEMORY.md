# SPIKE — Temporal memory provider readiness

**Status:** Local archive/export/Graphiti connectivity implemented; extraction approval remains open

The local archive stores exact episode bytes by verified SHA-256, keeps metadata and
source pointers, rejects digest mismatches, is idempotent on replay, and writes
tombstones on deletion. Projection receipts are keyed by episode and extractor
version. DecisionRecord promotion requires explicit confirmation; search preserves
as-of filtering and conflicting accepted claims.

A typed Graphiti projection/purge boundary now exists with policy and token checks;
it does not fabricate Graphiti IDs or claim deletion completion without a successful
backend response.

`graphiti-core[falkordb] 0.31.1` is installed and imports successfully in `.venv-system`
using host Python 3.10.12; the optional `falkordb 1.8.0` and `redis 8.1.0` clients are
included in `requirements-provider.txt`. No model credentials are configured, so no
real episode projection is claimed.

Its local FalkorDB dependency is running as Docker container `ace-falkordb`, bound to
`127.0.0.1:6379`; Redis PING succeeds, the loaded FalkorDB module reports version
`4.22.1`, and `FalkorDriver.health_check()` succeeds against graph `ace_healthcheck`.
This proves database/driver connectivity only, not an end-to-end Graphiti extraction
run.

The selected storage backend is local-first Graphiti `0.31.1` over FalkorDB;
Graphiti exposes `remove_episode` plus index build/delete lifecycle APIs;
the local deployment policy is therefore: raw archive is the source of truth,
derived graph projection is versioned, episode removal is explicit, and index rebuild
is a maintenance operation. No episode was projected during this spike because no
approved extraction/model backend is configured.

The local Codex history exporter reads the observed `history.jsonl` contract and
emits exact line bytes, source SHA-256 and `(line, byteStart, byteEnd)` cursors.
It is suitable for local opt-in import; it is not claimed to be a stable official
Codex session replay/export API.

`npm run recall:codex-history -- check` ran against the current local history source:
4 episodes imported, 1 technical-term hit returned, with occurred timestamp,
source SHA-256 and `(line, byteStart, byteEnd)` citation metadata. The generated
`.ace/codex-history-recall.json` explicitly contains no raw dialogue.

The installed environment does not provide a verified Codex session-export contract
or an approved Graphiti lifecycle/deletion contract. Therefore ACE does not fabricate
old messages, Graphiti IDs or extracted accepted decisions. A future probe must pin
the exporter cursor identity, Graphiti backend/version, residency, retry and purge
semantics before implementing external adapters.
