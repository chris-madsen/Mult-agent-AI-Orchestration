# ACE code-correction follow-up — work remaining after first repair slice

**Date:** 2026-10-19 · **Status:** implementation PR under review; no production readiness or 5× claim.

This document tracks gaps against `docs/reviews/2026-10-18-architecture-failure-review.md` and DBC-01…DBC-14. It must **not** be treated as test evidence.

| Original finding | Implementation in this PR | Release status |
|---|---|---|
| Regex + whole-file symbol candidates | Local index uses real TypeScript Compiler API AST spans, optional external Tree-sitter; no duplicate full-file-per-symbol entries | **Partial.** Qdrant+real embeddings+approved LSP remain disconnected from active runtime |
| SHA-256 pseudo embeddings | Legacy deterministic `local_sha256_projection_v1` remains an isolated spike / fixture only; bootstrap reports NOT_READY by default | **Open.** Genuine embedding provider selection and measured holdout required |
| Custom MCP JSON-RPC transport | Existing transport is unchanged for compatibility | **Open / blocking.** Official MCP SDK integration and client conformance still needed |
| LSP `isDefinition` using write access | Maps TypeScript reference definition flag directly and adds declaration-vs-write regression | **Implemented, pending CI** |
| Archive ID re-created on append | Episode identity derives from workspace, source path, record start offset and record digest, not whole-file digest | **Implemented, pending CI** |
| Shared content deleted for other episodes | Archive serializes same-process mutations, tombstones before deleting metadata, checks remaining references before removing shared blob, re-verifies digests | **Partial.** Cross-process locking and Graphiti derived-projection purge must be designed/tested |
| `complete=true` despite warning/failure | Merge considers warnings and failed required sources; fallback result always remains incomplete | **Implemented, pending CI** |
| Harbor lacks agent/RAG attribution | Existing reports left intact; neither forced TODO smoke nor zero ACE calls is labeled 5× proof | **Open.** DBC-12 realistic paired retrieval-demanding test needed |
| Full snapshot/hash on each query | Local degraded search ranks then performs exact reads of selected paths, not full workspace snapshot on every MCP request | **Implemented, pending CI and latency measurement** |
| No production E2E proof | Bootstrap now defaults to typed `NOT_READY` unless `ACE_ALLOW_LOCAL_FALLBACK=true`; test exercises executable boundary | **Partial.** Real provider wiring/SDK/agent E2E still blocking |

## Manual environment notes

- `ACE_ALLOW_LOCAL_FALLBACK=true`: explicitly enable degraded local lexical retrieval. This is **not** production Qdrant semantic search and resulting bundle is `complete=false`.
- `ACE_TREE_SITTER_HELPER=/absolute/path/to/scripts/tree-sitter-structural.py`: opt in to the existing Tree-sitter provider during local indexing (needs Python Tree-sitter dependencies).
- Without the fallback flag, `ace_context` must yield `NOT_READY`, rather than pretend the selected retrieval path exists.
- `ace_expand` remains an exact artifact transport; the context provider must still attach authorized full-source artifact handles before DBC-08 integration is accepted.

## Verification needed before merging or promoting any readiness

Run `npm ci && npm run check && npm test && npm run lint && npm run build` in CI. Run OpenSpec validation, real Qdrant+embedding+Tree-sitter+LSP integration, MCP SDK conformance, memory race tests and agent Harbor holdout **in the actual configured environment**. No unchecked item in OpenSpec 006 should be marked passed without traces and owner approval.

**Risk register:** AST spans in TypeScript compiler fallback are not a substitute for the selected Tree-sitter/ast-grep architecture. File archive locking is process-local only. Persistent Qdrant collection freshness and incremental indexing remain open. These are deliberate disclosure of gaps rather than concealed fallbacks.
