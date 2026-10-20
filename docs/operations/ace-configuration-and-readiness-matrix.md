# ACE configuration and readiness matrix

**Status:** operational reference. This document describes what the current runtime can do and, just as importantly, what each configuration is allowed to claim.

ACE has no `PRODUCTION=true` switch. Provider flags enable code paths; they do not approve models, providers, cloud scope, benchmarks, deployment security, or the combined system. Full code + documentation + memory production readiness is established only by the evidence-backed release preflight described in `docs/plans/unified-production-release-preflight.md`.

## Runtime modes

| Mode | Key configuration | Expected capability state | Allowed claim |
| --- | --- | --- | --- |
| Offline / provider-disabled | `ACE_ENABLE_EXPERIMENTAL_QDRANT=false` | code/unified context `not_ready` | MCP process/tool surface exists; no code retrieval readiness |
| Provider unavailable | Qdrant/embedding/structural provider is unavailable | code/unified context `not_ready` | No lexical substitute is composed into the production MCP runtime |
| Real local retrieval composition | `ACE_ENABLE_EXPERIMENTAL_QDRANT=true` plus Qdrant, embedding worker, ast-grep and LSP runtime | `ready` only after real startup preflights and complete index coverage; otherwise `degraded/not_ready` | measured real-provider path; still not production-approved merely because it starts |
| Temporal memory enabled | `ACE_ENABLE_GRAPHITI=true` plus archive, local Graphiti command/args/group | memory starts `degraded` until the real provider lifecycle is proven | local temporal-memory integration is available; production memory requires real lifecycle/deletion/recovery evidence |
| Vertex documentation enabled | `ACE_ENABLE_VERTEX=true`, `ACE_CLOUD_DOCS_OPT_IN=true`, project/corpus config | documentation configured as `degraded` until real retrieval evidence exists | explicitly authorized documentation retrieval only; source code remains current-behavior truth |
| Host worktree helper | `ACE_WORKTREE_HELPER_URL` plus workspace ID and mTLS CA/cert/key | worktree `ready` after authenticated helper creation | exact read-only host worktree boundary; production deployment still requires real k3s containment/race evidence |
| Full unified production | all selected providers + retained acceptance artifacts | release preflight `READY` | code + docs + memory may be called production-ready for the exact approved commit/capability scope |

A green process is not the same thing as a ready provider. `ace_workspace_status` is the runtime truth surface for configured capabilities; `ContextBundle.complete` is the per-request truth surface and is based on **required** source coverage, not on absence of thrown exceptions.

## Startup failure disposition

ACE intentionally distinguishes failures that make the process configuration itself unsafe from provider/capability failures that can be represented truthfully while the MCP process stays alive.

| Failure class | Process behavior | Capability/readiness behavior | Operator meaning |
| --- | --- | --- | --- |
| Invalid/missing mandatory base config, workspace registration/observation failure, invalid host-helper mTLS configuration | **fatal** — startup exits non-zero | no runtime readiness claim | configuration/trust boundary is unusable; fix before restart |
| Pinned embedding identity/configuration mismatch, corrupt snapshot state, or trust-boundary failure | **fatal** — startup exits non-zero | no semantic retrieval claim | requested identity cannot be proven; do not fall back silently |
| Transient embedding/provider timeout or unavailable startup probe | process stays alive | code/unified context = `not_ready` | retry/reconcile is required; provider failure is never promoted to `ready` |
| Corrupt workspace/provider identity state or semantic snapshot identity race | **fatal** — startup exits non-zero | no current-source claim | continuing could break source/provider truth |
| Selected LSP construction/preflight failure after the configured real composition is being built | **fatal** for an invalid/corrupt semantic snapshot; otherwise `not_ready` for a transient provider outage | no selected semantic-provider claim | selected semantic contract is unavailable; exact bytes may remain citable without current semantic confirmation |
| Qdrant collection unavailable with fallback disabled | process stays alive | code/unified context = `not_ready` | MCP/tool surface may still report status; code retrieval is unavailable |
| Qdrant collection unavailable with explicit local fallback enabled | process stays alive | code/unified context = `degraded` if fallback index builds, otherwise `not_ready` | development fallback only; never production semantic readiness |
| Required embedding/ast-grep executable missing before provider startup | process stays alive | code/unified context = `not_ready` | installation/runtime dependency missing |
| Structural index build or Qdrant population failure | process stays alive | code/unified context = `not_ready` | provider path exists but current index could not be made trustworthy |
| Partial index coverage from explicit file failures | process stays alive | code/unified context = `degraded` | evidence may be returned, but required code coverage is incomplete |
| Graphiti startup failure | process stays alive | memory = `not_ready` | code/docs can remain available; memory must not be represented as healthy |
| Graphiti initialized but not health/lifecycle-proven | process stays alive | memory = `degraded` | integration is present but production memory evidence is still missing |
| Vertex disabled or cloud opt-in absent | process stays alive | documentation = `disabled` | deliberate policy/config state, not a technical outage |
| Vertex enabled but config missing | process stays alive | documentation = `not_ready` | requested capability cannot start |
| Vertex configured but not provider-health-probed | process stays alive | documentation = `degraded` | configured path exists; real citation/provider acceptance still required |

