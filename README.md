# Adaptive Context Engine (ACE) Harness

ACE is an **agent-neutral hybrid context/RAG engine**, not an agent scheduler or a second LLM proxy. **Bifröst is the single agent-facing LLM Gateway** (ADR-017, ADR-021 and explicit owner decisions). Hermes already owns subscription OAuth; pinned Bifröst already provides ChatGPT/Codex native passthrough. The Go ACE plugin uses that existing route to call the **local context projection service** in ACE Core and apply verified context to the same outgoing native Responses request. ACE does not log into ChatGPT, select billing keys, perform provider generation or open a separate model proxy. Deterministic tests and the pinned Go plugin build are not proof of a real Hermes/provider E2E.


## Architecture at a glance

```text
Hermes (own ChatGPT/Codex subscription OAuth, native Responses input)
       |
       v
Bifröst (single LLM Gateway; existing ChatGPT/Codex passthrough)
       |  post-auth HTTP plugin intercepts the same POST
       +-- ACE Go connector -- local authenticated projection/attempt API
       |                        |
       |                     ACE Core (TypeScript + Effect)
       |                        |-- code: CBM + Qdrant dense/sparse + external LSP
       |                        |-- documents: authorized Vertex RAG
       |                        +-- durable archive / temporal provider readiness
       |                        |
       |                    additive context + signed receipt
       |
       +-- native request, guarded exact final bytes --> chatgpt.com
           Bifröst handles OAuth bearer forwarding, retries, streaming and response
```

**Status:** native Responses contracts and offline implementation exist. Final physical-provider wire, real Hermes agent loop, independent Harbor quality and release acceptance remain evidence-gated. Qdrant's necessity versus CBM-only has **not** been established; the existing runtime still requires Qdrant to compose code retrieval. See [source-verified architecture/status](docs/operations/current-architecture.md).

**Memory readiness:** Gateway-native Graphiti remains NOT_READY; the current runtime refuses its retired adapter even when the immutable archive is available.

Private source and conversations remain local by default; Vertex is a
**separately authorized documentation source**, never an implicit destination
for private code. Current verified source bytes outrank stale index data,
derived memory and documentation when determining actual program behavior.
The 5× accepted-task token reduction is a benchmark hypothesis, not a reported
achievement. See [ADR-017](docs/docs/references/ADR-017-bifrost-unified-llm-gateway.md), [ADR-014](docs/docs/references/ADR-014-hybrid-context-engine.md),
[OpenSpec 007](openspec/changes/007-hybrid-context-engine/),
and the [2026-10-21 targeted code review](docs/reviews/2026-10-21-hybrid-context-static-code-review.md).

## Source-verified Docker image

Build ACE in a clean Git checkout, then package and verify those exact compiled bytes. The Docker context excludes `.git`; the image never fabricates a commit identity.

```bash
make ace-image ACE_NODE_IMAGE='node:22-bookworm-slim@sha256:<verified-64-hex>' ACE_IMAGE_TAG=ace:local
```

The Make target runs `npm run build` before `docker build`. The image copies `dist/` and verifies `dist/runtime-provenance.json` against the copied source and `dist/bin/ace-runtime.js`. Packaging fails when provenance is missing or stale. This proves source/build identity only; it does not certify Bifröst final-provider delivery or agent E2E behavior.

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
- The former Hermes-native `ContextEngine` bridge is **retired** by the 2026-11-14 Gateway-only decision. Agent-side configuration must point at Bifröst, never a direct ACE context plugin.
- Codex/Hermes historical usage artifacts can still support read-only baseline comparisons; they do not certify Gateway delivery or activate an alternative integration.
- explicit unknown usage and unsupported external-provider cost records until
  Harbor/third-party contracts are verified;
- local lexical candidate retrieval retained for controlled experiments, not
  a substitute for production hybrid context;
- an experimental ACE context projection extension behind the Bifröst Gateway using native Codebase Memory v0.12.1 for AST, graph and semantic/BM25 discovery; Qdrant still performs dense/sparse retrieval and native RRF, with optional reranking and external LSP verification (TypeScript Language Server default); exact source rechecks and receipt/delta delivery are implemented;
  see `docs/reviews/2026-10-19-real-provider-e2e.md` for earlier exploratory
  evidence, not an approval of the latest code;
- immutable content-addressed archive, replay/tombstones and memory lifecycle mechanisms remain in the codebase; **Gateway-native Graphiti is NOT configured**: `ACE_ENABLE_GRAPHITI=true` fails startup intentionally in `src/bin/ace-runtime.ts`. Do not claim full memory retrieval/readiness;
- deterministic multi-source routing with an explicit, opt-in Jev boundary and
  required-source quality comparison;
- **Gateway-only automatic context injection** through the versioned HTTP projection endpoint; retrieval and exact expansion happen inside ACE, not via a model-invoked tool interface;
- typed local context/memory provider wiring; `not_ready` is returned only when
  no provider is injected, while unverified external providers remain blocked.
- deterministic comparison report artifacts in Markdown, JSONL and CSV with
  evidence hashes and explicit unknown measurements.
- typed Qdrant/Vertex/Graphiti/Jev HTTP boundaries and a Harbor CLI runner with
  policy-gated requests, response validation and retained failed-run evidence.
- TypeSpec-generated `ace.context.v3` native Responses projection/ownership contracts, deterministic
  request-local projection tests, a host-compaction ownership guard, an
  isolated Go connector and a pinned Bifrost mock-provider wire proof; real
  external-provider, agent-E2E and production gates remain separate.

