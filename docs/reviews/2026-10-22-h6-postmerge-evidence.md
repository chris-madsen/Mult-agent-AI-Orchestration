# ACE H6 post-merge evidence audit — 2026-10-22

## Scope and exact source

This audit covers the post-merge `main` tip:

```text
4161c96c77705ecbc7d9145c5e1238d1adcbc9fc
```

The audit does not rewrite frozen v3, reranker, ACE, or Chess artifacts. The
machine-readable result is
[`benchmarks/reports/ace-h6-postmerge-audit-4161c96.json`](../../benchmarks/reports/ace-h6-postmerge-audit-4161c96.json).

PRs #136–#143 are included in this source tip. The original user worktree was
not reset or cleaned; its untracked `docs/plans/plan.md` and `plan2.md` remain
outside this evidence worktree.

This follow-up branch adds the independent Harbor trial reader/reconciler and
its fail-closed contract coverage. The exact post-merge commit above remains
the baseline identity; the final implementation commit is recorded in the
machine-readable report after this branch is committed.

## Requirement-to-evidence matrix

| Requirement | Evidence | Verification | Status |
|---|---|---|---|
| Exact post-merge source/runtime identity | baseline `main@4161c96`; follow-up runtime provenance is recorded in the machine artifact | `tsc -p tsconfig.json && node scripts/generate-runtime-provenance.mjs` | verified for baseline; follow-up commit recorded below |
| Deterministic regression portfolio | 423 tests, including provenance, reranker, Harbor binding, trial reconciliation, instrumentation and UTF-8 cases | `./node_modules/.bin/tsx --test --test-concurrency=1 test/*.test.ts` | verified: 423/423 |
| Typecheck/lint/build | Exact post-merge worktree | direct locked binaries; see machine-readable report | verified |
| H6-CR-01 provenance | PR #137 implementation and `test/runtime-provenance.contracts.test.ts` | full serial suite | verified |
| H6-CR-02 unknown-safe reranker | PR #138 implementation and reranker contract tests | full serial suite | verified |
| H6-CR-03 Harbor binding | PR #139 byte-binding mutation matrix, trial-level raw reader/reconciler, and forged-aggregate tests | full serial suite; no real Harbor trial bundle | partial: implementation present, scored evidence open |
| H6-CR-04 native-read metric | PR #140 unknown/fail-closed quality gate | retrieval quality contract tests | verified; real read telemetry unknown |
| H6-CR-05 UTF-8 ranges | PR #140 shared byte-range primitive and Unicode fixtures | UTF-8 range tests | verified |
| OpenSpec canonical root | one `openspec/config.yaml`, seven active changes, generated skills | OpenSpec 1.14.0 `list`, `status`, `validate --all --strict`, `doctor` | verified |
| Frozen v3 five-strategy ablation | Historical holdout is external and not mounted | provider/holdout preflight | blocked |
| Natural-use Harbor | Codex, Docker and Harbor binaries exist, but frozen external tasks/runtime are absent; Qdrant is unavailable | capability probe and filesystem preflight | blocked |
| Production blockers | Graphiti/FalkorDB, Vertex evidence, k3s release scope, supply-chain and owner artifacts remain separate | no valid full release preflight inputs | not_done |

## Commands and observations

The normal npm gates could not be invoked because this runner has no `npm`
executable. The locked repository dependency tree was reused through direct
binaries without changing package files. The equivalent deterministic gates
passed:

```text
./node_modules/.bin/tsx --test --test-concurrency=1 test/*.test.ts  # 423/423 PASS
./node_modules/.bin/tsc -p tsconfig.json --noEmit                    # PASS
./node_modules/.bin/eslint src test --ext .ts --max-warnings=0       # PASS
./node_modules/.bin/tsc -p tsconfig.json && node scripts/generate-runtime-provenance.mjs # PASS
node scripts/run-affected-tests.mjs --self-test                      # PASS
./node_modules/.bin/tsx --test --test-concurrency=1 test/harbor-four-arm-trial-evidence-adapter.contracts.test.ts test/harbor-four-arm-evidence.contracts.test.ts test/harbor-four-arm.contracts.test.ts # 12/12 PASS
```

The baseline parallel test invocation produced one transient TypeScript
language-service failure (`Err` instead of `Ok`) while the baseline serial
suite passed `416/416`. The follow-up serial suite passed `423/423`; the
parallel observation is retained as a runner/resource limitation and is not
relabeled as a code failure.

OpenSpec 1.14.0 reported:

```text
validate --all --strict --no-interactive --report full: 7 passed, 0 failed
doctor: healthy
```

No `apply`, `sync`, or `archive` operation was run. Change `007` remains
active and unarchived.

## External blockers

The current Linux environment has:

- Codex CLI `0.148.0-alpha.9`, authenticated;
- Docker `24.0.6`;
- Harbor `0.24.0`;
- k3s `v1.35.5+k3s1`.

It does not have the external v3 ACE/Chess holdout checkout, the frozen Harbor
task/runtime bundle, a healthy local Qdrant endpoint, or the required
Graphiti/FalkorDB Python/provider modules. The historical Windows paths in the
ledger are not present on this Linux filesystem.

Therefore the following are intentionally **not** run and cannot be promoted:

- sparse/BM25-only, dense-only, hybrid RRF, hybrid+reranker and
  hybrid+Working Context scored ablation;
- native/dense/hybrid/hybrid+delta natural-use Harbor trials;
- token/cost winner, 5× result or provider winner;
- production Graphiti, Vertex, k3s and owner-release gates.

The Harbor gate now contains an independent trial-level reader/reconciler for
per-trial task outcomes, actual ACE calls, correlated receipts and raw usage.
The external raw Harbor result bundle was not mounted here, so that validator
was exercised only with deterministic contract fixtures; byte hashes alone
remain insufficient for a benchmark claim.

## OpenSpec status interpretation

The bounded implementation contracts H6-CR-01, H6-CR-02, H6-CR-04 and
H6-CR-05 are checked in `007/tasks.md` because their fail-closed behavior and
deterministic tests are present on the exact post-merge commit. H6-CR-03 stays
open because actual per-trial Harbor evidence has not been independently
reconciled. All real-provider, agent-E2E, scored benchmark and owner-approval
tasks remain unchecked.

## Final status

```text
implementation: substantially complete
real-provider evidence: partial
agent-E2E: not completed
benchmark acceptance: not completed
production readiness: not approved
5x claim: unproven
```