**Invariant:** a fatal startup failure is reserved for cases where continuing would make identity, source truth, persistence, or the selected provider contract ambiguous. A non-fatal failure must be visible through `ace_workspace_status` as `disabled`, `not_ready`, or `degraded`; it must never be converted into `ready` merely to keep the process alive.

The k3s pod readiness probe checks container/config material only. It is not a provider-health probe and therefore cannot replace `ace_workspace_status` or release evidence.

## Working-tree reconciliation and source obligations

Before a context response can claim `complete`, the runtime compares the
authoritative workspace manifest (path, scope fingerprint, size/state and
content digest) with the manifest used to publish the `index_key`. This check
does not depend on watcher delivery. A changed, added, deleted or renamed path,
or an include/exclude scope change, makes the current provider `not_ready`
until reconciliation builds a new source generation; an old index is never
returned as a fresh `complete` result. Watchers may optimize when reconciliation
runs, but they are not the source of truth.

`ace_context` also accepts the backwards-compatible explicit plan:

```json
{"source_obligations":{"required":["code"],"optional":["documentation"]}}
```

The required and optional lists must not overlap. Explicit obligations take
precedence over deterministic routing, and the result exposes the source plan
and per-source coverage. `denied`, `unavailable`, `empty`, `partial`, and
`not_requested` remain distinct outcomes.

## Code retrieval

The current real local composition is:

```text
MCP -> ace_context
    -> embedding worker
    -> Qdrant
    -> exact workspace reread
    -> ast-grep structural anchor
    -> TypeScript Language Service confirmation
    -> final exact workspace reread
```

Minimum development configuration normally includes:

```bash
ACE_WORKSPACE_ROOT=/absolute/repo
ACE_ALLOWED_ROOTS=/absolute/allowed-parent
ACE_STATE_DIR=/absolute/state
ACE_WORKSPACE_ID=<stable-workspace-id>

ACE_ENABLE_EXPERIMENTAL_QDRANT=true
ACE_QDRANT_URL=http://127.0.0.1:6333
ACE_EMBEDDING_WORKER=$PWD/scripts/fastembed-worker.sh
ACE_AST_GREP_COMMAND=$PWD/node_modules/.bin/ast-grep
# Optional generic LSP override; the default is typescript-language-server --stdio.
ACE_LSP_COMMAND=$PWD/node_modules/.bin/typescript-language-server
ACE_LSP_ARGS='["--stdio"]'
ACE_LSP_SERVER=typescript-language-server
# Add mappings only for a server that really supports those languages.
ACE_LSP_LANGUAGE_IDS='{".rs":"rust"}'
```

`ACE_LSP_ARGS` and `ACE_LSP_LANGUAGE_IDS` are parsed as JSON at startup. Invalid
configuration fails closed. The runtime includes the command, arguments, server
version and semantic snapshot identity in the provider fingerprint. Structural
retrieval remains available for languages without an LSP; an `lsp` obligation for
such a language is `not_ready`, never silently satisfied by ast-grep output.

The name `ACE_ENABLE_EXPERIMENTAL_QDRANT` is intentional. It enables the real Qdrant-based runtime path; it does **not** mean the embedding or semantic provider has passed the production-selection gates.

For a release candidate, embedding identity must be pinned and match the worker's effective runtime identity. The relevant enforcement starts with:

```bash
ACE_REQUIRE_PINNED_EMBEDDING=true
```

and the configured model/artifact revision and digest values required by `ace-mcp.ts`. Production approval is still a separate evidence/owner decision.

For each workspace and embedding identity, ACE publishes a verified immutable Qdrant collection and exposes it through the native `..._current` alias. The collection name includes the effective provider/model/artifact digest, preprocessing, execution mode, runtime build/version and source `index_key`. A requested environment label therefore cannot place a different loaded artifact/runtime into the same collection namespace. The alias is the only read surface used by the production runtime; an unverified collection is never made current.

The production MCP runtime has no lexical fallback switch. Qdrant, embedding or structural-provider failure remains `not_ready`; local lexical providers are test/spike-only and cannot satisfy a production retrieval gate.

### Qdrant publication and cleanup

