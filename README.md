# Adaptive Context Engine (ACE) Harness

ACE is an **agent-neutral hybrid context/RAG engine**, not an agent scheduler. LangGraph or another external orchestrator owns multi-agent workflows. ACE supplies verified context to model requests. For configurable-endpoint agents, **Bifrost is the selected, not-yet-implemented LLM context gateway** (ADR-017). **MCP is an explicit tool interface, not the primary route for model-bound context injection.** Hermes already has a native ContextEngine/JSONL bridge (ADR-016).


## Architecture at a glance

```text
LangGraph / other external orchestrator -> existing agents
                        | configured LLM endpoint
                        v
              Bifrost LLM Gateway (planned; mock provider-wire conformance is implemented, real-provider approval is not)
                 |               |
       Go ACE Connector          +--> LLM provider
             (IMPLEMENTED; mock-wire certified, real-provider approval pending)
                 |
       ACE Gateway Projection API (contract/application seam and HTTP endpoint implemented; production approval not)
                 |
         ACE Core (TS + Effect)
           |-- code: Qdrant dense/sparse RRF + ast-grep/LSP
           |-- docs: authorized Vertex RAG
           |-- memory: Graphiti/archive
           +-- verified context / receipts

Existing separate integrations:
  agent -- MCP explicit tool call --> ACE tools (search/expand/status)
  Hermes -- native ContextEngine --> ACE direct JSONL bridge
```

Private source and conversations remain local by default; Vertex is a
**separately authorized documentation source**, never an implicit destination
for private code. Current verified source bytes outrank stale index data,
derived memory and documentation when determining actual program behavior.
The 5× accepted-task token reduction is a benchmark hypothesis, not a reported
achievement. See [ADR-017](docs/docs/references/ADR-017-bifrost-unified-llm-gateway.md), [ADR-014](docs/docs/references/ADR-014-hybrid-context-engine.md),
[OpenSpec 007](openspec/changes/007-hybrid-context-engine/),
and the [2026-10-21 targeted code review](docs/reviews/2026-10-21-hybrid-context-static-code-review.md).

## Current implementation

The TypeScript + Effect modular monolith now implements substantial slices across foundation, retrieval, temporal memory, routing and acceptance. Full unified production readiness is still evidence-gated:

- validated workspace identity and working-tree observations;
- canonical path and symlink containment checks;
- tracked/untracked/removed path awareness for Git worktrees;
- revision-checked exact reads with digest and race detection;
- versioned local data policy and secret-safe audit records;
- exact artifact storage with lossless pagination;
- provider-independent evaluation core with frozen suites, BenchmarkRun FSM,
  cumulative/delta usage normalization and quality-gated reports;
- Hermes request-time `ContextEngine` integration through the direct ACE JSONL bridge; transformation receipts, source/runtime identity and quality-gated evidence remain required;
- Codex JSONL usage boundary adapter retained for explicitly labeled comparison/historical runs, not the Hermes primary path;
- explicit unknown usage and unsupported external-provider cost records until
  Harbor/third-party contracts are verified;
- local lexical candidate retrieval retained for controlled experiments, not
  a substitute for production hybrid context;
- an experimental real-provider `ace_context` path using local FastEmbed/ONNX
  dense + sparse/BM25, Qdrant native RRF fusion, maintained ast-grep structural
  spans, optional reranking, and generic LSP (TypeScript Language Server is the
  default); exact source rechecks and receipt/delta delivery are implemented;
  see `docs/reviews/2026-10-19-real-provider-e2e.md` for earlier exploratory
  evidence, not an approval of the latest code;
- immutable content-addressed session archive with idempotent replay, tombstones,
  temporal memory search and confirmation-gated decision FSM;
- deterministic multi-source routing with an explicit, opt-in Jev boundary and
  required-source quality comparison;
- one existing **MCP tool facade** (not the LLM context gateway) using the maintained official MCP TypeScript SDK over stdio,
  with `ace_context`, `ace_expand`, `ace_workspace_status` and
  `ace_memory_search` tool contracts;
- typed local context/memory provider wiring; `not_ready` is returned only when
  no provider is injected, while unverified external providers remain blocked.
- deterministic comparison report artifacts in Markdown, JSONL and CSV with
  evidence hashes and explicit unknown measurements.
- typed Qdrant/Vertex/Graphiti/Jev HTTP boundaries and a Harbor CLI runner with
  policy-gated requests, response validation and retained failed-run evidence.
- versioned `ace.gateway.v1` projection/ownership contracts, deterministic
  request-local projection tests, a Hermes compaction ownership guard, an
  isolated Go connector and a pinned Bifrost mock-provider wire proof; real
  external-provider, agent-E2E and production gates remain separate.

For explicit MCP tool access, run the MCP stdio process with `ACE_WORKSPACE_ROOT=/path/to/repo npm run mcp:stdio`.
Without the real retrieval provider it exposes an honest `not_ready` status,
not a simulated production search. For the **experimental** local retrieval
path, forward the local k3s Qdrant port and configure:

