# ACE Hybrid milestone — H6 evidence after PR #133

This is a new current evidence ledger for the H6 work after the provider-probe,
generic retrieval-runner, reranker-evaluation and Harbor-job changes. It does
not rewrite the historical review documents or the previous holdout ledger.

## Scope and source revisions

The source repositories used by the external evidence artifacts are:

- ACE: `b20646c966575e8280ea792e4f851ab1e28ec867`;
- Chess: `23a7bb6b27023e8520941841d69745dd623d0933`.

Chess remains an external checkout. No Chess source, task, manifest or scored
artifact is stored in the ACE repository.

The implementation is split into reviewable PRs targeting `main`:

- PR #130 — cross-platform provider readiness probe;
- PR #131 — generic frozen retrieval runner, stage telemetry and ablation gate;
- PR #132 — external reranker holdout and selection gate;
- PR #133 — external four-arm Harbor job freezer and evidence binding.

The PRs are pending review/merge at the time of this ledger. Evidence produced
from them is therefore evidence for the pinned source/runtime configuration,
not a claim that `main` already contains all four changes.

## Evidence-stage status

| Area | implemented | real-provider-tested | agent-E2E-tested | benchmark-evaluated | owner-approved |
|---|---:|---:|---:|---:|---:|
| H4 receipt/delta delivery | yes | no | no | no | no |
| H5 source-aware delivery dedupe | yes | no | no | no | no |
| Cross-platform provider probe | yes | partially | no | no | no |
| Frozen multi-repository holdout v3 | yes | n/a | n/a | not fully scored | no |
| Five-strategy retrieval ablation | yes (runner/gate) | one diagnostic strategy | no | no | no |
| CPU reranker evaluation | yes | yes | no | yes | rejected; no model approved |
| Four-arm Harbor job bundle | yes (frozen) | no | no | no | no |
| Production track | separate | incomplete | incomplete | incomplete | no |

`implemented` means code or an external artifact exists. It does not imply
real-provider, agent-E2E, benchmark or owner approval.

## Frozen retrieval holdout v3

The prior external holdout at
`D:\ace-external\h6-retrieval-2026-10-21` remains unchanged. The current v3
artifact is external at
`D:\ace-external\h6-retrieval-2026-10-21-v3`.

- status: `frozen_multi_repository_holdout`;
- source specification SHA-256:
  `6d8e1c5f4ee4fbc0f79ff2bc6e263afbdcc56f138f3d978831c287da8bcc83df`;
- holdout SHA-256:
  `6ff04ba621b5d60e68ce49dd6e0ae5d78e772e72b02dafa72154e03c30761055`;
- ACE manifest SHA-256:
  `b13bb0d93cbd6c2bcceb067061d418a463dcdcd360b8d2e55efcf31ab57c7571`;
- Chess manifest SHA-256:
  `1916646de6dfb53449560a554c2cf0a6cfd22b4fa63c4af1bfb265f00eaf461e`;
- 24 cases: 12 ACE and 12 Chess, with at least two critical cases per
  repository.

The holdout validation passed. Its source revisions, labels, candidate IDs and
contents must remain unchanged after the first scored run.

## Retrieval evidence currently available

The generic runner performs real MCP calls through the existing
`ace_workspace_status` and `ace_context` surface and records raw/runtime IDs,
canonical IDs, stage ranks, byte metrics, provider identities and terminal
receipts. It does not add an MCP tool.

A real-provider dense diagnostic run on v3 produced the following non-release
result:

- Recall@1: `0.0416666667`;
- Recall@3: `0.2916666667`;
- Recall@5: `0.375`;
- critical Recall@5: `0.75`;
- MRR: `0.2013888889`;
- nDCG@5: `0.2298334118`.

The run used Qdrant, FastEmbed dense/sparse infrastructure and ast-grep. The
TypeScript LSP preflight was unavailable and is recorded as unavailable, not as
a successful semantic-provider result. This diagnostic is not the five-strategy
ablation gate and does not establish a winning strategy.

