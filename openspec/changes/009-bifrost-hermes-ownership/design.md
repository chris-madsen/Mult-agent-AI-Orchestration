# Design: gateway projection and host ownership

## Boundaries

- **Hermes host:** owns the durable transcript, tool/session lifecycle and host compaction state. It may append new turns, but strict ACE evidence compares pre-existing active rows by ID and digest.
- **ACE Core:** owns retrieval, source verification, policy, request-local context selection and projection receipts. It never mutates the durable transcript or worktree.
- **Bifrost/connector:** owns northbound provider compatibility, credentials, route selection, retries and final-send evidence. It must re-authorize every effective attempt.
- **MCP:** remains explicit tools only; it is not a hidden model-context projector.

## Request identity

`ace.gateway.v1` binds `requestId`, `attemptGroupId`, session/tenant/workspace scope, protocol, provider/model/route, original body SHA-256, projection mode and deadline. Workspace and data-class scope are trusted gateway assertions, not prompt or arbitrary-header input.

## Host attestation

Strict gateway or native ACE attribution requires:

- host build and attestor identities;
- actual active engine ID;
- normalized compression-control digest;
- durable active transcript revision/digest;
- `hostCompactionEpoch`, where `unknown` is never treated as zero;
- provider-managed-history capability;
- explicit `hostTranscriptAttested=true` and `compactionEnabled=false`.

A missing, stale, conflicting or cross-session attestation produces a typed block.

## Projection decision

The decision is one of `APPLY`, `UNCHANGED_AUTHORIZED`, `DEGRADED_AUTHORIZED` or `BLOCK`. `UNCHANGED_AUTHORIZED` is explicit and cannot be inferred from an ACE outage or parse failure. `APPLY` carries original and projected body digests, projection/receipt identities and the allowlisted route semantics.

## Compaction ownership

For strict H2/H3 trials the host configuration disables compression, micro-compaction, proactive pruning, idle compaction, provider-native hidden compaction and Codex app-server automatic compaction. Manual/forced compaction is denied or proven no-op. The runtime must report the effective engine at startup, resume, child spawn and model switch; a fallback engine or drift blocks strict attribution.

## Evidence

Receipts contain identities, digests, statuses, selected evidence IDs and failure codes only. They do not contain prompts, source bodies, credentials or raw provider payloads. Provider-wire evidence is a separate stage and cannot be closed by a domain port or mock-only test.

## G02 crosswalk — authenticated host attestation (REVIEW_REQUIRED)

This is a pre-code crosswalk for AC-SDLC-07, not an accepted authentication design. State remains `BLOCKED_OWNER_DECISION`; no T2 authentication implementation is authorized until the owner selects and approves the unresolved security boundary.

| Acceptance | Owner | Accepted decision | Interface/state | Phase | Deterministic oracle | Provider requirement | Rollback |
|---|---|---|---|---|---|---|---|
| `gateway-ownership` / trusted host ownership attestation | Repository owner for the trust model; Gateway, Bifrost and Hermes owners for their respective adapters; accountable owner confirmation is still required | **Unresolved.** Select authenticated principal source, proof (for example mTLS peer identity or a signed host assertion), binding to session/workspace/tenant, replay/expiry behavior, key rotation/trust roots, and permitted network boundary. Neither option is selected here. | `ace.gateway.v1` currently carries host identity and transcript/compaction claims but no cryptographic proof. The HTTP handler has no peer-identity/authentication check and defaults to loopback binding. The existing worktree-helper mTLS boundary is separate and is not assumed to authenticate Gateway requests. | G02 before any T2 code; after acceptance, implement only the approved boundary and prove it at final provider send. | Missing, invalid, expired, replayed, or misbound proof must return an accepted typed denial and produce zero provider attempts; valid proof must bind the exact session/workspace/tenant and request body. Exact error code and fixture values require owner approval. | Real credential/TLS or signing-key integration and the selected Bifrost/Hermes final-send route; mocks prove only contract behavior. | Fail closed: disable the strict Gateway route and return the accepted typed denial. Never fall back to unauthenticated attestation or label an outage as authorized success. |

### Owner decision required before T2

Choose the trusted principal and authentication proof, identify who provisions and rotates its trust material, specify the network boundary allowed to reach `/internal/ace-gateway/v1/project`, and define how the proof binds to the request's session, workspace and tenant. Until these are accepted, AC-SDLC-07 and the T2 part of AC-SDLC-08 remain `BLOCKED`.
