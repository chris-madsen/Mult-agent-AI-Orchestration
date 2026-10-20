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
| `npm run test:fast` | Run the full deterministic TypeScript suite | Final local check / CI |
| `npm run check` | TypeScript strict typecheck only | Explicit type gate |
| `npm run build` | Emit `dist/`; incremental state is reused locally | Runtime/E2E preparation |
| `npm run verify:pr` | Typecheck + full deterministic tests + lint + build | Once before handoff and in CI |

A clean CI worker installs dependencies once with:

```bash
npm ci --ignore-scripts
```

Do not run `npm ci` repeatedly inside an already-installed development workspace. It is a clean-install command, not a build command.

## Affected-test selection

`scripts/run-affected-tests.mjs`:

1. compares the branch/worktree against `origin/main` when available (or `HEAD` locally);
2. includes staged, unstaged and untracked files;
3. builds a reverse graph of relative imports across `src/` and `test/`;
4. walks that graph from changed source files to dependent tests;
5. selects directly changed test files;
6. for `scripts/` changes, selects tests that directly reference the changed script/name;
7. falls back to the entire deterministic suite for broad build/test configuration changes such as `package.json`, lockfiles and TypeScript/ESLint configuration.

Documentation-only changes normally select no TypeScript tests. This is intentional; CI still performs the full deterministic PR gate.

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
- Tree-sitter / semantic provider: `test:real-semantic`, `test:real-same-name`.
- MCP runtime/container composition: `test:container-provider`.
- Graphiti / retained memory / outbox: `test:real-graphiti-lifecycle`, `test:real-graphiti-crash`.
- Vertex documentation path: `test:real-vertex-conflict`.
- Harbor / DBC / release: run the relevant gates only for acceptance or release evidence, not after ordinary edits.

Several expensive commands against unchanged source should reuse the same emitted build. TypeScript incremental compilation is enabled so repeated `npm run build` calls do not intentionally perform a clean rebuild.

## CI policy

The deterministic PR workflow:

1. checkout;
2. install locked dependencies once with `npm ci --ignore-scripts`;
3. run the Python embedding evaluator regressions;
4. install the pinned structural test dependency;
5. self-check the impact selector;
6. run `npm run verify:pr`.

Provider/k3s/Harbor/release evidence remains separate because those jobs require capability-specific infrastructure, authorization and retained evidence. A green deterministic PR workflow does not imply those production gates passed.
