# Review — Codex stage0/provider closure corrections

**Reviewed branch:** `codex/stage0-baseline` at `cebf48de798e8b28510e61c52690f70fb80846b8`  
**Review date:** 2026-10-19  
**Verdict:** substantial useful work, but **do not merge the Codex branch unchanged**. This correction branch preserves the good provider work and fixes security, lifecycle, cancellation, benchmark-reproducibility and acceptance-status problems.

## Owner clarifications captured during review

1. **Graphiti must not deadlock on owner model selection.** Graphiti + FalkorDB remain local-first. Codex/agents are explicitly authorized to choose/install/test a supported **local-only experimental inference backend/model themselves**. They should not stop and wait for the owner merely because a production extraction model has not been selected. Production promotion still needs measured evidence.
2. **Vertex Europe corpus creation was authorized by the owner.** `ace-europe-stage2` is valid test infrastructure and must be retained. Its creation is **not** a scope violation. Private-document upload remains separately permissioned.
3. **Qdrant code storage is local-only.** ACE must not accept arbitrary HTTPS/external Qdrant endpoints for code payloads. Docker/local bridge aliases may be explicitly allowlisted.

## What Codex did correctly

- Reintroduced a genuine exploratory retrieval chain: FastEmbed/ONNX → Qdrant → Tree-sitter → TypeScript Language Service → current-byte verification → exact expansion.
- Added useful real-provider race/outage/restart tests and same-name semantic fixtures.
- Preserved failed Harbor evidence instead of manufacturing a benchmark result.
- Kept Graphiti extraction and Harbor 5× claims open rather than faking completion.
- Provisioned Qdrant and FalkorDB locally in k3s without exposing them as public services.
- Improved FastEmbed worker portability and recorded Serena/direct-TS-LS evidence without naming a winner.

## Corrections applied in this branch

### P0 — Qdrant egress

**Finding:** Qdrant upsert stores source snippet text. The Codex branch accepted any configured URL, including external HTTPS.

**Fix:** Qdrant endpoints are now policy-bounded to loopback HTTP by default. Explicit local bridge aliases can be supplied through `ACE_QDRANT_LOCAL_HOSTS` for Docker/k8s development. A contract test verifies an external HTTPS Qdrant is rejected before any HTTP call.

### P0 — Vertex egress

**Finding:** `ACE_ENABLE_VERTEX=true` previously constructed a policy with `cloudOptIn=true` automatically.

**Fix:** enabling the provider no longer grants data egress. Runtime cloud egress additionally requires `ACE_CLOUD_DOCS_OPT_IN=true`. Secret-like documentation queries are conservatively denied before HTTP. The Europe corpus remains owner-authorized and is not deleted.

### P1 — MCP cancellation

**Finding:** the client could observe cancellation while the underlying ACE Effect continued.

**Fix:** the SDK AbortSignal is passed into `Effect.runPromise`; provider fetches consume the Effect cancellation signal. The cancellation test now requires the underlying Effect finalizer to execute.

### P1 — Qdrant lifecycle

**Finding:** a new collection was created for every observation generation (`_g1`, `_g2`, ...), causing unbounded collection accumulation.

**Fix:** the default collection is stable per workspace+embedding configuration. Generation remains explicit in point payload/filtering. After successful reindex, obsolete generations for the workspace are pruned. The restart E2E now requires one stable collection and verifies generation 1 is removed while generation 2 remains.

**Still open:** startup currently rebuilds/embeds the full supported source snapshot; incremental changed-file indexing remains a performance improvement and should be benchmarked before production promotion.

### P1 — Context fan-out

**Finding:** the exploratory semantic gate returned up to 12 candidates and in the observed tiny fixture returned 10 items, which is weak evidence for a token-reduction engine.

**Fix:** default Qdrant candidate delivery is bounded to 6 and can be configured with `ACE_CONTEXT_CANDIDATE_LIMIT` (1–20). This is not a final optimal K; Harbor/quality evidence must choose it.

### P1 — DBC status inflation

The Codex branch checked several normative contracts using only sub-gate evidence.

- **DBC-03 reopened:** real embeddings are useful experimental evidence, but the semantic provider/model is not production-approved and top-1 quality remains imperfect.
- **DBC-04 reopened:** same-name tests pass for direct TS LS and Serena, but ADR-004 comparison remains incomplete and no LSP winner is approved.
- **DBC-09 reopened:** the official MCP TypeScript client passes a conformance sub-gate, but the normative contract says **Codex initializes/invokes ACE**. The failed Harbor/Codex run does not satisfy that.
- **DBC-14 reopened:** conflict-merging logic passes with a test DocumentationPort, but real Vertex citation-vs-current-code conflict evidence is still missing.
- **DBC-08 retained as passed** after adding a >2000-line Unicode + mixed-newline exact-byte round-trip contract.

### P1 — embedding comparison reproducibility

**Finding:** the historical FastEmbed report contains similarity scores above 1 (for example ~9.98), proving those values were not normalized cosine. The original comparison generator was not committed and model artifact digests were not captured.

**Fix:** historical numbers are explicitly demoted to exploratory history. Added:
- `benchmarks/retrieval/embedding-provider-comparison-labels.json`
- `scripts/embedding-provider-comparison.py`
- `scripts/embedding-provider-comparison.sh`
- `npm run compare:embeddings`

The replacement scorer computes normalized cosine, uses a committed nine-query dataset and attempts to hash the locally cached model artifact tree.

### P2 — duplicated reports

Undated duplicates for real-provider and Vertex evidence are replaced by canonical pointers to the dated reports so they cannot silently diverge.

## Graphiti — no further owner decision required to continue

Do **not** wait for the owner to pick an experimental Graphiti model/runtime.

The next implementation pass should:
1. inspect the installed Graphiti version/factories;
2. choose a maintained local-only inference setup it actually supports (for example an OpenAI-compatible generic client targeting a loopback local inference server; no mandatory Ollama);
3. keep FalkorDB and all session/extraction traffic local;
4. run actual `add_memory` → processing completion → `search_memory_facts` → source citation → delete/purge → restart/recovery tests;
5. measure the candidate and only then bring a production recommendation to the owner.

A local candidate failing is an engineering result, not a reason to stop and request another architecture decision.

## Remaining mandatory gates after these corrections

- Production embedding/model/runtime selection after a reproducible larger holdout.
- Completed Serena vs direct TypeScript LS matched comparison and owner selection.
- Actual Codex→ACE MCP E2E for DBC-09.
- Real Vertex corpus with an authorized synthetic/public fixture and citation/version conflict test for DBC-14; private documents remain separately gated.
- Graphiti extraction/recall/purge/recovery E2E with local inference; DBC-11 still needs derived-graph purge proof.
- Successful paired Harbor native-vs-ACE runs with valid Codex authentication, actual ACE calls, quality parity and attributable total token/cost numbers. 5× remains a measured target, not an entry condition.
- Incremental indexing/re-embedding performance work if full startup rebuild is too expensive on realistic repositories.

## Merge recommendation

Merge **this correction branch**, not `codex/stage0-baseline` directly, after CI is green and any compile/lint fixes are addressed. The owner-authorized Vertex corpus must remain intact.
