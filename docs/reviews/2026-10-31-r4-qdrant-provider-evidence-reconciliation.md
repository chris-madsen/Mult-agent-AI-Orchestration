# R4 Qdrant provider evidence reconciliation

**Date:** 2026-10-31

**Scope:** map the real-provider restart, two-writer, and crash scenarios required by the active retrieval plan (R4 / F05) to retained CI evidence. This review makes no production-readiness or performance claim.

## Decision

The named R4 provider scenarios are covered on the Qdrant single-owner PR's exact source tree. No additional R4 concurrency/restart/crash command was run: the `real-qdrant` job for PR #217 already ran that complete sequence and retained its outputs. The basic provider path was also exercised locally at the PR head, as recorded below. Repeating the CI scenarios would not add evidence.

This is bounded real-provider evidence only. It does not prove a multi-operation Qdrant transaction, arbitrary writer counts/interleavings, or production approval.

## Evidence binding

### Earlier evidence: PR #214

- PR head: `57d27361d240c6f1436e8fe2322c67e68c90fdfc`; CI run: `41223136646`; `real-qdrant` job: `124601662092`; all four workflow jobs passed.
- The job ran the actual provider and restart tests, then real two-writer and crash acceptance. It uploaded artifact `ace-real-qdrant-41223136646` with provider/restart logs, concurrency/crash JSON, and request-correlated traces.
- The reports identify their executed source commit as `3d3a30eedfdc5b48850697693b085c0123e1ad5b`, with `cleanAtStart=true`. Treat that exact source identity as historical evidence; do not relabel it as a later commit.

### Current evidence: PR #217

- PR head: `3db40bd9e60a152b39b01136766bf51639003cb9`; base: `main` at `ec09f51d6e87b1b913ce6edb2674472d62e8b0c3`.
- CI run: `41233460915`; `real-qdrant` job: `124632247132`; job conclusion: success. At review time PR #217 was open, and its `contracts`, `bifrost-connector`, `real-non-ts-lsp`, and `real-qdrant` checks passed.
- GitHub executed the PR merge ref `612f7f772a10fd28739bd92658fb8c0b25312935`, whose parents are the stated `main` SHA and PR head. Its Git tree (`a02f578231ccc39c44413ae9917a1d0ef21580b1`) is identical to the PR-head tree. The uploaded reports retain the merge-ref commit rather than the PR-head commit; this distinction is intentional.
- The merge-ref build reports `sourceCleanAtBuild=true`, manifest SHA-256 `afc955c6561424328b4fca07354eb3b00877ca31ff8a059e759634e070b57b27`, and executable SHA-256 `b356466541672d47d2dd8602cb216eb026bf1cd20c0c3febb893238cb8585a35`. Both digests match the local clean build recorded for PR head `3db40bd9e60a152b39b01136766bf51639003cb9`.
- Uploaded artifact: `ace-real-qdrant-41233460915` (workflow retention: 14 days). Its `provider.log`, `restart.log`, `concurrency.json`, `crash.json`, and provider traces were downloaded and inspected. SHA-256:
  - `provider.log`: `53f90763aa1d5d48e825ed2603493d6f9800a1467e803653fd14fe3f51e379e8`
  - `restart.log`: `8efd1b750c197f339fefccbce74f86e0604280eef9cd27a43b28486a764abf4c`
  - `concurrency.json`: `797b9419da18f207e651cead0e7978eb95d98636981beb982c983548698f82a7`
  - `crash.json`: `5922071a04672f4a83e3f3a3893cf809e4f68c2501cf5a0e3994eb1d5a920c53`

A separate local `npm run test:real-provider` also passed on clean PR head `3db40bd9e60a152b39b01136766bf51639003cb9` against loopback Qdrant, with current citation `service.ts:1-25`, `complete=true`, and exact 63,482-byte expansion. This is synthetic/local-provider evidence, not cloud/provider-wire or Hermes-agent evidence.

## Scenario mapping

| Scenario | Retained current-tree result |
| --- | --- |
| Real retrieval and source expansion | `provider.log`: provider-pass; source is current; complete result; exact source digest and expansion bytes recorded. |
| Process restart and warm reuse | `restart.log`: generation 1 initial build, generation 2 warm reuse, generation 3 changed-content publication; stable collection reused. |
| Two concurrent production writers | `concurrency.json`: both requests complete with current citations and the same source digest; both converge on the index key, provider fingerprint, and stable collection; all seven assertions are `PASS`. Qdrant identity is `qdrant/1.19.2`; runtime Node is `v22.23.4`. |
| Interrupted writer and recovery | `crash.json`: writer killed after Qdrant verification and before publication; reader reconciles to current content; restarted writer publishes S2; stable collection is reused; all eight scenario checks pass. |

The workflow sequence is the one in `.github/workflows/ace-contracts.yml`: `npm run test:real-provider`, `npm run test:real-provider-restart`, `npm run test:real-qdrant-concurrency`, and `npm run test:real-qdrant-crash`.

## Limits and status

- **R4 named provider scenarios:** passed on the PR #217 code tree with retained source-linked reports and traces.
- **F05 architecture limit:** the evidence covers bounded two-writer overlap and one deterministic writer-kill window. It does not establish general compare-and-set, lease, or multi-operation transaction semantics; ACE's publication coordination remains custom and must continue to fail closed outside these tested cases.
- The runners explicitly leave `productionApproved=false` and `tokenSavings5x=false`. They do not close DBC-13, establish production approval, measure scale, or certify Bifrost/Hermes behavior.
- `test:real-index-scale` was not run because the requested R4 slice is concurrency/crash/restart; scale is a separate evidence lane.
