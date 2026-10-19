# Real-provider E2E — Qdrant + FastEmbed + Tree-sitter + TypeScript LS

**Date:** 2026-10-19
**Status:** exploratory real-provider evidence; not production approval.
**Scope:** read-only MCP retrieval paths on synthetic 2000-line TypeScript and
two-file fixtures.

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

The first fixture contained `service.ts` (`reconnect`, `disconnect`) and
`consumer.ts` (`boot` calling `reconnect`). A second fixture contained exactly
2000 source lines and a 25-line `retryAfterTransientFailure` function. The
runtime populated the versioned collection
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

The automated 2000-line gate returned `service.ts:1-25`,
`freshness=current`, with the target function content only. `ace_expand`
reassembled all 63,482 source bytes and matched the fixture SHA-256
`49ee6a02de93468eb1d88a8de10f0fa2eb21a186db33362c01f8c30f7e41b152`.
`ace_workspace_status` returned `index_status=ready`.

The race gate delayed the query embedding, edited the file from D1 to D2 while
retrieval was in flight, and observed `complete=false`, `partialSources=["code"]`
and `stale index or AST slice disagrees with current original bytes`. No stale
evidence was labelled `current`.

The restart gate reused one workspace/state directory across two MCP processes.
The first run used generation 1 and D1; after a dirty-tree edit, the second run
used generation 2 and returned only D2. Its versioned collection was `_g2`, so
the old generation was not silently upgraded or queried as current.

The outage gate forced Qdrant to an unavailable loopback port while enabling the
explicit `ACE_ALLOW_LOCAL_FALLBACK=true` test switch. The response was
`complete=false`, `partialSources=["code","qdrant"]`, retained current local
source evidence, and warnings including `Qdrant unavailable:
EXTERNAL_UNAVAILABLE` and the non-production status of the lexical fallback.
This proves truthful degradation, not production semantic retrieval.

The official SDK conformance gate used `@modelcontextprotocol/client` and
`StdioClientTransport` against the actual `ace-mcp` executable. It verified the
initialization handshake, the four-tool listing, concurrent workspace-status
calls, protocol-level unknown-tool failure, and request cancellation through a
linked official in-memory transport. No hand-written JSON-RPC path was used for
this production conformance check.

The policy gate exercised the Vertex adapter and the unified gateway composition
with the default local policy. `ace_context(include_docs=true)` returned a
partial bundle with `POLICY_DENIED`, while the counting HTTP port observed zero
outbound requests; the companion audit contract retained only safe reason and
correlation fields, never source or token payloads.

The DBC-14 composition fixture supplied an explicit ADR claim and current-code
claim under the same conflict key. The bundle retained both classifications,
source revisions and timestamps, emitted a structured conflict plus warning,
and set `complete=false`; no documentation claim was promoted to current code
truth.

The real semantic holdout gate (`npm run test:real-semantic`) exercised three
behavior/RU↔EN queries through FastEmbed/ONNX, Qdrant, Tree-sitter and the
TypeScript language service. All three expected candidates were surfaced
(recall@12=3/3); one read/write lexical distractor ranked first. This is
retrieval evidence, not a production model selection or quality/5× claim.

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

- A frozen retrieval-demanding holdout and Harbor paired agent run are not
  represented here; no token saving or 5× claim follows from this smoke.
- The runtime does not upload code to Vertex or any external embedding API.
