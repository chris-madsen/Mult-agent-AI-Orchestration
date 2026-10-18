# Implementation Tasks — Evidence-based Jev strategy selector experiment

**State: PARTIALLY IMPLEMENTED.** The deterministic reference router, privacy gate,
comparison evidence and negative quality path are implemented. Jev remains an
explicit experimental provider and is not enabled by default; see
`docs/docs/spikes/SPIKE-ADAPTIVE-ROUTING.md`.

## Experiment definition
- [x] Freeze the deterministic route contract and source requirements for exact, memory and multi-source requests.
- [x] Verify Jev API version, contract, pricing and allowed data categories; read-only probe confirms the public `/v1/models` and POST-only `/v1/systemone` surfaces, while authenticated execution remains absent and private code is blocked by default.
- [x] Implement deterministic policy and an experimental Jev candidate behind explicit opt-in and adapter injection.

## Run evaluation
- [x] Compare candidate required-source coverage, not just route-label equality.
- [ ] Run repeated Harbor e2e tasks with Jev vs rule routing using equal model/context baseline.
- [x] Preserve unavailable/blocked candidate outcomes and route misses as evidence.
- [ ] Measure provider usage, full cost, retries and wall time after Jev/Harbor contracts are verified.

## Decision gate
- [ ] Publish comparative study and constraints, including any negative result from a real Jev run.
- [ ] Propose a new ADR if Jev is superior under predefined acceptance criteria; otherwise leave deterministic policy active.

## Exit criteria

- [x] Provider-independent routing scenarios have executable contract coverage.
- [x] Privacy and provider failure tests pass; no unapproved Jev request is sent.
- [x] Domain dependencies comply with module boundaries and accepted ADRs.
- [ ] Review the change with the owner; do not enable Jev production-default behavior without approval.
