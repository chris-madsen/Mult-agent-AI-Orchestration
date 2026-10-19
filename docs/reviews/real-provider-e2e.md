# Real-provider E2E — Qdrant + FastEmbed + Tree-sitter + TypeScript LS

**Date:** 2026-10-19
**Status:** exploratory real-provider evidence; not production approval.
**Scope:** one read-only MCP retrieval path on a synthetic two-file TypeScript fixture.

## Composition exercised

```text
Codex-shaped MCP client
  -> official @modelcontextprotocol/server stdio SDK
  -> ACE gateway / ace_context
  -> FastEmbed worker (ONNX Runtime, local process)
  -> Qdrant 1.19.2 in k3s
  -> Tree-sitter TypeScript 0.23.2
  -> TypeScript Language Service 5.9.3
  -> exact filesystem reread + SHA-256 verification
  -> ContextBundle + lossless artifact handles
```

The fixture contained `service.ts` (`reconnect`, `disconnect`) and
`consumer.ts` (`boot` calling `reconnect`). The runtime reported three
structural candidates and populated the versioned collection
`ace_code_paraphrase_multilingual_minilm_l12_v2_g1`.

## Provider evidence

| Provider | Actual evidence |
|---|---|
| Qdrant | `ace/ qdrant-0` Ready; HTTP collection creation and point upsert succeeded; collection vector size 384 / Cosine |
| FastEmbed | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, FastEmbed 0.7.4, ONNX Runtime 1.31.0; local worker returned 384 finite values |
| Tree-sitter | Python `tree-sitter` 0.26.0 + `tree-sitter-typescript` 0.23.2; returned symbol ranges used in candidates |
| TypeScript LS | Workspace TypeScript 5.9.3; definition lookup agreed with selected structural nodes |
| MCP | Official SDK answered `initialize` and `tools/call`; no handwritten transport was used by the executable |

## Observed result

The real `ace_context` response contained three code evidence items:

- `service.ts:1-3`, `freshness=current`, `proofClass=direct`;
- `consumer.ts:2-4`, `freshness=current`, `proofClass=direct`;
- `service.ts:5-7`, `freshness=current`, `proofClass=direct`.

Every item carried a working-tree SHA-256 digest and an `expansionHandle`.
The bundle had no warnings, no partial sources and `complete=true`. The exact
source slice was checked against the current file bytes before delivery.

## Reproduction

The local k3s service is ClusterIP, so host-side tests use an explicit,
loopback-only forward:

```bash
kubectl -n ace port-forward svc/qdrant 6333:6333
ACE_ENABLE_EXPERIMENTAL_QDRANT=true \
ACE_QDRANT_URL=http://127.0.0.1:6333 \
ACE_EMBEDDING_WORKER="$PWD/scripts/fastembed-worker.sh" \
ACE_TREE_SITTER_HELPER="$PWD/scripts/tree-sitter-structural.py" \
ACE_TREE_SITTER_PYTHON="$PWD/.venv-system/bin/python" \
ACE_WORKSPACE_ROOT=/path/to/fixture \
npm run mcp:stdio
```

`ACE_ENABLE_EXPERIMENTAL_QDRANT` deliberately names this path experimental:
the model/runtime and LSP choice still require owner selection after the larger
holdout and Serena comparison. The SHA-256 projection remains fixture-only and
is not used by this path.

## Remaining gates

- 2000+ line exact-span/expansion and mid-request edit scenarios are not yet
  covered by this small fixture.
- A frozen retrieval-demanding holdout and Harbor paired agent run are not
  represented here; no token saving or 5× claim follows from this smoke.
- The runtime does not upload code to Vertex or any external embedding API.
