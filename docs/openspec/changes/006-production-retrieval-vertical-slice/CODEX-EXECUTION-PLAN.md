# Codex Execution Plan — ACE real-provider closure

**Owner approval:** 2026-10-19. **Current state:** implementation in `main` partially complete; **no production-readiness or 5× claim**. **This is the authoritative next-work entrypoint for Codex**; OpenSpec specifications and Accepted ADRs define the contracts. The former `docs/reviews/2026-10-19-codex-code-handoff.md` is historical PR #2 guidance and must not override this plan.

## Owner's binding decisions

- ADR-012's **six architecture and acceptance rules are Accepted**. Approval of test policy does **not** mean its tests have passed.
- Ollama **must not** be required, installed as a default dependency, or selected as the production serving architecture. Evaluate genuine local embeddings with mature libraries, e.g. FastEmbed/ONNX, under ADR-013; **model selection remains open**. The in-repo `local_sha256_projection_v1` is only a deterministic test double.
- **Serena versus direct TypeScript Language Service** must be compared under Accepted ADR-004. Neither automatically wins due to already having code.
- **Graphiti + FalkorDB, local-first**. No unapproved cloud transmission of raw sessions or derived extraction payload. **Do not wait for the owner to select an experimental local inference backend:** Codex is authorized to choose/install/test a supported local-only candidate itself; production promotion remains evidence-gated.
- **Vertex AI RAG Engine** is the selected documentation provider. Development host already has an authenticated `gcloud` CLI. Use that session for authorized REST probes (no new interactive login by default); do not assume container ADC is configured. Corpus `ace-europe-stage2` in `europe-west4` was **explicitly authorized by the owner and must be kept**. Do not upload private documents without a separate data authorization; synthetic/public fixture import may proceed only within the owner's stated test scope.
- Harbor must measure actual value of ACE with a strong standard Codex baseline. **5× is the aspirational target, not a prerequisite to running tests.** Preserve regressions and failures.

## Stage 0 — Establish reproducible baseline (start immediately)

1. Pull clean `main` after the owner decision PR merges; inspect `AGENTS.md`, ADR-003/004/005/007/009/012/013 and OpenSpec 003/004/006.
2. Check installed versions/permissions without exposing tokens: `node --version`, `npm ci`, `npm run check`, `npm test`, `npm run lint`, `npm run build`, `gcloud config get-value project`, `gcloud auth list` (redact identity in published logs), `npm run probe:vertex`. Validate relevant OpenSpec changes with the installed CLI; verify CLI flags via `--help`.
3. Record executable results, environment fingerprints and negative cases under `benchmarks/reports/` or `docs/reviews/`. Do not change production-readiness flags from mocks alone.

**Exit:** honest baseline report, dependency matrix and blockers. Permission to proceed is NOT contingent on green results.

## Stage 1 — Actual Qdrant + embeddings + AST/LSP vertical slice (P0)

1. Investigate and benchmark at least two genuine model/runtime combinations for local embeddings; **FastEmbed/ONNX is a candidate, not chosen by fiat**. Include a competitive lexical/hybrid baseline, behavior-not-name query, duplicate/similar symbol names and RU↔EN technical requests. Record model ID/version/digest, vector dimensions, query/document preprocessing, latency, indexing time, recall@k, runtime memory and retrieval quality. Preserve failed candidates.
2. Implement selected-for-experiment `VectorEmbeddingPort` using maintained library and invoke **real** Qdrant. The current `src/bin/ace-mcp.ts` composition already wires the actual experimental provider path for `ace_context` when `ACE_ENABLE_EXPERIMENTAL_QDRANT=true`; verify that path through real provider and agent-facing evidence rather than restoring it as if it were absent. Keep the path explicitly experimental until model/provider selection and owner approval; do not silently enable the lexical fallback or count SHA-256 hash vectors as semantic retrieval.
3. Parse actual TS/JS AST with Tree-sitter/ast-grep. Verify exact UTF-8 source slice and SHA-256 working-tree digest after Qdrant lookup, and re-check before bundle delivery; retain authorized exact full-file expansion. Version Qdrant collections by model/generation so stale/deleted symbols do not appear.
4. Run **both** Serena and direct TS Language Service on identical fixtures. Check definitions/references, same-name methods, writes vs definitions, types, diagnostics, latency, license and real Codex usage. Submit measured comparison and owner recommendation; do not declare one production-approved yet.
5. E2E over actual Codex MCP client and real providers, not just direct adapter tests. Capture safe invocation receipts and DBC-01/02/03/04/05/06/07/08/09/13/14 results from `docs/docs/architecture/07-architecture-fitness-contracts.md`.

**Exit:** `real-provider-tested` + `agent-E2E-tested` only when actual calls and outputs prove it; owner selects production embedder and LSP after report. A failing experiment remains useful, not `done`.

