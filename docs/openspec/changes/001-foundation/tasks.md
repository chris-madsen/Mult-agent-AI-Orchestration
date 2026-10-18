# Implementation Tasks — Foundation: workspace truth, safety and MCP boundary

**State: PARTIALLY IMPLEMENTED.** Foundation contracts and local adapters are implemented;
production Kubernetes worktree access and owner review remain open.

## Architecture gate
- [x] Inspect installed Codex MCP interface and document exact version / supported tools (`codex-cli 0.148.0-alpha.9`; `list/get/add/remove/login/logout`; `codex exec --json` is available) and register the ACE JSON-RPC stdio transport.
- [x] SPIKE: evaluate secure Kubernetes-to-host working-tree access and race/symlink threats; select an authenticated host-helper protocol as the design outcome before any production mount. Production deployment remains intentionally absent.
- [x] Choose module runtime language and contract schemas through explicit design review (ADR-011; TypeScript + Effect Schema).
- [x] Connect static-analysis gates: Airbnb TypeScript linting plus Rust `rustfmt` and Clippy with warnings denied.

## DDD primitives
- [x] Define WorkspaceId, RepoPath, ContentDigest, WorkingTreeVersion, PolicyAction, AccessDecision as validated value types.
- [x] Implement Workspace aggregate and file observation port; HEAD + tracked/untracked/removed change awareness.
- [x] Implement revision-checked exact reads and path canonicalization with race detection.

## Policy and adapters
- [x] Implement versioned ProjectDataPolicy and safe denial/audit records.
- [x] Implement single MCP facade with `ace_context`, `ace_expand`, status/memory tools, JSON-RPC stdio transport and typed `not_ready` until subsequent providers are available.
- [x] Ensure no gateway tool can mutate user source tree.

## Verification
- [x] Unit/integration tests: workspace escapes, symlink escapes, concurrent write protection and stale digest.
- [x] Bertrand Meyer-style contract tests: explicit preconditions, postconditions, invariants, fail-closed boundaries and architecture contracts (`test/bertrand-contracts.test.ts`).
- [x] Foundation fault injection: denied cloud route, typed unavailable backend, audit sink failure and safe log redaction; provider-specific timeout integration remains deferred until provider changes.
- [x] Losslessness regression: 2000+ line content byte equality and no mandatory fixed token cap.
- [x] Smoke test container restart on existing local Kubernetes (not a new cluster); disposable pod ran twice on `xmg` and was removed after both `Running` checks (2026-10-18).

## Exit criteria

- [x] All foundation behavioral scenarios have executable test coverage or a documented controlled exception.
- [x] Foundation provider/security failure tests pass; no fabricated current source or success status.
- [x] Domain and adapter dependencies comply with module boundaries and accepted ADRs.
- [ ] Review the change with the owner; do not archive until completed and verified.