Before enabling Gateway projection, configure a shared high-entropy secret in the ACE process (`ACE_CONTEXT_RPC_SHARED_SECRET`) and the Bifröst plugin (`ACE_CONTEXT_RPC_TOKEN`). Without it the projection POST endpoint returns `NOT_READY` (503); callers without the correct Bearer token receive 401. Model egress remains separately blocked until final-send authorization is certified. The local projector requires explicit provider policy before preparing private source context; that policy is not a send permit. Bifröst-visible request binding does not imply coding-host transcript/compaction attestation.

For the internal ACE context service, run `ACE_WORKSPACE_ROOT=/path/to/repo npm run context:rpc` and configure Hermes to use **Bifröst's existing** `/chatgpt_passthrough` base route; Bifröst calls the authenticated ACE local `ace.context.v3` context service. This local service is **not** another model Gateway. See [ChatGPT subscription runbook](docs/operations/gateway-subscription-oauth.md).
Without the real retrieval provider it exposes an honest `not_ready` status,
not a simulated production search. For the **experimental** local retrieval
path, forward the local k3s Qdrant port and configure:

```bash
ACE_WORKSPACE_ROOT=/absolute/path/to/repo
ACE_ENABLE_EXPERIMENTAL_QDRANT=true
ACE_QDRANT_URL=http://127.0.0.1:6333
ACE_EMBEDDING_WORKER=$PWD/scripts/fastembed-worker.sh
ACE_SPARSE_EMBEDDING_WORKER=$PWD/scripts/fastembed-sparse-worker.sh
# Codebase Memory v0.12.1 must be installed; optional native executable override:
# ACE_CBM_COMMAND=/absolute/path/to/codebase-memory-mcp
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

With local Qdrant, pinned CBM and embedding workers installed, `npm run test:real-projection` runs the real **ACE context RPC projection** against a local workspace. `npm run test:real-projection-race`, `npm run test:real-projection-outage` and `npm run test:real-projection-hard-outage` exercise changed-source and provider failure paths. These are local integration tests, not Bifröst final-provider egress or Hermes task acceptance.

`npm run test:memory-process` tests immutable archive identity and
cross-process safety. `npm run test:real-same-name` checks structural
spans and TypeScript language-service definitions/references.
`npm run test:ace-container-runtime -- --image <pinned>@sha256:<digest>
--bundle <dir>` probes compiled Gateway HTTP liveness inside a container;
the separate Bifröst provider-wire and real-agent trials are **not certified**.

Previously separate restart, two-writer, interrupted-publish, index-scale,
semantic holdout and tool-based container runners were retired with their
transport. Their equivalent **Gateway-native** E2E acceptance remains
explicitly **NOT-RUN**, not silently passed or replaced by static checks.

No production-approved embedding model/LSP, Graphiti extraction, Harbor quality
gate or 5× improvement is claimed until the documented provider spikes and owner
review are complete. The real-provider exploratory E2E is evidence, not a release
claim.

## Configuration and readiness

See [`docs/operations/ace-configuration-and-readiness-matrix.md`](docs/operations/ace-configuration-and-readiness-matrix.md) before enabling providers. In particular, `ACE_ENABLE_EXPERIMENTAL_QDRANT=true` selects the real local Qdrant composition but does **not** constitute production approval. The Gateway-only bootstrap does not silently replace unavailable Qdrant with a lexical provider; lexical fallback is a separate test/degraded capability, not a production readiness signal.

Full code + documentation + memory release readiness is evaluated by `npm run release:preflight -- ...`; there is no environment flag that turns an unverified provider set into a production-approved system.

## Local single-agent SDLC trial

For Codex and other repository-aware coding agents, use the thin ACE SDLC skill
at `.agents/skills/ace-sdlc/SKILL.md` (Codex alias:
`.codex/skills/ace-sdlc/SKILL.md`). It always loads the authoritative
`AGENTS.md`, existing ADR/OpenSpec, and the **complete** SDLC stage prompts.
Start with a read-only local preflight and its offline negative tests:

```bash
npm run test:sdlc-preflight
npm run sdlc:preflight -- --tier T0 --stage research --json
```

Before implementation on a task branch, provide explicit `--task-id` and an
existing `--plan`; for T2 also provide the existing `--g02` evidence path.
The tool blocks missing T2 evidence but cannot replace **human** G02 approval.
It never performs network access, commits, CI, provider E2E or automatic merge.
Follow [local agent SDLC trial](docs/operations/local-agent-sdlc-trial.md)
for an isolated worktree exercise, negative G02 scenario and evidence checklist.

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
# Optional Python provider/tooling dependencies (not ACE's structural parser)
make install-python-providers
```

Use `npm run check`, `npm run lint` and `npm run verify:pr` for the current TypeScript/architecture/SDLC code gates; inspect `Makefile` for additional local targets. CBM native indexing and real Hermes/Harbor evaluation are separate opt-in verification boundaries.

`npm audit --omit=dev --audit-level=high` is clean. Full dev-only audit currently
reports the legacy Airbnb/ESLint 8 dependency chain; npm's remediation requires a
breaking `@typescript-eslint` major migration, so it is not applied silently.

The test suite includes Bertrand Meyer-style contract tests in
`test/bertrand-contracts.test.ts`. They make preconditions, postconditions,
invariants, fail-closed behavior, losslessness, and layer boundaries executable.

Current active acceptance is tracked by [OpenSpec 013 (C01–C08)](openspec/changes/013-gateway-g11-production-acceptance/tasks.md) and [OpenSpec 014 (AR01–AR10)](openspec/changes/014-ace-audit-reliability-remediation/tasks.md). Historical 001–007 and H1–H6 plans remain historical sources, not an alternative implementation queue. See [the current runtime status](docs/operations/current-architecture.md), the [CBM provider](docs/operations/codebase-memory-provider.md), and the [testing strategy](docs/operations/testing-strategy.md).


The parent `Consilium` repository is outside this project boundary and is not
modified by ACE implementation work.