## Stage 2 — Vertex real integration (P1)

1. From the owner's local host: `gcloud config get-value project`; `gcloud auth print-access-token` **only in process/substitution, never to logs, PR or stdout**; use existing `npm run probe:vertex`. Check actual resource name, IAM and RAG corpus in relevant region.
2. The owner explicitly authorized creation of the Europe test corpus and it now exists as `ace-europe-stage2`; **do not delete it**. Reuse that corpus. Corpus creation is no longer a blocker. Keep private source/dialogue out of Vertex unless separately authorized.
3. After a permitted fixture corpus exists, call real `retrieveContexts` via `src/adapters/vertex-rag.ts` with an ephemeral access token or appropriately configured ADC. Check sourceUri/text, version/citation, conflict with current source, 403, timeout and partial result; ensure cloud opt-in is checked at outbound call.

**Exit:** real authenticated corpus/citation and policy-denial evidence, else explicit `not_ready: empty_corpus/iam`.

## Stage 3 — Graphiti local-first integration and archive safety (P1)

1. Check local Graphiti, FalkorDB and model inference configuration. FalkorDB health alone is **not** evidence that Graphiti extraction is working. **Proceed without owner selection:** choose a maintained local-only inference candidate supported by the installed Graphiti version (for example its OpenAI-compatible generic client pointed at a loopback inference server); if one local runtime is unavailable, try another supported local runtime instead of stopping. Do not force Ollama or default to a cloud extraction LLM.
2. Import real/synthetic Codex session bytes to immutable archive; project with actual `add_memory`, observe pending→completed semantics, and exercise `search_memory_facts` with original pointers and temporal history. Preserve `proposed` versus owner-approved `accepted`.
3. Test idempotent replay, source append, reference-safe blob deletion, graph purge, races across **separate OS processes**, forced termination, lock recovery and filesystem semantics. For unsafe multi-node/RWX assumptions, propose an ADR or transactional store rather than claiming a directory lock equals a distributed database. Confirm local-only data egress.
4. Implement missing durable outbox/ack/reconciliation needed to prevent archive/graph divergence. Check DBC-10/11 with real service evidence.

**Exit:** projected and purged real episodes, exact original references and failure/recovery report; otherwise explicit `not_ready`.

## Stage 4 — Harbor evaluation (P1; start exploratory runs in parallel)

1. Use Accepted ADR-009: same Codex model/reasoning/configuration, matched task repository commits and timeouts, both native tools enabled, ACE success verified via actual MCP invocations. Include 3+ genuine cross-file retrieval/impact tasks, not only the single `ace-retrieval-impact` development task.
2. Run native Codex, Codex+Serena and Codex+ACE comparisons, paired repeated trials and ablations (lexical, vector, AST/LSP, docs, memory when applicable). Use `npm run gate:harbor -- <native-dir> <ace-dir> <report.json>` only when its actual trace/usage parser is verified against installed Harbor/Codex event schema; repair parser if schema differs.
3. Preserve raw usage, input/output cached breakdowns without double counting, failures, verifier rewards, token cost *plus* external inference/embedding/Vertex/Graphiti/indexing cost, latency and run fingerprints. Freeze a previously unseen holdout after exploratory tuning.
4. Report measured quality and speedup, including results below 1× or below 5×. The 5× target is **not** a test runner gate: it is a product efficacy goal. Never attribute a zero-call run's token delta to ACE.

**Exit:** reproducible result/report, **not** automatically a success claim. Any quality regression or falsified attribution blocks acceptance.

## Stage 5 — Decision and owner gate

- Present measured embedding/runtime candidates and Serena-vs-TS-LS comparison for production selection; request explicit approval **only then**.
- Keep model/provider status and OpenSpec mandatory checkboxes honest. Mark a DBC contract passing only with real trace, test fixture, source fingerprint, verdict and version. `not_ready` is acceptable while external permissions or services are missing.
- Update `docs/openspec/changes/003-unified-retrieval/`, `004-temporal-memory/`, and `006-production-retrieval-vertical-slice/` as evidence arrives. Do not archive 006 or claim ACE production-ready without all applicable accepted gates.

## Output artifacts required from Codex

- `docs/reviews/serena-vs-ts-language-service.md`
- `benchmarks/reports/embedding-provider-comparison.md` and machine-readable raw results
- `docs/reviews/real-provider-e2e.md` with DBC IDs and trace IDs
- `docs/reviews/vertex-gcloud-corpus-validation.md` (secrets redacted)
- `docs/reviews/graphiti-archive-recovery.md`
- `benchmarks/reports/harbor-ace-paired.md` with immutable raw job pointers

If a prerequisite is unavailable, state **exactly which**, show safe diagnostics, and continue independently runnable stages rather than replacing selected mature engines with a home-grown substitute.
