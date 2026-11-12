# Tasks

- [x] Define and validate the `ace.gateway.v1` request/decision/receipt contract.
- [x] Define and validate host attestation and compaction ownership evidence.
- [x] Add deterministic strict-block, replay, hidden-history and dual-owner scenarios.
- [x] Add request-local OpenAI Chat projection with preserved unknown fields and protected message groups.
- [x] Add Hermes effective-engine/config guard and sanitized ownership receipts.
- [x] Add the owner-selected **local-only** Bifröst connector with numeric loopback endpoint validation, redirect refusal and mocked contract/receipt capture; this is **not** process authentication or live final-provider wire evidence.
- [ ] Resolve explicit attested workspace/tenant ownership for any strict multi-tenant use; v1 has no tenant identity and the local-only route must not be claimed multi-tenant certified.
- [ ] Run pinned Hermes H1–H5 real-agent and matched Harbor trials.
- [ ] Keep provider-wire, agent-E2E, benchmark and owner-approval statuses separate.
