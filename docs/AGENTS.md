# ACE — Agent implementation contract

You are implementing an external context harness for Codex. Read **in order**:
1. `docs/references/PRD-v1.0.md`.
2. `docs/references/ADR-000-decision-register.md` and ADR-001…ADR-010.
3. `docs/architecture/01-strategic-ddd.md` through `05-contracts-and-deployment.md`.
4. `openspec/README.md` and one selected `openspec/changes/<id>/` proposal/specs/design/tasks.

## Non-negotiable rules
- Respect accepted ADRs; architecture beyond them is proposed until a design decision is approved. Do not silently decide Jev, LSP provider, embeddings provider, K8s mount strategy, Codex session exporter or Graphiti extraction backend.
- **No write access to user's source code from ACE:** coding and patching belong to Codex. ACE may write its own indexes/archive/evaluation artifacts.
- BC boundaries are **modules in one modular monolith**, not eight microservices. Use existing local Kubernetes; keep Harbor separated as test runner.
- Local Qdrant for code search; Vertex AI RAG Engine for allowed documents; Tree-sitter/ast-grep for structural search; Graphiti for temporal derived knowledge while raw sessions are primary truth.
- One unified MCP façade. Never leak Qdrant/Graphiti/Vertex DTOs into domain model.
- NEVER silently truncate, rewrite or summarize instead of preserving source/generated code; 2000+ lines must remain byte-identical. No mandatory fixed context-token cap. Optional short excerpts require exact, access-checked expansion.
- Evidence must include provenance, workspace identity and freshness; stale candidate != current code. No claim of full dynamic-call coverage from LSP results.
- Auth/security/data-residency decisions fail closed and are safely logged. Temporary backend failure may allow a truthful degraded answer/local fallback.
- Archive original Codex sessions. Extraction != user confirmation. A decision becomes `Accepted` only after explicit approval.
- All benchmark tasks compare a strong native Codex baseline (native tools, caching and compaction enabled); provider-reported token usage, failed runs and extra provider costs must be preserved. 5× is a **target**, not a achieved result.
- Tests must cover idempotency, concurrent file changes, missing secrets, stale retrieval, >=2000-line exactness, reset reproducibility and usage double-counting.
- Do not add dashboards/OTel or build CodeQL/CPG/runtime tracing unless a later change explicitly scopes it.

## OpenSpec workflow
- Work on **one change at a time** in ordered sequence: `001-foundation`, `002-harbor-evaluation`, `003-unified-retrieval`, `004-temporal-memory`, `005-adaptive-routing-spike`.
- Run `openspec validate <change> --strict` if the installed CLI supports it; inspect its current help before assuming flags.
- Before implementing a production integration requiring a spike, record results, versions, risks and a proposal for approval. A spike may use a mock/stub, but never claim stub behavior is production ready.
- Complete tasks and tests; do not archive a change with unfinished work or fake completion.
- Keep all secrets, private code and raw user dialogues out of public artifacts and benchmark reports.
