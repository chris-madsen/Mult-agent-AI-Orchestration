# Retrieval Remaining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the implementable R4, R2, R3, R5 and R6 retrieval gaps on current `main` by reusing the repository's existing provider-native implementations, while leaving external acceptance evidence explicitly blocked until it is freshly retained.

**Architecture:** Reuse the official Qdrant SDK and stable-collection publication already present in the remote safety branch; reuse ast-grep's existing CLI/NAPI parse records; reuse the pinned Aider-derived RepoMap, Claw-shaped LSP registry over `vscode-jsonrpc`, and the existing ContextAssembler composition. Do not introduce a second transport, parser, graph algorithm, tokenizer, worker pool, or benchmark framework.

**Tech Stack:** TypeScript, Effect, `@qdrant/js-client-rest`, `@ast-grep/napi`, ast-grep CLI, `vscode-jsonrpc`, Zod, Node test runner, existing real-provider runners.

**Spec:** `docs/plans/2026-10-26-retrieval-post-177-execution-plan.md` plus the owner's updated remaining-plan instructions in the implementation request.

## Global Constraints

- Current verified source bytes outrank derived index/RepoMap/LSP payloads.
- Provider failures remain typed `unavailable`/`stale`/`not_ready` and never become successful empty results.
- Qdrant publication must preserve last-known-good state under incomplete writes, crash and stale cleanup.
- Structural records are produced by ast-grep and are shared by Qdrant and RepoMap.
- LSP process identity is independent from source generation; refresh/query remains bounded and serialized by the existing lifecycle.
- `ace_expand` remains lossless; context packing may estimate tokens but must not claim an exact limit without a matching tokenizer.
- Real-provider, Harbor and Hermes evidence is never promoted from mock-only or historical observations.

## Review Focus

- Partial changed-path indexing must not prune the last-good Qdrant version; test the existing real-pipeline failure cases.
- A reused structural record with a changed path or digest must be rejected; test the existing index-state cases.
- RepoMap must not invent edges from unresolved identifiers or stale source digests; test structural and retrieval contracts.
- LSP registry shutdown and delayed lease release must close a process exactly once; test registry contracts.
- Context assembly must distinguish duplicate suppression from budget omission and preserve exact expansion handles; test assembler contracts.

---

### Task 1: Reuse the stable Qdrant safety implementation

**Files:**
- Reuse reviewed commits from `origin/codex/aider-claw-retrieval-composition` touching `src/adapters/qdrant-context-provider.ts`, `src/bin/ace-mcp.ts`, `src/application/workspace-sync.ts`, and existing Qdrant runners/tests.
- Test: `test/qdrant-real-pipeline.contracts.test.ts`, `test/workspace-sync.contracts.test.ts`, `test/qdrant-crash-runner.contracts.test.ts`.

**Interfaces:**
- Consumes the current official Qdrant SDK adapter and `WorkspaceSync` ports.
- Produces stable changed-path publication with last-good preservation, physical cleanup verification, bounded stale-hit retry, and preflight before destructive mutation.

- [ ] Verify each selected upstream commit is based on the current provider contracts.
- [ ] Apply the smallest compatible commit set; resolve conflicts in favor of current `main` contracts and record any ruling.
- [ ] Run the focused Qdrant/workspace contract tests and the affected selector.

### Task 2: Complete shared ast-grep structural provenance

**Files:**
- Reuse the existing shared-record changes from `origin/codex/retrieval-real-remaining` and parity closure from `origin/codex/retrieval-next-phases` in `src/adapters/ast-grep-napi.ts`, `src/adapters/local-code-index.ts`, `src/domain/semantic.ts`, and parity tests.

**Interfaces:**
- Consumes the current ast-grep CLI/NAPI structural ports.
- Produces digest/path-bound identifier records from the same parse used for indexing, with explicit parity limits and no NAPI default promotion.

- [ ] Verify the NAPI/CLI fixture and source-byte range tests fail before the selected implementation commits.
- [ ] Apply the existing implementation commits without adding a new parser.
- [ ] Run AST parity, NAPI and index-state contract tests.

### Task 3: Compose Aider RepoMap, Claw-shaped LSP lifecycle and ContextAssembler

**Files:**
- Reuse `origin/codex/retrieval-next-phases` changes in `src/adapters/repo-map-structural.ts`, `src/application/lsp/server-registry.ts`, `src/application/context-assembler.ts`, `src/domain/context-assembly.ts`, `src/adapters/lsp-semantic.ts`, `src/application/context-transform-service.ts`, `src/bin/ace-mcp.ts`, and their contract tests.

**Interfaces:**
- Consumes shared structural records, official `vscode-jsonrpc`, existing RepoMap domain ranking, and the existing transform service.
- Produces one runtime composition root: Qdrant candidates first, RepoMap structural prior, optional bounded LSP enrichment, and one final assembler with truthful omissions/partial status.

- [ ] Apply the focused composition and correctness commits in dependency order.
- [ ] Run RepoMap, registry, semantic snapshot and assembler contract tests.
- [ ] Run typecheck and lint after resolving any current-main integration differences.

### Task 4: Reconcile current-head evidence

**Files:**
- Modify only the relevant readiness/evidence document if the newly verified command results change the recorded status.
- Test/verify: `npm run verify:pr`, `openspec validate --all --strict --no-interactive --report full`, applicable real-provider scripts.

**Interfaces:**
- Consumes the exact source SHA and retained artifacts from Tasks 1–3.
- Produces an honest evidence record; no historical `9512` artifact is relabeled as current PASS.

- [ ] Run deterministic verification on the exact branch head.
- [ ] Run available real-provider gates; record unavailable Qdrant/LSP/Harbor/Hermes services as `BLOCKED` or `NOT_RUN`.
- [ ] Keep R8 owner approval and matched native-vs-ACE evidence open unless raw current-head artifacts exist.

## Definition of Done

- The selected implementation commits are present on this branch with no duplicate provider implementation.
- Focused tests, typecheck and lint results are retained in the ledger; baseline failures remain distinguishable from regressions.
- No production-readiness, token-savings, Harbor or Hermes acceptance claim is promoted without current raw evidence.
- The branch is pushed and delivered through a PR targeting `main` before work is reported complete.
