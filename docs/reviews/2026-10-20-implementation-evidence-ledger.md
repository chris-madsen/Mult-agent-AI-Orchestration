# ACE implementation / evidence ledger — 2026-10-20

**Purpose:** W00 truth baseline. This file separates code that exists from real-provider, agent-E2E, benchmark and owner-approval evidence. It does not replace the normative unified plan or DBC manifests.

**Baseline commit:** `33766c721e9628fecc7d4ad4b9ac503432d69e2d`  
**Scope rule:** only merged `main` at that commit is counted below. Open PRs are not promoted by this ledger.

## Evidence vocabulary

| State | Meaning |
|---|---|
| **implemented+contracted** | production-shaped code and deterministic contracts exist in `main`; this is not a provider acceptance claim |
| **real sub-gate** | a retained real-provider/local-runtime test exists for a bounded invariant |
| **external run pending** | runner/gate exists, but required provider/cluster/agent run has not been retained for the normative claim |
| **approval pending** | measured selection still needs the explicit owner decision required by ADR-012/013 |
| **deferred** | intentionally outside the critical path |

## Reproducible baseline identity

| Component | Baseline identity / status |
|---|---|
| ACE | `ace-harness 0.1.0` |
| CI Node line | Node 22 in `.github/workflows/ace-contracts.yml` |
| TypeScript | `5.9.3` |
| MCP SDK client/server | `2.3.1` |
| Tree-sitter CI runtime | `tree-sitter 0.26.0`, `tree-sitter-typescript 0.23.2`; runtime helper also emits its effective identity |
| Qdrant | runtime default receipt label `qdrant/1.19.2`; actual provider version must be captured by each real run |
| embedding development default | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2@e8f8c211226b894fcb81acc59f3b34ba3efd5f42` |
| FastEmbed artifact candidate | `qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q@faf4aa4225822f3bc6376869cb1164e8e3feedd0`; artifact digest is required for pinned/production mode |
| Codex CLI/model/reasoning | **not captured by this static baseline**; W13 run must record the exact values |
| Harbor | **not captured by this static baseline**; W13 run must record the exact version/runtime |
| Graphiti / inference | **production identity pending real W06 run**; evidence generator refuses to substitute a mock provider result |
| Serena | **matched production comparison pending**; direct TS-LS evidence does not approve either provider |

The normal contract workflow runs locked install, typecheck, embedding evaluator regressions, pinned Tree-sitter install, tests, lint and build. An exact-main CI receipt must still be retained when W00 is normatively closed; this ledger does not infer one from successful PR checks.

## Correctness prerequisites C-A…C-E

| Prerequisite | Implementation state | Remaining normative evidence |
|---|---|---|
| **C-A snapshot isolation / publish / GC** | **implemented+contracted**: content-derived snapshot identity, atomic manifest states, leases, orphan-lease recovery, membership checks, lease-aware GC | real concurrent readers/writer, interrupted writer and restart run on selected storage |
| **C-B exact semantic identity** | **implemented+contracted**: AST identifier anchors, UTF-8 handling, TS-LS exact-symbol oracle, shared Serena-vs-TS-LS fixture | matched Serena run, dirty-worktree/provider snapshot proof, owner semantic-provider approval |
| **C-C coverage truth** | **implemented+contracted**: failed paths propagate into index/context completeness; binary/invalid text and sensitive paths are explicit | real mixed-provider/dirty-tree acceptance receipts |
| **C-D effective embedding identity** | **implemented+contracted**: worker reports effective model/artifact/runtime/mode; parent verifies identity; production selection gate is non-self-approving | frozen unseen multi-repo comparison, license review, target-host measurements, owner approval |
| **C-E temporal decision history** | **implemented+contracted**: immutable transitions, as-of state reconstruction, successor/cycle/workspace validation | real Graphiti temporal extraction/search evidence |

## Work-package ledger

| Work package | Current implementation state | What remains before normative closure |
|---|---|---|
| **W00 truth baseline** | **partial**: this ledger + DBC evidence manifest tooling + truthful readiness states | exact-main command receipt, OpenSpec strict run, reconcile current OpenSpec task checkboxes only from retained evidence |
| **W01 embedding** | comparison runner, full ranking metrics, pinned identity and explicit selection/owner-approval gate **implemented+contracted** | frozen unseen multi-repo run, authoritative licenses, host perf, owner approval |
| **W02 Serena vs TS LS** | shared 2000+ line oracle and direct TS-LS runner/gate **implemented+contracted**; direct TS-LS local evidence exists | run Serena on identical fixture/oracle, fair cold/warm/RSS/license comparison, owner approval |
| **W03 retrieval quality** | ranked-ID quality/compactness evaluator, neutral ablation report and predeclared gate **implemented+contracted** | real frozen multi-repo lexical/vector/hybrid runs; implement hybrid only if measurement justifies it |
| **W04 incremental index** | per-file identities, vector reuse, structural cache, candidate cache, atomic snapshot state, lease recovery **implemented+contracted** | 1k/10k cold/warm/change-only measurements, real rename/delete/untracked/concurrent/restart/interrupted-writer suite |
| **W05 Vertex docs** | policy-before-network, secret egress guard, one-shot auth refresh, synthetic conflict E2E runner **implemented+contracted** | authorized synthetic corpus import/retrieval run, citations/version evidence, quota/cost record |
| **W06 Graphiti extraction** | archive-backed Graphiti adapter, provenance-safe fact search and real lifecycle runner **implemented+contracted** | actual supported local LLM/embedder/reranker run against FalkorDB; latency/cost/outbound proof |
| **W07 memory reliability** | durable outbox, reconciliation, verified purge-before-tombstone, bounded retries/dead-letter/manual repair, temporal decisions, local backup/restore **implemented+contracted** | SIGKILL/concurrent real Graphiti/FalkorDB storage tests and provider backup/restore proof |
| **W08 unified runtime** | Graphiti-backed memory injection, code/docs/memory gateway, typed required/optional/not-requested/denied coverage, mixed partial flow **implemented+contracted** | one real Codex session exercising all three permitted sources and mixed provider failures |
| **W09 admission/economics** | frozen EN/RU holdout, quality/volume evaluator, token-cost `unknown` unless counters supplied **implemented+contracted** | real Graphiti project-all/admission-filter comparison with provider counters |
| **W10 routing/Jev** | deterministic route controls actual provider execution; unrequested code path is skipped **implemented+contracted** | Jev remains optional/deferred unless measured study justifies it |
| **W11 k3s/live worktree** | authenticated mTLS host helper + containment contracts **implemented+contracted** | real pod→host K3S-01…10 run and retained evidence |
| **W12 failure/security** | source races, source revalidation, secret-path/query guards, invalid UTF-8/binary rejection, cancellation, auth refresh, safe request traces **implemented+contracted** | real provider crash/race/security matrix; every required branch must retain correlated trace receipt |
| **W13 Harbor** | strict native / natural-optional / forced-diagnostic gate and attribution schema **implemented+contracted** | actual frozen paired multi-repo runs, Codex+Serena baseline/ablations, complete cost telemetry |
| **W14 DBC-01…14** | machine-readable PASS/FAIL/NOT_RUN/BLOCKED manifest with retained artifact hashes **implemented+contracted** | execute remaining real gates on one release commit; no all-PASS claim exists yet |
| **W15 release/operations** | truthful readiness/config docs, supply-chain gate, full preflight, code-only preflight, local backup/restore and operations evidence gate **implemented+contracted** | real evidence bundle, resource budget, exact-commit owner sign-off, release notes/OpenSpec reconciliation |
| **W16 deferred** | Jev default routing, full observability, Rust/microservices/HA/CPG/extra languages intentionally **deferred** | new measured need + ADR before promotion |

## What must not be inferred from this ledger

- **No production embedding or semantic provider is approved yet.**
- **No full Graphiti/Vertex/k3s provider acceptance is claimed from deterministic contracts.**
- **DBC-12 is not closed by the historical forced-use benchmark.**
- The historical forced-use result remains negative: native used fewer total tokens than forced ACE; do not rewrite it as savings.
- The 5× token reduction remains a product hypothesis until a natural-use paired Harbor run measures it.
- `READY_CODE_ONLY` and full `READY` are separate scopes; the narrower verdict cannot authorize documentation or memory.

## Commands already available for the remaining evidence

```bash
npm run gate:embedding-selection -- ...
npm run compare:semantic-tsls
npm run gate:semantic-selection -- ...
npm run report:retrieval-quality -- ...
npm run gate:retrieval-quality -- ...
npm run test:real-graphiti-lifecycle -- ...
npm run test:real-vertex-conflict -- ...
npm run gate:harbor-three-arm -- ...
npm run evidence:k3s-worktree -- ...
npm run evidence:backup-restore -- ...
npm run evidence:dbc -- ...
npm run release:supply-chain -- ...
npm run release:preflight-code -- ...
npm run release:preflight -- ...
```

The provider-trace receipt is run directly with `npx tsx scripts/provider-trace-receipt.ts ...`.

## Next owner/Codex execution order

1. Finish the exact-main W00 command/OpenSpec receipt.
2. Run W01/W02 frozen provider selections and obtain owner decisions.
3. Run W05/W06 real Vertex/Graphiti gates with the already-defined safe fixtures.
4. Run W11 real k3s checks and W07/W15 recovery evidence.
5. Run W13 natural-use Harbor only after the relevant provider identities are frozen.
6. Generate DBC-01…14 evidence for the exact release commit.
7. Run the appropriate scoped preflight and obtain exact-commit owner sign-off.

Do not convert an `external run pending` row to production-ready merely because its runner exists.
