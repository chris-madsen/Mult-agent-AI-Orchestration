# ACE H6 post-merge baseline evidence — `main@665345d`

## Scope

This is the current post-merge baseline after PR #144:

```text
665345df0ecea707179e8fcd2905aed8495681d3
parent: 4161c96c77705ecbc7d9145c5e1238d1adcbc9fc
PR: https://github.com/chris-madsen/Mult-agent-AI-Orchestration/pull/144
```

The machine-readable report is
[`ace-h6-postmerge-audit-665345d.json`](../../benchmarks/reports/ace-h6-postmerge-audit-665345d.json).
The original checkout's untracked `docs/plans/plan.md` and
`docs/plans/plan2.md` were not reset, cleaned or modified. All verification
was performed in a separate worktree.

This report updates the exact source identity after PR #144; it does not
rewrite historical frozen artifacts or convert implementation evidence into
real-provider, agent-E2E, benchmark or owner-approval evidence.

## Requirement-to-evidence matrix

| Requirement | Exact evidence | Status |
|---|---|---|
| Post-merge source/runtime identity | Local isolated worktree on `main@665345d`: source manifest `c958cc...a8890`, `sourceClean=true`. [GitHub Actions baseline run](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/actions/runs/39756480862): source manifest `b6f270...79b51`, `sourceClean=false` due to generated Python bytecode; same executable digest `dd8696...f00ab` | local verified; CI runtime provenance blocked |
| Deterministic test portfolio | Local serial 428/428; independent exact-baseline GitHub Actions 428/428 via `npm run verify:pr` | verified tests (not equivalent to clean runtime) |
| Typecheck/lint/build | direct locked binaries | verified |
| H6-CR-01 provenance | merged PR #137 and provenance contract tests passed, but exact baseline CI build generated a **dirty runtime manifest** | implemented and contract-tested; CI source-clean gate blocked |
| H6-CR-02 reranker safety | merged PR #138 and unknown-safe reranker tests | verified |
| H6-CR-03 Harbor binding | merged PR #139, PR #144 raw-trial reconciler and mutation/forgery tests; no real external trial bundle | partial; scored evidence open |
| H6-CR-04 instrumentation | merged PR #140; unknown native-read telemetry fails release limits | verified; real telemetry unknown |
| H6-CR-05 UTF-8 ranges | merged PR #140; Cyrillic, combining, emoji, CRLF and multiline fixtures | verified |
| OpenSpec root/workflow | one root, pinned CLI 1.14.0, 7/7 strict validation, healthy doctor | verified |
| Frozen v3 ablation | external ACE/Chess holdout checkout absent | blocked |
| Natural-use Harbor | task/runtime bundle and Qdrant unavailable | blocked |
| Production readiness | Graphiti/FalkorDB, Vertex, k3s, supply-chain and owner gates not closed | not approved |

## Commands and results

The environment has no `npm` executable. Therefore the literal commands
`npm run test:affected` and `npm run verify:pr` are recorded as `NOT_RUN`, not
as PASS. Their deterministic equivalents passed using the locked dependency
tree from the preserved checkout:

```text
node scripts/run-affected-tests.mjs                         PASS (no source diff)
node scripts/run-affected-tests.mjs --self-test              PASS
./node_modules/.bin/tsx --test --test-concurrency=1 test/*.test.ts  428/428 PASS
./node_modules/.bin/tsc -p tsconfig.json --noEmit             PASS
./node_modules/.bin/eslint src test --ext .ts --max-warnings=0 PASS
./node_modules/.bin/tsc -p tsconfig.json && node scripts/generate-runtime-provenance.mjs PASS
```

Pinned OpenSpec CLI was installed outside the repository:

```text
@fission-ai/openspec@1.14.0 --version                              1.14.0
openspec list                                                       7 active changes
openspec status --change 007-hybrid-context-engine                  4/4 artifacts complete
openspec validate --all --strict --no-interactive --report full      7 passed, 0 failed
openspec doctor                                                     root healthy
```

No `init`, `update`, `apply`, `sync` or `archive` operation was run. Change
007 remains active and its unchecked benchmark/provider/owner tasks remain
unchecked.

## Independent GitHub Actions cross-check: green tests ≠ clean runtime manifest

[GitHub Actions on the exact merged baseline `665345d`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/actions/runs/39756480862)
ran the literal `npm run verify:pr` and reported **428/428 PASS**. However,
after its Python embedding tests, `npm run build` reported:

```json
{
  "sourceCommit": "665345df0ecea707179e8fcd2905aed8495681d3",
  "sourceClean": false,
  "sourceManifestSha256": "b6f270bda62f9c04fd96a166267f5f726c308ed3b2cf70b99a0f6736de479b51",
  "executableSha256": "dd8696e2dc73b2d7661f8755a707ea52eae12e030f635bb8645ef3e5ef9f00ab",
  "dirtyRelevantPaths": [
    "scripts/__pycache__/embedding-provider-comparison.cpython-312.pyc",
    "scripts/__pycache__/embedding_artifact_verifier.cpython-312.pyc",
    "scripts/__pycache__/test_embedding_artifact_verifier.cpython-312.pyc",
    "scripts/__pycache__/test_embedding_provider_comparison_metrics.cpython-312.pyc"
  ]
}
```

**These are different observations:** the local, isolated worktree was
source-clean and had source manifest `c958cc...a8890`; the GitHub Actions
runner was *not* source-clean, and its manifest digest differed. The Python
`unittest` step emitted untracked bytecode under `scripts/`; the provenance
generator correctly treated these paths as relevant. Green unit tests alone
do **not** make that compiled CI runtime eligible for frozen scoring. The
appropriate remediation is to prevent Python tests from writing bytecode
(e.g. `python3 -B -m unittest`) and rerun the exact CI build to verify a
`sourceClean=true` manifest. Do not suppress the provenance check or
silently ignore the dirty paths in the manifest.

## Environment blockers

Available:

- Codex CLI `0.148.0-alpha.9`, authenticated;
- Docker `24.0.6`;
- Harbor `0.24.0`;
- k3s `v1.35.5+k3s1`.

Unavailable:

- local Qdrant endpoint at `127.0.0.1:6333`;
- `graphiti_core`, `falkordb` and `neo4j` Python modules;
- external frozen ACE/Chess v3 holdout checkout;
- frozen Harbor task/runtime evidence bundle.

Consequently these gates were not run and cannot be promoted:

- sparse/dense/hybrid/reranker/working-context scored ablation;
- native/dense/hybrid/hybrid+delta natural-use Harbor trials;
- accepted-task quality and measured token/cost winner;
- Graphiti, Vertex, k3s, supply-chain and exact-release owner gates;
- 5×, production-ready or provider-winner claims.

## Current status

```text
implementation: substantially complete
real-provider evidence: partial
agent-E2E: not completed
benchmark acceptance: not completed
production readiness: not approved
5x claim: unproven
```