ACE does not use a filesystem snapshot-state database, reader/writer leases or an explicit collection override. A rebuild creates a separate content-addressed collection, verifies its count and membership, then switches the workspace/embedding `current` alias atomically. A crash before the switch leaves the previous alias target unchanged; a restart can publish the verified new collection. Unchanged vectors are reused from the previous alias by embedding content identity.

Obsolete collections may be removed asynchronously only after the deployment's bounded grace/retention policy proves that no current reader requires them. Cleanup must never delete the collection currently targeted by the alias. Qdrant snapshots, PVC backup and restore are separate operational evidence and are not replaced by ACE's publication protocol.

## Documentation / Vertex

Vertex is opt-in twice: the provider must be enabled and cloud document egress must be explicitly permitted.

```bash
ACE_ENABLE_VERTEX=true
ACE_CLOUD_DOCS_OPT_IN=true
ACE_VERTEX_PROJECT=<project>
ACE_VERTEX_CORPUS_ID=<approved-corpus>
ACE_VERTEX_LOCATION=europe-west4
```

The runtime obtains a short-lived `gcloud auth print-access-token` token at the boundary. Secret-like retrieval queries are denied before HTTP.

Cloud authorization is **provider + data-class scoped**, not merely provider-scoped. The built-in Vertex runtime policy permits only `project_document` for the `vertex` destination when `ACE_CLOUD_DOCS_OPT_IN=true`. `private_source`, `private_conversation` and `secret` are not inherited from that permission. A different external provider (for example the optional Jev experiment) requires its own explicit allowed data-class mapping.

Enabling Vertex therefore does not authorize source-code or private-dialogue upload. The approved synthetic/public fixture scope and any broader data scope are separate owner decisions.

## Temporal memory / Graphiti

Graphiti is local-first and independently enabled:

```bash
ACE_ENABLE_GRAPHITI=true
ACE_MEMORY_ARCHIVE_ROOT=/absolute/local/archive
ACE_GRAPHITI_COMMAND=<supported-local-graphiti-mcp-command>
ACE_GRAPHITI_ARGS_JSON='[...]'
ACE_GRAPHITI_GROUP_ID=<workspace-scoped-group>
```

The immutable archive is source truth. Graphiti is a derived projection/search layer. A successful enqueue can remain `pending`; durable retry/backoff/dead-letter/reconciliation exists, and manual repair is available through:

```bash
npm run memory:sync -- repair <episode-id>
```

Real Graphiti extraction, temporal recall, purge/recovery and local inference economics must still be retained as acceptance evidence before memory is production-approved.

## Host worktree helper / local k3s

When ACE runs away from the host process that owns the live worktree, use the authenticated helper rather than a writable hostPath:

```bash
ACE_WORKTREE_HELPER_URL=https://<host-helper>:7443/v1/worktree
ACE_WORKSPACE_ID=<registered-workspace>
ACE_WORKTREE_HELPER_TLS_CA=/run/ace-helper/ca.crt
ACE_WORKTREE_HELPER_TLS_CERT=/run/ace-helper/client.crt
ACE_WORKTREE_HELPER_TLS_KEY=/run/ace-helper/client.key
```

The host owns `workspace_id -> canonical root`; callers never supply an absolute host root. The required real-k3s containment/restart/race checks are in `infra/k8s/ace-local/HOST-WORKTREE-HELPER.md`.

## Selection and release gates

These commands prepare or evaluate evidence; none should be replaced by an assertion in documentation:

```bash
npm run compare:embeddings
npm run gate:embedding-selection -- ...
npm run compare:semantic-tsls
npm run test:real-non-ts-lsp
npm run gate:semantic-selection -- ...
npm run report:retrieval-quality -- ...
npm run gate:retrieval-quality -- ...
npm run gate:harbor-three-arm -- ...
npm run evidence:runtime-config -- ...
npm run evidence:resource-budget -- ...
npm run evidence:dbc -- ...
npm run release:preflight -- ...
```

The release preflight is fail-closed. For a hard release check:

```bash
ACE_REQUIRE_RELEASE_READY=true npm run release:preflight -- <policy.json> <evidence.json>
```

Full unified production readiness requires the exact release commit, all 14 DBCs, approved embedding and semantic choices, frozen retrieval quality evidence, natural-use Harbor evidence with complete cost telemetry, exact-commit runtime configuration and resource-budget evidence, real Graphiti/Vertex/k3s/operations/supply-chain evidence, and an owner-signed approval artifact verified against the configured trust-root public-key hash. A JSON field containing only `status: approved` is insufficient.

The historical 5× token-reduction target remains a product hypothesis. It is never inferred from a green preflight and is never backfilled from character counts or incomplete cost telemetry.
