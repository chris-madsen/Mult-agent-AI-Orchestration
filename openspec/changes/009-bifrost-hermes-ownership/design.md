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

## G02 crosswalk — local-only Gateway boundary (OWNER_DECIDED)

On 2026-11-12 the repository owner selected loopback as the Gateway trust boundary for the local deployment. The local host is trusted; per-process authentication and mTLS are explicitly out of scope. This does not protect against hostile processes already running on the host, and it does not establish provider-wire or agent-E2E evidence.

| Acceptance | Owner | Accepted decision | Interface/state | Phase | Deterministic oracle | Provider requirement | Rollback |
|---|---|---|---|---|---|---|---|
| `gateway-ownership` / local Gateway boundary | Repository owner for the local trust model; Gateway and Bifrost owners for listener and connector behavior | **Accepted:** the Gateway listener and Bifrost projection endpoint are loopback-only; the local host is trusted; no process authentication or mTLS. The current code checks host `sessionId` against `agentSessionId`; it also checks the transform result's workspace ID against the request workspace. Neither check authenticates the caller, and `ace.gateway.v1` has **no tenant ID or tenant attestation field**. Explicit tenant isolation and independent workspace attestation remain **NOT_IMPLEMENTED**: this local-only slice cannot be certified for multi-tenant strict attribution. | `ace.gateway.v1` retains host identity and transcript/compaction claims. The HTTP entrypoint binds only numeric loopback sockets (converting `localhost` to `127.0.0.1`); its unbound Server factory is private. The Go connector requires numeric loopback endpoint addresses (not DNS hostnames) and rejects **all HTTP redirects**, including redirects to other loopback services. No cryptographic process identity or tenant isolation is claimed. | Owner decision precedes implementation; local contract tests establish the selected boundary. Provider-wire and agent-E2E stages remain separate and unrun. | Non-loopback listener fails before listen; invalid/non-numeric endpoint fails before HTTP I/O; HTTP redirects are not followed; malformed/empty bridge-ready identities fail startup. This is a local listener/connector/bridge contract oracle, not tenant or provider-wire proof. | Local contract tests only. They do not establish final provider-send evidence, provider-wire certification, or agent-E2E behavior. | Fail closed: do not start the Gateway or send projection data when the configured endpoint is not loopback. |

| `gateway-ownership` / strict tenant-bound attestation | Repository owner; session/workspace/tenant and Gateway contract owners | **BLOCKED / NOT_SELECTED for multi-tenant use:** v1 does not carry tenant identity or attested workspace identity. No process-auth proof is selected for a future multi-tenant trust boundary. | The current `attestation.sessionId === agentSessionId` check and transformed workspace echo are not a tenant authority; do not infer independent host authorization. | Separate future T2, G02 and versioned wire-contract migration, not part of this local-only implementation. | Pending RED: tenant mismatch/omission must never become `APPLY` in a strict multi-tenant route. No current v1 oracle can demonstrate tenant identity that does not exist. | Real provider-send attempt gating and trusted identity source required before any multi-tenant claim. | Keep multi-tenant strict mode unsupported; never fall back to treating host-local data as tenant authorization. |

### Evidence limits

**Unresolved tenant/workspace proof:** `ace.gateway.v1` contains `workspaceId` only as a request assertion, with no `tenantId`, and `HostCompactionAttestation` has only `sessionId`, not an attested workspace or tenant. The service validates session equality and a returned workspace ID, but this is not a trusted per-tenant host attestation. Strict multi-tenant authorization remains **BLOCKED/NOT-IMPLEMENTED** pending an accepted contract/design and real boundary verification. Do not count AC-SDLC-07 as complete multi-tenant authentication.

The local-only decision and loopback contract do not authenticate individual local processes. Any deployment that exposes the Gateway beyond loopback requires a new owner decision before code changes. Provider-wire, agent-E2E and benchmark evidence remain independently `NOT-RUN` until their real integrations are exercised.