The five strategy runs and the dense-only non-inferiority gate are still open.
No token, context-saving or cost claim is made from the diagnostic run.

## Reranker evidence

The separate external reranker workspace is
`D:\ace-external\h6-reranker-2026-10-21-v1`.

- source specification SHA-256:
  `608b8562066695e50a48f389d0996f371807248bc1e737f1987ce33f9745a1e0`;
- frozen reranker holdout SHA-256:
  `832b40f85bf7974d13e3aa9b3801dd7fa0981b69d9a79b94f8e4595a95acd373`;
- converted retrieval holdout SHA-256:
  `4511fc3eb1b9caa00ff74f9543d57945666476f8cd70e3245300f83e32169d78`;
- 12 non-overlapping cases: 6 ACE and 6 Chess.

The true hybrid-without-reranker baseline on that holdout measured Recall@1,
MRR and nDCG@5 all at `1.0`. Every tested candidate had lower MRR and nDCG@5:

| Model | Recall@1 | MRR | nDCG@5 | p95 latency |
|---|---:|---:|---:|---:|
| Xenova/ms-marco-MiniLM-L-6-v2 | 0.5833 | 0.7500 | 0.8135 | 378 ms |
| Xenova/ms-marco-MiniLM-L-12-v2 | 0.5833 | 0.7500 | 0.8135 | 707 ms |
| jinaai/jina-reranker-v1-tiny-en | 0.5833 | 0.7500 | 0.8135 | 334 ms |
| jinaai/jina-reranker-v1-turbo-en | 0.5833 | 0.7639 | 0.8244 | 527 ms |
| BAAI/bge-reranker-base | 0.5833 | 0.7639 | 0.8244 | 1,289 ms |
| jinaai/jina-reranker-v2-base-multilingual | 0.5833 | 0.7639 | 0.8244 | 2,192 ms |

The selection gate returned `accepted: false` and
`selectedIdentity: null`. The current reranker policy is therefore
`disabled`/optional; no reranker is production-approved by this evidence.

## Harbor four-arm preparation and blocker

The external Harbor workspace is
`D:\ace-external\h6-harbor-2026-10-21-v1`.

- task manifest SHA-256:
  `1e4afe160de628878b50dbe2c2921535552ef8b6c8bb0c145370bf050820b2b1`;
- six tasks: three ACE and three Chess;
- ACE revision: `b20646c966575e8280ea792e4f851ab1e28ec867`;
- Chess revision: `23a7bb6b27023e8520941841d69745dd623d0933`;
- job binding SHA-256:
  `ef6f4f7cfce7609552ab93014760cef5a9f980333f321da14fd2c5628ee61f21`;
- job configurations have five serial repeats per task/arm and retain SHA-256
  sidecars.

The job bundle is frozen, but the real run is `BLOCKED`: `harbor --version`
reported `0.24.0`, while the required Codex CLI/OAuth and Docker runtime were
unavailable in the Linux/WSL execution environment. No Harbor trial, real
agent ACE call, receipt reuse observation, task-success result, token ratio or
5× claim is reported.

## Open gates

1. Merge the reviewable PRs after review and rerun affected checks on the merged
   source.
2. Provision the required Linux/WSL provider and Harbor runtime without
   changing the frozen holdouts.
3. Run all five retrieval strategies on v3 and execute the dense-only
   non-inferiority gate with tolerance `0.0`.
4. Keep the reranker rejected unless a new frozen, non-overlapping evaluation
   provides evidence that passes the selection contract.
5. Run the four-arm Harbor job bundle with real ACE calls and observed receipt
   reuse; retain failed/timeout runs and report unknown costs as `unknown`.
6. Update this ledger with the resulting digests and verdicts, then obtain
   owner approval. Production track evidence remains separate.

No production-ready or `5×` savings claim is made by this document.
