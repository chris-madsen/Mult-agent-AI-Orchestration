# ACE testing strategy

This document describes the operational test loop. Normative capability acceptance still lives in OpenSpec and the architecture fitness contracts.

## Goals

- Keep the development feedback loop short without weakening PR/release confidence.
- Run the **smallest test that can prove the changed invariant**.
- Keep the test suite curated: regression coverage may be consolidated or deleted when it is redundant.
- Separate deterministic developer/PR verification from expensive provider, scale and release evidence.

## Commands

| Command | Purpose | Normal use |
| --- | --- | --- |
| `npm run test:affected` | Select deterministic TypeScript tests affected by the current diff | Inner development loop |
| `npm run test:affected -- --dry-run` | Show selection without executing it | Inspect/debug impact selection |
| `npm run test:affected -- --base origin/main` | Select tests affected by the entire branch | Optional branch-wide check before full verification |
| `npm run test:fast` | Alias for the affected deterministic TypeScript tests | Inner development loop |
| `npm run check` | TypeScript strict typecheck only | Explicit type gate |
| `npm run build` | Emit `dist/`; incremental state is reused locally | Runtime/E2E preparation |
| `npm run verify:pr` | Typecheck + selected affected/limited smoke TS tests + lint + architecture + SDLC preflight | Fast PR/handoff; **not a full acceptance claim** |
| `npm run verify:pr:affected` | Compatibility alias to the bounded `verify:pr` | Legacy local invocations |\n| `npm run verify:full` | All deterministic TS/Hermes, lint, build/source provenance, architecture, SDLC and Gateway property tests | Scheduled nightly/manual; not every PR |

A clean CI worker installs dependencies once with:

```bash
npm ci --ignore-scripts
```

Do not run `npm ci` repeatedly inside an already-installed development workspace. It is a clean-install command, not a build command.

## Affected-test selection

`scripts/run-affected-tests.mjs`:

1. compares staged, unstaged and untracked work against `HEAD` by default, keeping the edit loop narrow; use `--base origin/main` when you explicitly want branch-wide impact;
2. includes staged, unstaged and untracked files;
3. uses the installed TypeScript parser to build a reverse graph of relative runtime imports across `src/` and `test/`, excluding imports/exports that are entirely type-only;
4. walks that graph from changed source files to dependent tests;
5. selects directly changed test files;
6. for `scripts/` changes, selects tests that directly reference the changed script/name;
7. for broad build/test configuration edits (package, lockfiles or TS/ESLint config), adds a **small explicit smoke set** and any affected tests; never silently invokes the entire suite. This does not assert full transitive dependency coverage.\n8. when zero tests are selected, prints an explicit `NO MATCHING TESTS` limitation; typecheck/lint and the next nightly full run are independent signals, not proof that the changed behavior is tested.

Type-only dependency edges are owned by the TypeScript gate rather than runtime tests. Documentation-only changes normally select no TypeScript tests, and CI checks their diff without installing Node dependencies.

The selector has a small built-in self-check:

```bash
npm run test:impact:self
```

## Test portfolio rules

Before adding a test for a defect:

1. identify the invariant that failed;
2. search for the existing test that owns that invariant;
3. add a focused case/table row there when possible;
4. add a new test file only when it owns a genuinely new contract/subsystem;
5. keep high-level/E2E coverage only for behavior that cannot be proven below that layer.

The same edge case should not normally be repeated at unit, contract, process, provider and agent levels. A higher layer should prove its **unique boundary/wiring**, not replay every lower-level input permutation.

It is acceptable for a PR to remove more tests than it adds when equivalent or stronger protection remains.

## Expensive evidence

Real-provider and acceptance commands are not part of the edit-by-edit loop. Run them when the corresponding capability changed or when refreshing acceptance/release evidence.

Typical mapping:

- Qdrant / embeddings / index lifecycle: `test:real-provider*`, `test:real-qdrant-crash`, and `test:real-index-scale` when scale behavior changed.
- ast-grep structural / generic LSP provider: `test:real-semantic`, `test:real-same-name`, and `test:real-non-ts-lsp` when a selected non-TypeScript server/runtime is available.
- MCP runtime/container composition: `test:container-provider`.
- Graphiti / retained memory / outbox: `test:real-graphiti-lifecycle`, `test:real-graphiti-crash`.
- Vertex documentation path: `test:real-vertex-conflict`.
- Harbor / DBC / release: run the relevant gates only for acceptance or release evidence, not after ordinary edits.

Several expensive commands against unchanged source should reuse the same emitted build. TypeScript incremental compilation is enabled so repeated `npm run build` calls do not intentionally perform a clean rebuild.

## CI policy

There are **two automatic execution scopes**, with optional manual full verification.

**PR minimal/focused** (`pull_request`, not every push to `main`):

1. Classify changed paths using NUL-delimited Git diff against the actual PR base/head; no silent full-suite fallback.
2. Docs-only: `git diff --check` and offline changed-Markdown link check; no npm installation.
3. Source/test/toolchain: `npm ci --ignore-scripts` **once**, `ACE_TEST_BASE=<PR base SHA> npm run verify:pr`: typecheck, affected TS tests and a bounded smoke set for broad config changes, lint, architecture and preflight.
4. Go/Bifröst changes: only Go `test`/`vet` on changed Go scope. Hermes plugin changes: only its Python tests. Shared public-contract fixture changes trigger all three applicable language gates.
5. Keep scoped secret scanning and actionlint/zizmor on changed workflows. These security checks are fast and independent; do not disable them to save minutes.
6. No full Qdrant/FastEmbed, non-TS rust-analyzer, Harbor, TypeScript-wide `npm test`, Knip or OSV scans on an ordinary PR. A green fast PR is **not** a provider/release/whole-repo certification.

**Nightly full** (`schedule`, plus manual `workflow_dispatch`):

1. `npm run verify:full` for all deterministic TS/Hermes tests, build/provenance, architecture, preflight and Gateway property checks.
2. Real Qdrant provider/restart/two-writer/crash and real rust-analyzer conformance with retained logs.
3. Go/Bifröst tests and vet; Knip and OSV via the separate scheduled dependency workflow.
4. Failures stay failures. Do not rerun or weaken expensive oracles merely to get a green status; report sources, provider identity, source/tested SHA and any environment-induced uncertainty.

**Repository policy:** the owner explicitly **does not want branch protection, GitHub rulesets, required checks or mandatory PR approvals**. Do not request/configure them. Independent G02 architectural decisions, source correctness and relevant provider/release evidence are still required by their accepted contracts.

To run the full scope locally when it is useful, call `npm run verify:full` explicitly. Do not make agent prompts or workflow defaults run it for every PR.
