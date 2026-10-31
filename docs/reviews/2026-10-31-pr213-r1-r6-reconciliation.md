# Qdrant PR #213 and R1/R6 reconciliation

**Date:** 2026-10-31
**Purpose:** reconcile the merged Qdrant PR, record the verified correction, and distinguish remaining R1/R6 work from completed evidence. This review does not promote production readiness or benchmark claims.

## Source and merge evidence

- `origin/main` was fetched at `13a64a8fe4240d68ff7ef2d453a857354585b51d`, the merge commit for PR #213. PR head: `49ba11c65bde97b822110a22ed0f0f29b6167aba`.
- PR #213 contains four commits. Its check rollup was mixed: `contracts` failed; `bifrost-connector`, `real-qdrant`, and `real-non-ts-lsp` passed.
- The failed contracts job used merge ref `e7e6be5aaea19e1408b3fdbc45e202977af8d8c0` and ran 122 tests: 121 passed, one failed at `test/qdrant-real-pipeline.contracts.test.ts:279` (`Qdrant collection bootstrap is additive and rejects mismatched dimensions`).
- The failing fixture returned 404 for every GET. The merged implementation correctly performs a second GET after successful collection creation to verify the actual schema, so the fixture never modeled the successful read-back. This was a stale test fixture, not evidence that schema verification should be removed.

## Corrections made on the follow-up branch

- `test/qdrant-real-pipeline.contracts.test.ts` now models initial GET 404, successful PUT, and a second GET returning the direct SDK collection schema. It asserts the `GET, PUT, GET` sequence and retains the wrong-dimension rejection case.
- `src/adapters/qdrant-context-provider.ts` previously assigned the create result but ignored it. `npm run verify:pr` on the clean follow-up commit first exposed the resulting ESLint `no-unused-vars` failure. The fix now proceeds to read-back only after a successful create or a 409 concurrent-create conflict; other create failures are returned rather than being hidden by a later schema read.
- `test/qdrant-client.contracts.test.ts` covers a non-conflict create failure even when a later mock read could return a valid schema. It verifies the error is not converted into readiness.
- The focused correction is on code source commit `cbe39f133bf49a5e0463835973da19a99ea02f2a`; it does not consolidate the two production SDK owners and therefore does not close R1.

## Verification bound to the follow-up source commit

- Focused Qdrant/retrieval contracts: 92 passed, 0 failed.
- `PYTHONDONTWRITEBYTECODE=1 npm run verify:pr`: passed on `cbe39f133bf49a5e0463835973da19a99ea02f2a`; 700 TypeScript tests and 20 Hermes context-plugin tests passed. Check, lint, and build passed. Build provenance reported `sourceCleanAtBuild=true` and `dirtyRelevantPaths=[]`.
- `openspec validate --all --strict --no-interactive --report full`: 9 passed, 0 failed.
- `npm run test:real-provider`: passed on the same source commit against local Qdrant at `http://127.0.0.1:6333`, using the synthetic 2,000-line fixture. The result reported `complete=true`, current citation `service.ts:1-25`, and exact expansion of 63,482 bytes. The runner used the existing local FastEmbed environment and a cache copied into scratch; the primary worktree was not modified. This is provider-path evidence only, not Bifrost wire or Hermes-agent E2E evidence. The run did not retain the Qdrant server version or model-artifact digest, so those identities remain unknown for this observation.
- An initial real-provider invocation without the local embedding environment returned `not_ready` / `embedding_provider_unavailable`; no provider result was claimed from that attempt. The subsequent run supplied the existing local Python environment and copied cache outside the source worktree and passed.

## Execution corrections and remaining acceptance

### R1 — Qdrant SDK boundary: still open

- PR #213 removes the raw REST response-envelope fallback and adds schema/read-back and finite-score protections. The follow-up corrects its failing test fixture and propagates non-conflict create errors.
- `src/adapters/http-provider-boundaries.ts` and `src/adapters/qdrant-context-provider.ts` still both directly own Qdrant SDK operations. `src/bin/ace-mcp.ts`, `scripts/qdrant-hybrid-rank-probe.ts`, and the adapter/real-pipeline suites remain caller surfaces to inventory before any one-owner move.
- The R1 one-owner exit criterion and the broader R4 concurrent publication/crash/restart proof are not met by this PR or by the focused real-provider pass.

### R6 — full Hermes through Bifrost Responses: blocked/incomplete

- Counter/window: `src/bin/ace-mcp.ts` still constructs `makeContextAssembler()` without a verified model-compatible counter; `src/application/gateway-projection-service.ts` still derives the budget from the request deadline. The exact counter and effective context window for `openai-codex/gpt-6-luna` with separate `reasoning_effort=xhigh` remain unverified.
- The current ACE gateway advertises only `openai.chat.completions`; `/internal/ace-gateway/v1/record-delivery` still returns 501; `PostLLMHook` still passes the response through without a final usage receipt. No Responses provider-wire or final-egress receipt has been proven.
- The full Hermes CLI path through Bifrost `/v1/responses`, Hermes-owned Codex OAuth without an API key, exact `reasoning_effort=xhigh`, privacy-safe `store:false`, final-wire identity, and a matched Hermes pair remain unverified. Chat Completions is not an acceptable route or fallback.
- As checked on 2026-10-31, Bifrost PRs #4548 (OAuth pass-through for Responses), #8008 (caller OAuth preservation), and #9142 (terminal Responses usage) remained open. The latest review evidence for #4548 reports a raw-body path that may bypass `store:false`; do not merge, pin, or use that path until the current implementation proves the privacy invariant. No experimental pin or private-code egress approval is recorded.

## Process lessons

- A merged PR is not a passed PR: verify the exact merge SHA and every required check. PR #213 was merged with its `contracts` job failing; that failure had to be investigated rather than summarized as “three checks passed.”
- A local test count or lint/build pass is not agent-facing or provider-wire proof. Bind each result to its source SHA and report provider, Hermes E2E, benchmark, and owner-approval stages separately.
- Do not label a partial Qdrant compatibility cleanup as completion of the one-owner R1 requirement.
- Do not recommend merging or consuming an upstream Responses PR until its privacy and final-usage paths have been checked at the latest head.

**Disposition:** the Qdrant fixture/creation-error correction is implemented and locally verified on `cbe39f1`. It does not close R1 one-owner completion, R6 Responses delivery, final usage receipts, Hermes-agent E2E, benchmark evaluation, or owner approval.
