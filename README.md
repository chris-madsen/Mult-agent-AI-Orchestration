# Adaptive Context Engine (ACE) Harness

ACE is an external, agent-neutral context harness for Codex. The repository
contains the project documentation under `docs/` and the first implementation
slice under `src/`.

## Current implementation

`001-foundation` is partially implemented in TypeScript + Effect; provider-independent
cores for `003`–`005` are also implemented:

- validated workspace identity and working-tree observations;
- canonical path and symlink containment checks;
- tracked/untracked/removed path awareness for Git worktrees;
- revision-checked exact reads with digest and race detection;
- versioned local data policy and secret-safe audit records;
- exact artifact storage with lossless pagination;
- provider-independent evaluation core with frozen suites, BenchmarkRun FSM,
  cumulative/delta usage normalization and quality-gated reports;
- Codex JSONL usage boundary adapter requiring verified event identity and
  counter semantics;
- explicit unknown usage and unsupported external-provider cost records until
  Harbor/third-party contracts are verified;
- local lexical code-candidate retrieval with generation, range, source digest,
  stale detection, a filesystem-backed exact-read indexer and evidence-preserving
  `ContextBundle`;
- an experimental real-provider `ace_context` composition using local FastEmbed
  / ONNX Runtime, Qdrant, Tree-sitter structural spans and TypeScript Language
  Service verification; see `docs/reviews/2026-10-19-real-provider-e2e.md`;
- immutable content-addressed session archive with idempotent replay, tombstones,
  temporal memory search and confirmation-gated decision FSM;
- deterministic multi-source routing with an explicit, opt-in Jev boundary and
  required-source quality comparison;
- one ACE gateway with a standards-shaped JSON-RPC MCP stdio transport and
  `ace_context`, `ace_expand`, `ace_workspace_status` and `ace_memory_search`
  tool contracts;
- typed local context/memory provider wiring; `not_ready` is returned only when
  no provider is injected, while unverified external providers remain blocked.
- deterministic comparison report artifacts in Markdown, JSONL and CSV with
  evidence hashes and explicit unknown measurements.
- typed Qdrant/Vertex/Graphiti/Jev HTTP boundaries and a Harbor CLI runner with
  policy-gated requests, response validation and retained failed-run evidence.

Run the degraded local transport with `ACE_WORKSPACE_ROOT=/path/to/repo npm run mcp:stdio`.
For the real local retrieval experiment, first forward the k3s service and set
`ACE_ENABLE_EXPERIMENTAL_QDRANT=true`, `ACE_QDRANT_URL=http://127.0.0.1:6333`,
`ACE_EMBEDDING_WORKER=$PWD/scripts/fastembed-worker.sh`,
`ACE_TREE_SITTER_HELPER=$PWD/scripts/tree-sitter-structural.py` and
`ACE_TREE_SITTER_PYTHON=$PWD/.venv-system/bin/python`. The bootstrap is read-only,
indexes only allowlisted source extensions and excludes dependency/build
directories. Vertex documentation is separately opt-in with
`ACE_ENABLE_VERTEX=true`, `ACE_VERTEX_PROJECT`, `ACE_VERTEX_CORPUS_ID` and the
Europe default `ACE_VERTEX_LOCATION=europe-west4`.

No production-approved embedding model/LSP, Graphiti extraction, Harbor quality
gate or 5× improvement is claimed until the documented provider spikes and owner
review are complete. The real-provider exploratory E2E is evidence, not a release
claim.

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

The implementation sequence is defined by `docs/openspec/README.md`:

1. `001-foundation`
2. `002-harbor-evaluation`
3. `003-unified-retrieval`
4. `004-temporal-memory`
5. `005-adaptive-routing-spike`

The parent `Consilium` repository is outside this project boundary and is not
modified by ACE implementation work.
