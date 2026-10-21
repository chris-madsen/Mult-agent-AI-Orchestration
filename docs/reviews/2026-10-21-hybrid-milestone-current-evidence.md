# ACE Hybrid milestone — current evidence

This is the current evidence ledger for the Hybrid milestone. It supplements
historical review documents and does not rewrite their observations.

## Baseline and delivered PRs

- Current merged `main`: `acb2630e9c49d56b5c8a224e900fd4999fd91358`.
- PR A #124 merge `b02aa9aaa3058cec921716bbde68e144bfee1e2`: delivery metrics now separate initial, new, reused, projection-avoided, exact in-bundle duplicate and unique content bytes.
- PR B #125 merge `8917b2461ebf967f8e6d30e9a2bfba3a7fe8a17f`: versioned workspace-scoped per-evidence receipts are portable without server memory; legacy evidence IDs remain exact-bundle-only.
- PR C #126 merge `acb2630e9c49d56b5c8a224e900fd4999fd91358`: durable JSONL benchmark traces, flush/close failure propagation, terminal sidecars and explicit stage statuses.
- PR D #127 merge `3dfed00e410c18f2f546235f68dc74781e6278cb`: receipt portability contract across two actual Node processes.

## Evidence-stage status

| Area | implemented | real-provider-tested | agent-E2E-tested | benchmark-evaluated | owner-approved |
|---|---:|---:|---:|---:|---:|
| H4 receipt/delta delivery | yes | no | no | no | no |
| H5 source-aware delivery dedupe | yes | no | no | no | no |
| Durable retrieval trace boundary | yes | no | no | no | no |
| Frozen multi-repository holdout | yes | n/a | n/a | not scored | no |
| Five-strategy retrieval ablation | not run | no | no | no | no |
| CPU reranker selection | not run | no | no | no | no |
| Four-arm Harbor benchmark | not run | no | no | no | no |

H4/H5 correctness evidence is contract-level. It is not a real-provider or
agent-E2E production approval.

## External frozen holdout

The holdout is outside the ACE checkout at
`D:\ace-external\h6-retrieval-2026-10-21`:

- source specification SHA-256: `11cfd53a525d806fb732465ea3a841d6f8a2b8a7d1c8bac110b24fa13d39f084`;
- holdout SHA-256: `ecc443b7893220df274c191109b7c0d7234327e003a0a7cd0115317fa7c83fe3`;
- ACE revision: `acb2630e9c49d56b5c8a224e900fd4999fd91358`;
- Chess revision: `23a7bb6b27023e8520941841d69745dd623d0933`;
- ACE manifest SHA-256: `69dee4eaffb637054fc72270874518960ae676c5b02029ed56108aa88af0aac4`;
- Chess manifest SHA-256: `1916646de6dfb53449560a554c2cf0a6cfd22b4fa63c4af1bfb265f00eaf461e`;
- 24 cases: 12 per repository, with critical, multilingual, working-context, compactness and partial-coverage cases.

`npm run validate:retrieval-holdout` passed against this external artifact.
No source, task, manifest or scored run from Chess is stored in ACE.

## Current blockers

`npm run probe:providers` and `harbor --version` were checked on 2026-10-21.
The execution host lacks ast-grep, TypeScript Language Server, Qdrant at
`127.0.0.1:6333`, Harbor/Codex runtimes, required Python modules and
`kubectl`. Therefore retrieval ablation, reranker evaluation and Harbor
four-arm runs are `NOT_RUN`/`BLOCKED`, not successful fixture runs.

External readiness evidence is retained outside ACE in
`provider-readiness-2026-10-21.json` beside the frozen holdout.

## Remaining gates

1. provision and verify the pinned real providers and runtime identities;
2. run all five retrieval strategies on the immutable holdout with raw traces and terminal receipts;
3. run the separate reranker holdout and approve or reject a concrete model identity;
4. run the four-arm natural-use Harbor benchmark with real ACE calls and observed receipt reuse;
5. publish quality, latency, context-byte and measured/unknown cost fields;
6. continue the separate Graphiti, Vertex, k3s, backup/restore, supply-chain and owner-release tracks.

No production-ready or 5× savings claim is made by this document.
