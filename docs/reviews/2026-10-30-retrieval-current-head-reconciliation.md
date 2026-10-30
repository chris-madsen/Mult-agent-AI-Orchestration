# Retrieval current-head reconciliation — 2026-10-30

This review records the retrieval checks performed against the exact current
`main` source commit `9a242ca24eef00c1425998e9ba8ed81aa84bbb65`. It is an
evidence receipt, not a production-readiness approval and not a token-savings
claim.

## Runtime identity

- Host execution: Linux-native checkout, not a Windows runtime.
- Node: `v22.23.4` from the repository-supported Linux runtime.
- Package lock: repository `package-lock.json`; dependencies installed with
  `npm ci --ignore-scripts`.
- Structural provider: `ast-grep 0.51.0`.
- TypeScript semantic provider: `typescript-language-server 6.0.2`.
- Source/build identity: `9a242ca24eef00c1425998e9ba8ed81aa84bbb65`.
- Historical report `benchmarks/reports/real-retrieval-gates-9512.json` remains
  historical and acceptance-invalid; it is not relabeled.

Audit follow-up found that the same-name runner previously wrote those two
provider versions from a duplicated literal. The values happened to match this
run, but a configured replacement binary could have been mislabeled. The
runner now obtains both versions through the existing ast-grep and LSP identity
resolvers, and a real-process regression fixture covers the configured-command
case. The retained report remains evidence for the exact `9a242ca` run above;
no later source commit is retroactively substituted.

## Deterministic current-head checks

| Check | Result | Observation |
|---|---|---|
| `npm run verify:pr` | PASS | `672/672` TypeScript tests, Hermes context plugin `20/20`, lint and build passed. |
| `npm exec --yes --package=@fission-ai/openspec@1.14.0 -- openspec validate --all --strict --no-interactive --report full` | PASS | `9 passed, 0 failed`; all active changes were validated. |
| Retrieval focused suites | PASS | `146/146` Qdrant, WorkspaceSync, AST, RepoMap, LSP, semantic-snapshot and ContextAssembler tests passed. |
| `npm run test:real-same-name` | PASS | Current-head report is retained in [`benchmarks/reports/real-same-name-lsp-e2e.json`](../../benchmarks/reports/real-same-name-lsp-e2e.json). |

The focused command was:

```text
npx tsx --test test/qdrant-real-pipeline.contracts.test.ts test/workspace-sync.contracts.test.ts test/qdrant-crash-runner.contracts.test.ts test/ast-grep-napi.contracts.test.ts test/ast-grep-parity.contracts.test.ts test/ast-grep-structural.contracts.test.ts test/index-state.contracts.test.ts test/source-text.contracts.test.ts test/repo-map.contracts.test.ts test/repo-map-service.contracts.test.ts test/repo-map-retrieval.contracts.test.ts test/repo-map-structural.contracts.test.ts test/lsp-server-registry.contracts.test.ts test/lsp-semantic.contracts.test.ts test/semantic-snapshot.contracts.test.ts test/context-assembler.contracts.test.ts test/context-transform.contracts.test.ts
```

## Real-provider gate status

The Linux provider probe found the local ast-grep and TypeScript LSP binaries,
but Qdrant health at `http://127.0.0.1:6333/healthz` was unavailable. The
Qdrant-dependent gates therefore returned an honest `not_ready` response and
remain blocked rather than being converted into a pass:

- `npm run test:real-provider` — BLOCKED by `qdrant_collection_unavailable`.
- `npm run test:real-provider-race` — BLOCKED by the same unavailable Qdrant
  service before the race assertion.
- `npm run test:real-provider-restart` — BLOCKED because the first real
  retrieval response was `NOT_READY`.
- `npm run test:real-semantic` — BLOCKED because the real retrieval path was
  `NOT_READY`.
- `npm run test:real-non-ts-lsp` — BLOCKED: `rust-analyzer` is not installed.

The Qdrant concurrency, crash, timeout, stale-count and scale runners were not
promoted to acceptance evidence because their required real Qdrant service was
unavailable. Their contract-level runner and failure-closed assertions remain
covered by the deterministic suite above.

## Retrieval status after reconciliation

| Area | Current status |
|---|---|
| R1 Qdrant SDK | Implementation and deterministic safety contracts pass; current real-provider evidence is blocked by Qdrant availability. |
| R2 shared AST | Shared records, CLI/NAPI fixture parity and byte-range contracts pass; full real-repository def/ref parity remains open. CLI remains the production default. |
| R3 RepoMap | Aider-derived ranking/rendering and frozen behavioral contracts pass; production graph wiring and real-repository quality evidence remain open. |
| R4 publication | Stable publication/fencing contracts pass; current multiprocess/crash evidence remains open. |
| R5 Claw LSP | Serialized lifecycle, generation identity and same-name TypeScript evidence pass; non-TS provider and complete Claw acceptance remain open. |
| R6 ContextAssembler | Composition, deduplication, omissions and lossless expansion contracts pass; model-aware production counting remains open. |
| R7 cleanup | No ownership deletion was justified by this reconciliation; the negative diff remains open for a dedicated slice. |
| R8 evidence/A-B | Open: no current raw Qdrant-bound evidence and no matched Hermes native-vs-ACE provider-usage run. |

No production, agent-E2E, benchmark, provider-selection or owner-approval
claim changed as a result of this receipt.
