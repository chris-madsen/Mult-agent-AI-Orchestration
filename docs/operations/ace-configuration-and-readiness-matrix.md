# ACE configuration and readiness matrix

**Status:** operational reference. This document describes what the current runtime can do and, just as importantly, what each configuration is allowed to claim.

ACE has no `PRODUCTION=true` switch. Provider flags enable code paths; they do not approve models, providers, cloud scope, benchmarks, deployment security, or the combined system. Full code + documentation + memory production readiness is established only by the evidence-backed release preflight described in `docs/plans/unified-production-release-preflight.md`.

## Runtime modes

| Mode | Key configuration | Expected capability state | Allowed claim |
| --- | --- | --- | --- |
| Offline / provider-disabled | `ACE_ENABLE_EXPERIMENTAL_QDRANT=false` and `ACE_ALLOW_LOCAL_FALLBACK=false` | code/unified context `not_ready` | MCP process/tool surface exists; no code retrieval readiness |
| Explicit degraded local fallback | `ACE_ALLOW_LOCAL_FALLBACK=true` | code/unified context `degraded` | local lexical/structural fallback for development; **not** production semantic retrieval |
| Real local retrieval composition | `ACE_ENABLE_EXPERIMENTAL_QDRANT=true` plus Qdrant, embedding worker, Tree-sitter and TS-LS runtime | `ready` only after real startup preflights and complete index coverage; otherwise `degraded/not_ready` | measured real-provider path; still not production-approved merely because it starts |
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
| Pinned embedding identity/receipt mismatch or embedding provider preflight failure | **fatal** — startup exits non-zero | no semantic retrieval claim | requested provider identity cannot be proven; do not fall back silently |
| Snapshot manifest/lease persistence invariant failure or semantic snapshot identity race | **fatal** — startup exits non-zero | no current-source claim | continuing could break source/snapshot truth |
| TypeScript Language Service construction/preflight failure after the selected real composition is being built | **fatal** — startup exits non-zero | no selected semantic-provider claim | selected semantic contract is unavailable |
| Qdrant collection unavailable with fallback disabled | process stays alive | code/unified context = `not_ready` | MCP/tool surface may still report status; code retrieval is unavailable |
| Qdrant collection unavailable with explicit local fallback enabled | process stays alive | code/unified context = `degraded` if fallback index builds, otherwise `not_ready` | development fallback only; never production semantic readiness |
| Required embedding/Tree-sitter executable missing before provider startup | process stays alive | code/unified context = `not_ready` | installation/runtime dependency missing |
| Structural index build or Qdrant population failure | process stays alive | code/unified context = `not_ready` | provider path exists but current index could not be made trustworthy |
| Partial index coverage from explicit file failures | process stays alive | code/unified context = `degraded` | evidence may be returned, but required code coverage is incomplete |
| Graphiti startup failure | process stays alive | memory = `not_ready` | code/docs can remain available; memory must not be represented as healthy |
| Graphiti initialized but not health/lifecycle-proven | process stays alive | memory = `degraded` | integration is present but production memory evidence is still missing |
| Vertex disabled or cloud opt-in absent | process stays alive | documentation = `disabled` | deliberate policy/config state, not a technical outage |
| Vertex enabled but config missing | process stays alive | documentation = `not_ready` | requested capability cannot start |
| Vertex configured but not provider-health-probed | process stays alive | documentation = `degraded` | configured path exists; real citation/provider acceptance still required |

**Invariant:** a fatal startup failure is reserved for cases where continuing would make identity, source truth, persistence, or the selected provider contract ambiguous. A non-fatal failure must be visible through `ace_workspace_status` as `disabled`, `not_ready`, or `degraded`; it must never be converted into `ready` merely to keep the process alive.

The k3s pod readiness probe checks container/config material only. It is not a provider-health probe and therefore cannot replace `ace_workspace_status` or release evidence.

## Code retrieval

The current real local composition is:

```text
MCP -> ace_context
    -> embedding worker
    -> Qdrant
    -> exact workspace reread
    -> Tree-sitter structural anchor
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
ACE_TREE_SITTER_HELPER=$PWD/scripts/tree-sitter-structural.py
ACE_TREE_SITTER_PYTHON=$PWD/.venv-system/bin/python
```

The name `ACE_ENABLE_EXPERIMENTAL_QDRANT` is intentional. It enables the real Qdrant-based runtime path; it does **not** mean the embedding or semantic provider has passed the production-selection gates.

For a release candidate, embedding identity must be pinned and match the worker's effective runtime identity. The relevant enforcement starts with:

```bash
ACE_REQUIRE_PINNED_EMBEDDING=true
```

and the configured model/artifact revision and digest values required by `ace-mcp.ts`. Production approval is still a separate evidence/owner decision.

If `ACE_ALLOW_LOCAL_FALLBACK=true`, Qdrant/provider failure may fall back to the explicitly degraded local path. This flag must never be used to turn a failed production dependency into a silent `ready` state.

### Qdrant snapshot ownership and garbage collection

The default Qdrant collection name includes a persistent random **state-owner ID** stored under the configured `ACE_STATE_DIR`. Two ACE processes using different state directories therefore do not share the same automatic-GC namespace even when they point at the same Qdrant service.

Snapshot lease cleanup is conservative by default:

```bash
ACE_QDRANT_LEASE_REAP_MODE=conservative
```

In this mode a valid lease file is never deleted merely because its PID appears dead. This is intentional: PID liveness is not portable across hosts, containers, or PID namespaces. A crashed reader can leave an old snapshot retained, but a live remote reader is not destroyed by a false `ESRCH`.

`ACE_QDRANT_LEASE_REAP_MODE=local-process` may be used only when the operator guarantees that all processes sharing that state directory are in the same PID namespace and local process-liveness checks are authoritative.

If `ACE_QDRANT_COLLECTION` is set explicitly, ACE treats it as potentially shared and skips automatic snapshot GC unless:

```bash
ACE_QDRANT_COLLECTION_EXCLUSIVE_OWNER=true
```

That flag is an operator assertion, not auto-detection. Do not set it for a collection shared by independent state roots.

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

Full unified production readiness requires the exact release commit, all 14 DBCs, approved embedding and semantic choices, frozen retrieval quality evidence, natural-use Harbor evidence with complete cost telemetry, exact-commit runtime configuration and resource-budget evidence, real Graphiti/Vertex/k3s/operations/supply-chain evidence, and explicit owner approval.

The historical 5× token-reduction target remains a product hypothesis. It is never inferred from a green preflight and is never backfilled from character counts or incomplete cost telemetry.
