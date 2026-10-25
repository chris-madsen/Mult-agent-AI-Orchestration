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
