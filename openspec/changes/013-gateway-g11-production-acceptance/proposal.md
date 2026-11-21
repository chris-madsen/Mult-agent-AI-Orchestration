# Proposal — native Responses-only G11 implementation plan

## Why

ACE's agent-facing integration is being migrated to **Hermes → Bifröst native `/v1/responses` → ACE context extension v2** as the only supported context-delivery route. The owner has explicitly directed removal of the previous projection contract, generated artifacts, runtime adapters and repository compatibility implementations, with semantically equivalent Responses behavior and no fallback to another protocol. Existing CI and simulated stage handoffs do not prove a real Hermes loop or physical provider send.

## What changes in this planning-only revision

- Reconcile the existing change 013 to the accepted native Responses target instead of creating a parallel issue tracker or second OpenSpec change.
- Retain G11-001…G11-020 acceptance IDs and RESP-001…RESP-008 for the native contract, lossless tool/reasoning fidelity, physical-send gate, privacy and agent evidence.
- Update `design.md` with the current implementation baseline, native Responses-only target, Functional DDD / TypeSpec v2 decisions and the owner-approved C01 crosswalk.
- Re-slice the 28 acceptance IDs into a minimal dependency DAG and executable source/test-owned `phases/C01.md`…`phases/C08.md` using the existing SDLC mechanism. Forecasts are estimates of handwritten changed LOC, not executed work.
- Keep Gateway-only authority, Harbor baseline and accepted security/DDD decisions. TypeSpec-generated Gateway v2 is the only active projection contract; do not retain the previous projection ABI as a runtime or generated compatibility surface.

## Boundaries

**Implementation plan.** Owner approval covers the C01 contract and retirement behavior only. This approval does not authorize provider requests, model egress, Hermes/Harbor trials or production promotion. Local tests and structural phase checks do not prove physical-send security, OAuth compatibility or a real Hermes loop.

**Accepted architecture direction:** native Responses only; one Bifröst context-delivery path; no model-invoked ACE tools, extra reverse proxy, protocol conversion or provider bypass; `store:false` enforced at final egress where private source is involved.

**Open G02/provider decisions:** a supported Bifröst final physical-dispatch hook across retries/extraAttempts, pinned OAuth/model/effort/window/counter, safe provider-held continuation rules and owner-authorized egress are unverified. Any dependent implementation phase MUST stop until resolved and reviewed. The prior #271/#273 heads were unmerged fail-closed prototypes, not accepted or currently active runtime.

## Capabilities and success

Modified in-place: `gateway-final-wire`, `gateway-streaming`, `gateway-attempt-reauthorization`, `gateway-real-agent-and-economics`. Added within the same change: `gateway-native-responses`.

Success of this **planning PR** means: every G11 and RESP scenario mapped to exactly one canonical chunk, current design/spec fingerprints in every executable brief, no cycles or orphan files, strict OpenSpec and all eight phase structure checks passing, and independent G02 still marked REVIEW_REQUIRED. **No** real agent, provider, Harbor or production acceptance follows.
