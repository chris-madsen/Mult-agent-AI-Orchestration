# ACE implementation and B0 evidence — 2026-10-20

**Status:** implementation evidence retained; B0 is **not** a production or 5×
result. This document records the current commit and the failed/partial external
observations without rewriting the historical review
`2026-10-20-ace-remaining-work-and-benchmark-readiness.md`.

## Exact implementation commit

- source commit: `022af8bb97b4b326d2b9bd924954760903de05a0`
- implementation branch: `codex/ace-review-implementation`
- verification: `npm run verify:pr` — typecheck, 323/323 deterministic tests, lint and build passed

The implementation changes cover:

- authoritative workspace manifest comparison before Qdrant/local context delivery;
- semantic snapshot identity over index/configuration/dependency/provider inputs;
- explicit `sourceObligations.required/optional` with overlap validation and source-plan coverage;
- fatal identity/trust-boundary startup handling versus live `not_ready` provider outages;
- evidence binding to the exact release commit and measured artifacts;
- owner-signed approval verification against a configured public-key trust root;
- Harbor Codex OAuth auth-file configuration without adding Amplifier.

The manifest path intentionally fails closed with `not_ready` when lazy catch-up
cannot be established. It does not claim the full warm dirty-tree catch-up gate.

## B0 Harbor three-arm run

Pinned run identity:

- Harbor `0.24.0`;
- Codex `0.148.0-alpha.9`;
- model `gpt-5.6-luna`;
- reasoning effort `high`;
- 3 tasks × 3 serial trials per arm;
- auth evidence: Harbor trial logs report `Codex auth: using auth.json from /home/ilja/.codex/auth.json`; the checked-in Codex job configs set `CODEX_FORCE_AUTH_JSON=1`.

Raw aggregate artifacts are retained under the local ignored `artifacts/` tree:

| arm | aggregate | SHA-256 | result | counters |
|---|---|---|---|---|
| native Codex | `artifacts/harbor-b0-native-022af8b/ace-retrieval-native-paired-3x3-serial/result.json` | `cb877372788c95614030d75bf44f522bd5379b342bc35f0e301f00399cc04675` | 9/9 reward 1.0; 1 `AgentTimeoutError`; 0 ACE calls | input 880,778; cached 746,240; output 16,422; cost `$0.06269112` |
| ACE optional-natural | `artifacts/harbor-b0-natural-022af8b/ace-retrieval-ace-optional-natural-3x3-serial/result.json` | `9e88218f7ab11e97c8c6751ef163e7b6c844f93a520107bfda9610f110e6145b` | 9/9 reward 1.0; 0 errors; 0 actual `ace_context` calls | input 750,866; cached 677,632; output 19,659; cost `$0.05179024` |
| ACE forced diagnostic | `artifacts/harbor-b0-forced-022af8b/ace-retrieval-ace-paired-3x3-serial/result.json` | `5619bbaf9cce6544d532913f12715e66159f16841c20708a1ccddb0bd0637e96` | 1 reward 1.0; 8 `RewardFileNotFoundError`; 10 actual ACE calls; all 10 returned `status=not_ready` | input 602,560; cached 487,552; output 8,950; cost `$0.04349264` |

The optional-natural arm's zero ACE calls provide no causal ACE evidence. The
forced arm is diagnostic only and cannot establish natural economics, regardless
of its token counters. The verifier errors are retained; they are not converted
to zero-cost or successful quality.

## Provider blocker observed during B0

The forced trajectory contains real `mcp__ace__ace_context` calls. Their structured
responses were:

```text
status=not_ready
capability=unified_context
detail=unified_context is not implemented in foundation; no provider success is simulated
```

The detail is the gateway's no-context response, not evidence that retrieval was
successful. A local reproduction with the same Docker image and a reachable Qdrant
endpoint produced the real composition receipt (`indexed_paths=4`, zero coverage
failures, FastEmbed/ONNX + Tree-sitter + TypeScript-LS), so the repository provider
path is runnable. The Harbor-specific endpoint was configured as
`http://172.17.0.1:6333`, while the current host Qdrant publication is only
`127.0.0.1:6333`; host curl to `172.17.0.1:6333` returned connection refused.
This is a site-specific host firewall/bind/network setup blocker. The benchmark
must be rerun after Qdrant is intentionally exposed to the Harbor bridge network
or an approved equivalent network arrangement is provided. Local fallback remains
disabled.

## Remaining gates

Still not closed by this commit or run:

- lazy warm catch-up and the full S1/S2 dirty-tree/fresh-provider-oracle scenarios;
- unseen multi-repository W01/W03 holdouts and owner approval of embedding/semantic providers;
- Graphiti Qwen3:14b local extraction, lifecycle, purge, crash/reconcile and OPS-02/04/05;
- authorized Vertex synthetic import/retrieval and DBC-14 citation conflict;
- k3s site egress, persistence/PVC restore, K3S-10 and DBC-13;
- final exact-release F-06/F-11 signed artifacts, resource budgets, immutable image/SBOM/provenance/signature/license evidence;
- owner approval for the exact release commit and capability scope.

No production-ready or 5× claim changed.