```bash
ACE_WORKSPACE_ROOT=/absolute/path/to/repo
ACE_ENABLE_EXPERIMENTAL_QDRANT=true
ACE_QDRANT_URL=http://127.0.0.1:6333
ACE_EMBEDDING_WORKER=$PWD/scripts/fastembed-worker.sh
ACE_SPARSE_EMBEDDING_WORKER=$PWD/scripts/fastembed-sparse-worker.sh
ACE_AST_GREP_COMMAND=$PWD/node_modules/.bin/ast-grep
# Optional LSP override; defaults to typescript-language-server --stdio.
ACE_LSP_COMMAND=$PWD/node_modules/.bin/typescript-language-server
ACE_RETRIEVAL_STRATEGY=hybrid_rrf
```

These are runtime entry points, not a complete installation recipe or model
approval. The bootstrap is read-only and indexes only allowlisted source types
outside dependency/build directories. See the
[configuration/readiness matrix](docs/operations/ace-configuration-and-readiness-matrix.md)
for exact modes, worker dependencies, pinned identity and diagnostics.

Vertex documentation requires `ACE_ENABLE_VERTEX=true` **and**
`ACE_CLOUD_DOCS_OPT_IN=true`, plus `ACE_VERTEX_PROJECT`,
`ACE_VERTEX_CORPUS_ID`, with default `ACE_VERTEX_LOCATION=europe-west4`.
Permission covers the `project_document` class only; secret-like queries are
denied before HTTP.

With k3s Qdrant forwarded to localhost, the real gates are reproducible with
`npm run test:real-provider` (2000-line precision, current digest, exact
expansion and workspace readiness) and `npm run test:real-provider-race`
(mid-request edit must become partial/stale, never current).
`npm run test:real-provider-restart` verifies a dirty-worktree restart advances
the observation generation and never serves the previous Qdrant generation.
`npm run test:real-provider-outage` verifies an unavailable Qdrant is reported
as partial with an explicit warning and does not masquerade as production
semantic retrieval.
`npm run test:real-semantic` runs the three-case behavior/RU↔EN exploratory
holdout through real FastEmbed/Qdrant/AST/LSP and writes its metrics to
`benchmarks/reports/real-semantic-retrieval-e2e.json`.
`npm run test:memory-process` checks stable history IDs and cross-process
archive reference safety without requiring an inference model.
`npm run test:real-same-name` verifies same-name structural spans, definitions,
references and write locations through real Tree-sitter and TypeScript LS.
`npm run test:container-provider` verifies the same retrieval composition through
the official MCP client and a Docker stdio container.

No production-approved embedding model/LSP, Graphiti extraction, Harbor quality
gate or 5× improvement is claimed until the documented provider spikes and owner
review are complete. The real-provider exploratory E2E is evidence, not a release
claim.

## Configuration and readiness

See [`docs/operations/ace-configuration-and-readiness-matrix.md`](docs/operations/ace-configuration-and-readiness-matrix.md) before enabling providers. In particular, `ACE_ENABLE_EXPERIMENTAL_QDRANT=true` selects the real local Qdrant composition but does **not** constitute production approval. The current production MCP bootstrap does not silently replace unavailable Qdrant with a lexical provider; lexical fallback is a separate test/degraded capability, not a production readiness signal.

Full code + documentation + memory release readiness is evaluated by `npm run release:preflight -- ...`; there is no environment flag that turns an unverified provider set into a production-approved system.

## Development

```bash
npm ci
make check
make lint
make test
make build
# or run the complete local quality gate
make verify
# read-only provider/environment capability probe
npm run probe:providers
# local Qdrant (localhost-only, persistent volume outside the repo)
make qdrant-up
# Python provider runtime (Graphiti, Tree-sitter, ast-grep, pygls)
make install-python-providers
```

`make lint` runs Airbnb TypeScript linting and Rust `rustfmt` plus Clippy with
warnings denied. Rust code is benchmark-gated and currently contains only its
validated extension point.

`npm audit --omit=dev --audit-level=high` is clean. Full dev-only audit currently
reports the legacy Airbnb/ESLint 8 dependency chain; npm's remediation requires a
breaking `@typescript-eslint` major migration, so it is not applied silently.

The test suite includes Bertrand Meyer-style contract tests in
`test/bertrand-contracts.test.ts`. They make preconditions, postconditions,
invariants, fail-closed behavior, losslessness, and layer boundaries executable.

The active OpenSpec implementation sequence is defined by
[`openspec/README.md`](openspec/README.md) and includes
`001-foundation` through `007-hybrid-context-engine`, including
`006-production-retrieval-vertical-slice`. The checked implementation tasks
do **not** replace frozen real-provider/agent-E2E/Harbor quality gates.

The [current H1–H6 completion plan](docs/plans/2026-10-21-cursor-like-hybrid-context-completion-plan.md)
prioritizes the [reviewed delivery/benchmark gaps](docs/reviews/2026-10-21-hybrid-context-static-code-review.md),
then reproducible multi-repository ablations, natural-use Harbor comparisons,
and separate Graphiti/Vertex/k3s/release evidence.

The parent `Consilium` repository is outside this project boundary and is not
modified by ACE implementation work.
