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

The same composition was also exercised in a Docker container through the
official `@modelcontextprotocol/client` stdio transport. The passing command was
`npm run test:container-provider`: the container used the real FastEmbed worker,
Qdrant at the local k3s port-forward gateway, Tree-sitter and TypeScript LS;
the result was `complete=true`, four current evidence items and zero warnings.
The container keeps stdin open for the official stdio transport and does not
use an API key or a local lexical fallback.

The first fixture contained `service.ts` (`reconnect`, `disconnect`) and
`consumer.ts` (`boot` calling `reconnect`). A second fixture contained exactly
2000 source lines and a 25-line `retryAfterTransientFailure` function. The
runtime uses a stable workspace+model-version collection and isolates each
source snapshot with an opaque `index_key`; observation `generation` remains in
the point payload for lifecycle evidence. This prevents equal observation
epochs from mixing changed source snapshots.

## Provider evidence

| Provider | Actual evidence |
|---|---|
| Qdrant | `ace/ qdrant-0` Ready; HTTP collection creation and point upsert succeeded; collection vector size 384 / Cosine |
| FastEmbed | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, FastEmbed 0.7.4, ONNX Runtime 1.31.0; local worker returned 384 finite values |
| Tree-sitter | Python `tree-sitter` 0.26.0 + `tree-sitter-typescript` 0.23.2; returned symbol ranges used in candidates |
| TypeScript LS | Workspace TypeScript 5.9.3; definition lookup agreed with selected structural nodes |
| MCP | Official SDK answered `initialize` and `tools/call`; no handwritten transport was used by the executable |

## Observed result

The small real `ace_context` response contained three code evidence items:

- `service.ts:1-3`, `freshness=current`, `proofClass=direct`;
- `consumer.ts:2-4`, `freshness=current`, `proofClass=direct`;
- `service.ts:5-7`, `freshness=current`, `proofClass=direct`.

Every item carried a working-tree SHA-256 digest and an `expansionHandle`.
The bundle had no warnings, no partial sources and `complete=true`. The exact
source slice was checked against the current file bytes before delivery.

The automated 2000-line gate then returned `service.ts:1-25`,
`freshness=current`, with the target function content only. `ace_expand`
reassembled all 63,482 source bytes and matched the fixture SHA-256
`49ee6a02de93468eb1d88a8de10f0fa2eb21a186db33362c01f8c30f7e41b152`.
`ace_workspace_status` returned `index_status=ready`.

The race gate delayed the query embedding, edited the file from D1 to D2 while
retrieval was in flight, and observed `complete=false`, `partialSources=["code"]`
and `stale index or AST slice disagrees with current original bytes`. No stale
evidence was labelled `current`.

The restart gate reuses one workspace/state directory across two MCP processes. The collection name is stable for the workspace+embedding configuration; points carry the observation generation. After a dirty-tree edit, generation 2 is indexed and the obsolete generation 1 points are pruned after successful rebuild. Query filtering still requires the current generation.

The outage gate forced Qdrant to an unavailable loopback port with
`ACE_ALLOW_LOCAL_FALLBACK=false`. The executable returned the honest
`NOT_READY` provider failure rather than pretending to have semantic retrieval.
The race gate separately proves stale/partial behavior, so configured-path
success and unavailable-provider failure remain distinct.

The official SDK client used `@modelcontextprotocol/client` and
`StdioClientTransport` against the actual `ace-mcp` executable. It verifies
initialization, tool listing/calls, errors, concurrency and cancellation
propagation into the underlying Effect. The Harbor ACE arm additionally proves
actual Codex→MCP→ACE invocation: 9/9 successful calls, current source evidence
and provider receipts in all nine trials.

The policy gate exercised the Vertex adapter and the unified gateway composition
with the default local policy. `ace_context(include_docs=true)` returned a
partial bundle with `POLICY_DENIED`, while the counting HTTP port observed zero
outbound requests; the companion audit contract retained only safe reason and
correlation fields, never source or token payloads.

The documentation-conflict **logic sub-gate** supplies a test DocumentationPort claim and a current-code claim under the same conflict key. It proves preservation and conflict marking, but **does not close DBC-14** until real approved Vertex documentation with citation/revision evidence conflicts with current code.

The real semantic holdout gate (`npm run test:real-semantic`) exercised three
behavior/RU↔EN queries through FastEmbed/ONNX, Qdrant, Tree-sitter and the
TypeScript language service. All three expected candidates were surfaced within the bounded response cap; one distractor ranked first. The response cap is now six candidates by default (`ACE_CONTEXT_CANDIDATE_LIMIT`). This is experimental retrieval evidence, **not DBC-03 closure**, production model selection or a quality/5× claim.

## Fresh paired Harbor evidence

The final serial run used three tasks (`semantic retry`, `cloud-policy impact`,
`shared archive impact`) with three repetitions per arm. Native and ACE each
completed 9/9 trials with reward 1.0. The strict gate verified 9 ACE calls, 9
current-source calls and all four required successful providers per ACE trial.
The native arm used 891,950 raw total tokens and cost `$0.0569132`; ACE used
1,571,768 raw total tokens and cost `$0.08538924`. The resulting savings factor
is `0.567482x`, cost factor `0.666515x`, and `target5xReached=false`.

This is a valid attribution-aware measurement, not evidence of token savings.
The raw Harbor jobs remain under the local `artifacts/` evidence directory and
the machine-readable gate is
`benchmarks/reports/ace-retrieval-paired-3x3-final-indexkey.json`.

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

- The current Harbor run is exploratory rather than a frozen production
  holdout; its measurement is retained and is negative on tokens/cost.
- The runtime does not upload code to Vertex or any external embedding API.
- The same-name semantic gate passes via `npm run test:real-same-name`; DBC-04
  is exercised, but direct TypeScript LS is not yet owner-approved as the final
  semantic provider.
