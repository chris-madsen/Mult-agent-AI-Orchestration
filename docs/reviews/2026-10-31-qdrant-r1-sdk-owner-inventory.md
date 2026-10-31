# R1 Qdrant SDK owner inventory

**Date:** 2026-10-31
**Inventory source:** clean `origin/main` at `13a64a8fe4240d68ff7ef2d453a857354585b51d`. PR #214 was open on branch `codex/qdrant-readback-contract-20261031` at head `1586c0c0ccd235371b8b7612e4975f4ad838e756`; its create-error correction does not move Qdrant SDK ownership.

## Reuse decision

Keep the pinned official `@qdrant/js-client-rest@1.20.0` as the only production transport. This slice is an ownership inventory, not permission to add a new transport or rebuild SDK behavior. Preserve ACE endpoint authorization, workspace/source checks, direct SDK DTO validation, snapshot membership proofs, and fail-closed result semantics around the SDK. No new dependency or custom Qdrant REST client is justified.

## Current call graph

| Concern | Current owner and evidence | Consequence for the R1 move |
|---|---|---|
| Application-facing retrieval/indexing port | `src/application/ports.ts:93-137` defines `CodeCandidatePort` (`search`, `upsert`, `deletePaths`, and optional `deleteWorkspaceVersions`). | Keep this provider-neutral port stable unless a separately approved contract change is required. |
| Candidate query and mutations | `src/adapters/http-provider-boundaries.ts:289-482`, `makeQdrantCodeCandidatePort`; direct SDK calls are `query` (`:341`), `upsert` (`:381`), and `delete` for changed paths/workspace versions (`:417`, `:459`). SDK call/completed-mutation validation and endpoint validation are also here (`:52-97`). | This is one of the two production files that directly invokes Qdrant SDK operations. Move the method bodies, not just forwarding methods, when centralizing ownership. |
| Collection, alias, count, membership, vector reuse | `src/adapters/qdrant-context-provider.ts`; direct calls include `getAliases` (`:261`, `:562`), `getCollections` (`:468`), `getCollection`/`createCollection` plus post-create read-back (`:520`, `:524`, `:534`), `updateCollectionAliases` (`:574`), exact `count` (`:612`), and paginated `scroll` (`:701`, `:759`). Membership/schema/vector validation remains in the same helper flows. | This is the second production file that directly invokes the SDK. Keep ACE validation and verification behavior while moving only the actual SDK operation ownership. |
| Runtime composition and credentials | `src/bin/ace-mcp.ts:379-395` validates the configured local endpoint and constructs the authenticated `QdrantClient`; it passes that client into the SDK-backed helpers and `makeQdrantCodeCandidatePort` (`:522`, `:688-702`, `:941-944`). No direct `qdrantClient.*` operation call was found in this composition root. | Preserve client creation, timeout, optional API-key handling, and endpoint policy at the composition boundary; do not mistake construction/injection for a second wire implementation. |
| Probe caller | `scripts/qdrant-hybrid-rank-probe.ts:105-114` validates the endpoint, constructs a client, and passes it to `makeQdrantCodeCandidatePort` (`:108-114`). It does not issue direct SDK operations. | Update this caller only if the chosen owner changes its public construction seam. Keep it as an evidence script, not a second adapter. |
| Test-only REST simulator | `test/helpers/qdrant-sdk-test-double.ts:5-78` maps a scripted `HttpPort` into SDK-shaped method results. It is the only test helper that constructs Qdrant REST URLs and unwraps the `{ result: ... }` fixture envelope. | Keep this compatibility logic test-only; production must continue to accept SDK DTOs, not REST envelopes. |

## Wire-path and dead-seam findings

- The production Qdrant operation calls found by the repository search are confined to `src/adapters/http-provider-boundaries.ts` and `src/adapters/qdrant-context-provider.ts`. `src/adapters/qdrant-context-provider.ts` contains no `http.request`, `fetch`, `/collections`, or `/points` Qdrant wire path.
- `src/adapters/http-provider-boundaries.ts` has a generic `makeFetchHttpPort` for other providers; that generic fetch implementation is not a Qdrant REST fallback.
- Several lifecycle helpers still accept and forward `HttpPort` although no Qdrant helper invokes `http.request`; `ensureQdrantCollection` also retains an `apiKey` parameter although the SDK client already owns authentication. These are stale call-signature seams, not an active second Qdrant transport. Remove them only with their callers in the focused owner-migration PR.
- The shared SDK-call/result wrappers currently live in `http-provider-boundaries.ts` and are imported by `qdrant-context-provider.ts`. A future single owner must avoid leaving direct SDK method bodies in both files or introducing a third pass-through owner.

## Existing contract coverage to preserve

- `test/qdrant-client.contracts.test.ts` covers candidate query/upsert/delete, direct SDK response shapes, rejection of raw REST envelopes and arrays, finite scores, collection schema/read-back, completed mutation status, alias/update failure, exact snapshot count, membership scroll, and vector reuse.
- `test/qdrant-alias.contracts.test.ts` covers alias publication and resolution with SDK-shaped doubles.
- `test/qdrant-real-pipeline.contracts.test.ts` covers lifecycle/read-back and concurrent creator behavior, plus changed-path publication contracts.
- `test/provider-and-multiprocess-contracts.test.ts` covers authenticated SDK-backed candidate operations and the local endpoint policy.
- The real-provider and concurrency/restart/crash gates remain separate from these deterministic contracts; this inventory does not claim those gates for the current main SHA.

## Next R1 implementation boundary

1. Choose one focused production SDK-operation owner before editing; use the official client directly there. The inventory does not silently select a new file or authorize a pass-through façade.
2. Move every direct operation listed above into that owner in one behavior-preserving slice, then delete the moved operation bodies from the former owner. Keep `CodeCandidatePort`, workspace scoping, local endpoint checks, exact schema/membership validation, and error distinctions intact.
3. Update the runtime composition, probe script, and SDK-shaped tests only where the chosen owner’s public seam requires it. Remove the now-unused `HttpPort`/`apiKey` arguments as part of that same callsite update, not as an independent cleanup.
4. Verify with the focused Qdrant command from the execution plan, `npm run verify:pr`, OpenSpec validation, and the real-provider gate on the exact clean SHA when its local dependencies are available. R1 remains open until only one production owner contains direct Qdrant SDK operation calls and the applicable real-provider evidence passes.

**Status:** the R1 inventory subtask is complete. The one-owner migration, provider acceptance for that migration, and R4 publication/crash/restart proof remain open. This review does not promote production readiness or benchmark claims.
