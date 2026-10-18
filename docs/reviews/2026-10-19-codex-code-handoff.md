# Codex handoff — make the actual ACE retrieval pipeline compile and pass contracts

**Date:** 2026-10-19 · **PR:** #2 · **Status:** implementation review pending · **Scope:** Codex finishes mechanical verification, tests, type fixes and provider E2E. Do **not** rewrite the architecture or replace real components with test doubles to turn CI green.

## What this branch actually implements

1. The production MCP executable now uses the official TypeScript SDK v2 `@modelcontextprotocol/server`. Legacy hand-written transport is retained for existing contract tests but is **not** wired into the executable.
2. The Qdrant/AST/LSP composition remains an application-level port pipeline, but the executable does **not** select an embedding provider. Until the owner approves a provider after a measured spike, `ACE_ENABLE_EXPERIMENTAL_QDRANT=true` returns `NOT_READY` rather than wiring an arbitrary model or pretending that Qdrant is production-ready.
3. The ordinary runtime has no silent "fake semantic retrieval": if none of the explicitly configured sources are ready, `ace_context` responds `NOT_READY`; `ACE_ALLOW_LOCAL_FALLBACK=true` opts into labelled, incomplete, AST-aware lexical search.
4. Selected path checks avoid rehashing the entire workspace per request; indexing remains full at **startup**.
5. LSP references distinguish actual declarations from writes; session IDs remain stable across append; archive deletion preserves shared blobs with single-process serialization.

## Reproducible execution

Use Node 22+, TypeScript 5.9, `npm ci`. The official MCP server SDK v2 `2.3.1` requires compatible Zod 4.2+; this repository pins `zod@4.6.7` to match the SDK dependency. Ensure `package-lock.json` matches. Install pinned Python Tree-sitter and TypeScript grammars.

Set `ACE_WORKSPACE_ROOT` to an allowed source repo, plus the explicit degraded fallback only when that is what you intend:

```bash
ACE_ALLOW_LOCAL_FALLBACK=true
ACE_TREE_SITTER_HELPER=/absolute/path/to/scripts/tree-sitter-structural.py
ACE_PYTHON_COMMAND=/absolute/path/to/python
```

No embedding provider is currently selected or approved. Do not add provider URLs, model names or credentials to the executable until the owner approves the provider, privacy policy, license/version pin and measured retrieval spike.

## Immediate Codex tasks — in order, strict gate

- [ ] `npm ci && npm run check && npm test && npm run lint && npm run build`; fix **actual** TypeScript SDK v2 and Zod typing and runtime conformance; do not add `any` / `ts-ignore` to conceal mistakes.
- [ ] Add/repair agent-level official MCP initialize, tools/list, tools/call, errors/cancellation tests. Replace any test that directly expects custom JSON-RPC behavior **from production**.
- [ ] Approved real embeddings + Qdrant + Python Tree-sitter + TypeScript LS smoke on a 2000-line fixture; ensure 25-line symbol stays precise, full source expansion bytes match, and separate same-name symbols are not conflated.
- [ ] Test restart and active-generation filtering; removed or renamed file must not reappear from stale Qdrant payload. Clean old generations safely or document storage growth until controlled pruning exists.
- [ ] Test file modification during Qdrant/LSP calls; stale evidence must not be labelled current. Verify Qdrant payload text and AST byte-range are not trusted without re-slicing exact local bytes.
- [ ] Test security: zero non-loopback embeddings/queries, rejected workspace ID, secret path exclusions, Qdrant payload claiming another workspace; ensure no prohibited outbound code upload.
- [ ] Test memory archive cross-process writers/deletes and Graphiti projection purges; current locking is only per-process and derived-projection lifecycle is not closed.
- [ ] Revisit docs and temporal memory production adapters (Vertex and Graphiti) against **actual** provider APIs; earlier generic HTTP adapter contracts do not prove those external services are integrated.
- [ ] Create a Harbor paired benchmark suite with **actual ACE MCP calls**, realistic retrieval-heavy tasks, consistent pinned configs, attribution of total tokens/provider costs and correctness. No 5× claim until measured.

## Specific boundaries not to violate

- Never replace an approved embedding provider with SHA-256 pseudo-vectors or Qdrant with lexical search without an explicit `degraded` result.
- Never treat a checked `[x]` adapter task or green fake-provider unit test as DBC-01/02/03 production proof. OpenSpec 006 acceptance items remain unchecked until real evidence.
- Preserve source bytes; no mandatory arbitrary context budget/truncation, with exact `ace_expand` round-trip.
- Do not introduce extra microservices, custom parsers, rewritten MCP transport, or new architecture frameworks.
- Keep this PR draft until full CI and owner architecture review. `main` must not be changed by this workflow.

## Known delivery boundaries / limitations

This branch supplies main implementation, **not** production verification. The real provider E2E requires services unavailable to the GitHub connector alone. Qdrant currently repopulates at startup, TS language service uses a generation-specific in-memory snapshot, and Graphiti/Vertex integration and true Harbor performance evaluation are still pending. These must remain visible blockers rather than euphemistically closed tasks.
