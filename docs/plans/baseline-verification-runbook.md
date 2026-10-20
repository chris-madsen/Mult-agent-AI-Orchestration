# W00 exact-main baseline verification

Run this from a clean checkout of the exact candidate commit. The runner uses only Node built-ins so it can perform a clean locked install itself.

```bash
node scripts/baseline-verification.mjs artifacts/baseline
```

For a hard CI/release handoff:

```bash
ACE_REQUIRE_BASELINE_GREEN=true \
  node scripts/baseline-verification.mjs artifacts/baseline
```

## What it executes

The runner records safe logs and SHA-256 for:

1. `node --version`
2. `npm --version`
3. `python3 --version`
4. `npm ci --ignore-scripts`
5. `npm run check`
6. `npm test`
7. `npm run lint`
8. `npm run build`
9. `openspec --help`
10. if available, `openspec --version`
11. `openspec validate --help`
12. strict validation of changes 001 through 006 from the `docs/` OpenSpec root

The OpenSpec help probes deliberately happen before using `validate --strict`.

## Truth rules

- A dirty Git worktree produces `PARTIAL`; filenames are not copied into the public-safe manifest.
- A failed locked install, typecheck, contract suite, lint or build produces `FAIL`.
- Missing OpenSpec produces `PARTIAL` and an explicit `NOT_RUN`; it is never inferred as passing.
- A present OpenSpec whose strict validation fails produces `FAIL`.
- The receipt is bound to the exact Git SHA and package-lock SHA-256.
- Logs contain only outputs of the listed repository/tooling commands. Do not add credential-bearing commands such as access-token printing to this baseline runner.

The generated `baseline.json` is a repository baseline receipt only. Even a green result does not promote a provider, DBC, Harbor result or production capability. Real-provider evidence remains separate.
