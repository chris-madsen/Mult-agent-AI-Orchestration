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
| `npm run verify:pr` | Typecheck + full deterministic tests + lint + build | Once before handoff and in CI |
| `npm run verify:pr:affected` | Typecheck + affected deterministic tests + lint + build | Narrow PR verification in CI |

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
7. falls back to the entire deterministic suite for broad build/test configuration changes such as `package.json`, lockfiles and TypeScript/ESLint configuration.

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

The deterministic PR workflow is scope-aware:

1. checkout;
2. classify the PR from its changed paths;
3. for documentation/evidence-only changes, run `git diff --check` without installing Node dependencies;
4. for narrow source/test/script changes, install locked dependencies once, install the pinned structural provider, and run `npm run verify:pr:affected` with the PR base as `ACE_TEST_BASE`;
5. for package/lock/configuration/CI/infrastructure/fixture changes and every push to `main`, run the full `npm run verify:pr` gate.

Provider/k3s/Harbor/release evidence remains separate because those jobs require capability-specific infrastructure, authorization and retained evidence. A green deterministic PR workflow does not imply those production gates passed.
