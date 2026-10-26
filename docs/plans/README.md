# ACE execution plans

**Canonical consolidated plan:** [2026-10-19 — Unified correctness and production completion](./2026-10-19-unified-ace-correctness-and-production-plan.md).

The unified plan merges the five post-merge correctness tracks with the full ACE production completion backlog. Use its single ordered PR queue, evidence gates and dependency graph, subject to Accepted ADRs and OpenSpec.

**Scoped benchmark remediation (proposal, not a competing production queue):**
- [2026-10-26 — ACE/Hermes token-economics and benchmark cleanup plan](./2026-10-26-ace-hermes-economics-and-cleanup-plan.md) — one real Hermes A/B first, root `plan.md` approval entrypoint, separate dependency-backed cleanup; paired [review](../reviews/2026-10-26-ace-hermes-token-economics-and-benchmark-bloat-review.md). Tracked in Issue #171. **Not yet owner-approved or real-provider-tested.**

**Scoped new architecture work (not a competing production queue):**
- [2026-10-24 — Unified Bifrost LLM Gateway for ACE](./2026-10-24-bifrost-unified-llm-gateway-plan.md) — owner-selected gateway direction, proposed independent Go connector ↔ TypeScript ACE interface, provider-wire fidelity/spike, security and staged delivery. Its exact production gates remain unapproved until separate evidence.

**Retained source plans (historical, not competing execution queues):**
- [Claude: post-merge correctness plan](./2026-10-19-post-merge-correctness-plan.md)
- [Prior ACE production completion roadmap](./2026-10-19-ace-production-completion-roadmap.md)

A plan item marked `[ ]` is open until verified by evidence. Experimental E2E, green CI and forced-use Harbor results are **not** production acceptance.
