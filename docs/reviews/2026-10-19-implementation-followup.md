# ACE code-correction follow-up — work remaining after first repair slice

**Date:** 2026-10-19 · **Status:** implementation PR under review; no production readiness or 5× claim.

This document tracks gaps against `docs/reviews/2026-10-18-architecture-failure-review.md` and DBC-01…DBC-14. It must **not** be treated as test evidence.

| Original finding | Implementation in this PR | Release status |
|---|---|---|
| Regex + whole-file symbol candidates | Local index uses real TypeScript Compiler API AST spans, optional external Tree-sitter; no duplicate full-file-per-symbol entries | **Partial.** Real exploratory Qdrant + Tree-sitter + TypeScript-LS composition is now wired; 2000-line and dirty-worktree gates remain |
| SHA-256 pseudo embeddings | Legacy deterministic `local_sha256_projection_v1` remains an isolated spike / fixture only; real FastEmbed/ONNX is an explicit experimental candidate | **Partial.** Candidate is measured and wired; production model selection and holdout approval remain open |
| Custom MCP JSON-RPC transport | Official MCP SDK v2 is wired into the executable; the legacy transport remains isolated for compatibility tests | **Partial.** Official client conformance is still needed |
| LSP `isDefinition` using write access | Maps TypeScript reference definition flag directly and adds declaration-vs-write regression | **Implemented, local CI passes** |
| Archive ID re-created on append | Episode identity derives from workspace, source path, record start offset and record digest, not whole-file digest | **Implemented, local CI passes** |
| Shared content deleted for other episodes | Archive serializes same-process mutations, tombstones before deleting metadata, checks remaining references before removing shared blob, re-verifies digests | **Partial.** Cross-process locking and Graphiti derived-projection purge must be designed/tested |
| `complete=true` despite warning/failure | Merge considers warnings and failed required sources; fallback result always remains incomplete | **Implemented, local CI passes** |
| Harbor lacks agent/RAG attribution | Existing reports left intact; neither forced TODO smoke nor zero ACE calls is labeled 5× proof | **Open.** DBC-12 realistic paired retrieval-demanding test needed |
| Full snapshot/hash on each query | Local degraded search ranks then performs exact reads of selected paths, not full workspace snapshot on every MCP request | **Implemented, latency measurement open** |
| No production E2E proof | Bootstrap now has a real experimental Qdrant/FastEmbed/Tree-sitter/TypeScript-LS path and official SDK E2E evidence | **Partial.** Production approval, larger DBC fixtures, agent E2E and Harbor remain blocking |

## Manual environment notes

- `ACE_ALLOW_LOCAL_FALLBACK=true`: explicitly enable degraded local lexical retrieval. This is **not** production Qdrant semantic search and resulting bundle is `complete=false`.
- `ACE_ENABLE_EXPERIMENTAL_QDRANT=true`: enable the real local Qdrant/FastEmbed/Tree-sitter/TypeScript-LS path; it never silently falls back to lexical or SHA-256 retrieval.
- `ACE_TREE_SITTER_HELPER=/absolute/path/to/scripts/tree-sitter-structural.py`: override the Tree-sitter helper during local indexing (needs Python Tree-sitter dependencies).
- Without the fallback flag, `ace_context` must yield `NOT_READY`, rather than pretend the selected retrieval path exists.
- `ace_expand` remains an exact artifact transport; the context provider must still attach authorized full-source artifact handles before DBC-08 integration is accepted.

## Verification needed before merging or promoting any readiness

Run `npm ci && npm run check && npm test && npm run lint && npm run build` in CI. The exploratory real Qdrant+embedding+Tree-sitter+LSP integration and MCP SDK E2E are now evidenced; still run the 2000-line, race, conformance and agent Harbor holdout **in the actual configured environment** before promotion. No unchecked item in OpenSpec 006 should be marked passed without traces and owner approval.

**Risk register:** AST spans in TypeScript compiler fallback are not a substitute for the selected Tree-sitter/ast-grep architecture. File archive locking is process-local only. Persistent Qdrant collection freshness and incremental indexing remain open. These are deliberate disclosure of gaps rather than concealed fallbacks.
