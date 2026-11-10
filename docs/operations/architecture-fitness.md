# Architecture fitness checks

ACE uses its existing pinned `@ast-grep/cli@0.51.0` for the first executable architecture-fitness pilot.

Normative source: `docs/research/sdlc/source/standards/Architecture Layers.md`.

## Current rules

### ARCH-FIT-001 — `ace-domain-no-infrastructure-import`

Production scope: `src/domain/`.

Reports static TypeScript imports from selected infrastructure/provider dependencies and ACE outward layers. The rule is intentionally narrow and does not claim that every possible architecture violation is statically detectable.

Repair hint: move I/O/vendor behavior behind an application port and concrete adapter/composition owner.

### ARCH-FIT-002 — `ace-application-no-outer-layer-import`

Production scope: `src/application/`.

Reports static imports from `adapters`, `transport`, `gateway`, or `bin`.

Repair hint: move the shared contract inward to domain/application ports and let composition inject the concrete implementation.

## Status

Both rules are currently **report-only** with severity `warning`.

Known baseline findings at introduction:

- `src/application/context-transform-service.ts` imports `../gateway/mcp-gateway.js`;
- `src/application/graphiti-lifecycle-gate.ts` imports `../adapters/file-memory-archive.js`.

These are architecture debt to review/fix separately. They are not silently grandfathered as correct, and they are not merge-blocking in this pilot.

## Commands

Production report:

```bash
npm run arch:fitness:scan
```

Fixture self-test is owned by the existing architecture regression portfolio:

```bash
node_modules/.bin/tsx --test test/architecture-regressions.test.ts
```

For each rule the self-test promotes that rule to `error` only for controlled fixtures:

- violating fixture must return exit code 1 and identify the stable rule ID;
- valid fixture must return 0;
- false-positive text fixture must return 0.

## Promotion to blocking

Do not change a rule from `warning` to `error` until:

1. bad/good/false-positive fixtures are green;
2. production findings are reviewed;
3. existing violations are repaired or explicitly owner-approved as a temporary baseline;
4. representative real PRs show low false-positive risk;
5. the owner approves the blocking transition.

The pilot does not change the SDLC or architecture authority.
