# Retrieval composition readiness

> Status: implementation branch only. This document records composition boundaries; it does not claim real-provider or production readiness.

## Selected composition

- Branch: `codex/aider-claw-retrieval-composition`
- Composition selector: `ACE_RETRIEVAL_COMPOSITION=legacy-hybrid|repo-map-qdrant-lsp-v2`
- Strategy selector: `ACE_RETRIEVAL_STRATEGY=dense|sparse|hybrid_rrf`; the replacement composition defaults to dense when the strategy is omitted.
- The replacement composition rejects `sparse` and `hybrid_rrf` overrides; dense is its only production retrieval strategy.
- Dense mode must not create or preflight the sparse embedding worker.
- Sparse and hybrid modes require a verified sparse provider.
- Unknown retrieval strategies fail closed.

## Pinned vendor dependencies

- `@qdrant/js-client-rest@1.20.0`, Apache-2.0: used by the ACE adapter for code-candidate operations and collection/alias lifecycle when a client is supplied; HTTP remains an explicit compatibility boundary.
- `@ast-grep/napi@0.51.0`, MIT: used for supported grammars in replacement `auto` mode; CLI remains an explicit fallback for languages without registered NAPI coverage.
- `vscode-jsonrpc@9.0.3`: existing dependency used by the current LSP adapter; new work must not reimplement JSON-RPC framing or response matching.

## Implemented branch slices

- Local index candidate construction is batched once per workspace snapshot; file manifests retain size, parser identity and scope identity for reuse checks.
- The official Qdrant SDK is used for provider query/upsert operations when the runtime composition supplies a client; the existing HTTP boundary remains only for compatibility/lifecycle paths until their migration gate passes.
- `@ast-grep/napi` is used by the replacement composition for supported grammars; `auto` keeps an explicit CLI fallback for languages outside its registered grammar set. No unsupported language is silently treated as NAPI-parsed.
- RepoMap ranking is deterministic, token-budgeted and source-digest-preserving; it runs after provider retrieval and before working-context/reranker stages.
- LSP lifecycle now has workspace-scoped registry reference counting and explicit `didOpen`/`didChange`/`didClose` actions over the existing `vscode-jsonrpc` transport.
- `bench:retrieval-composition` emits four required arms (`native`, `current-ace`, `repomap-only`, `new-composition`) and fails closed when external native/RepoMap-only artifacts are missing.

## Evidence rules

A provider may be marked `ready` only after its identity, runtime/configuration and source snapshot binding are verified. Missing providers, timeouts, malformed responses and unavailable external services remain `NOT_READY`/`BLOCKED`; they are not converted to empty successful retrieval.

Raw provider and benchmark artifacts remain outside the checkout. Any future adaptation of Aider/Claw code must retain the source revision, license/attribution notice and the exact adapted files in the evidence manifest.

## Current blockers

- Same-name TypeScript LSP conformance passed with `ast-grep 0.51.0 + typescript-language-server 6.0.2` at the current commit, but the full semantic retrieval run ended with `Connection closed` and produced no valid retrieval artifact.
- Non-TypeScript LSP conformance is blocked because the configured `rust-analyzer` binary is unavailable in the official toolchain.
- Qdrant concurrency/crash and index-scale runs are blocked by the current foundation runtime returning `unified_context` `NOT_READY`; the Qdrant publication path also observed `Internal Server Error`.
- The compiled runtime was rebuilt from commit `82732c4` with `sourceCleanAtBuild: true`; remaining frozen-run blockers are provider/runtime availability, not source provenance.
- The four-arm benchmark remains `BLOCKED` until native and RepoMap-only normalized artifacts are supplied; no token-savings or production claim is made from the composition wrapper.
