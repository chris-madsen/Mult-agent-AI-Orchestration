---
name: ace-to-tickets
description: Automatically size ACE OpenSpec implementation slices around 1,000 changed handwritten lines per fresh agent context, preserving vertical tracer bullets, acceptance coverage, G02 and evidence gates without a granularity interview.
---

# ACE To Tickets — automatic one-pass implementation slicing

Use this **ACE-specific planning skill** whenever the owner asks to turn accepted or drafted requirements/specs into implementation phases, asks for `to-tickets`, or enters the ACE SDLC Plan stage for T1/T2 work. This is a one-agent instruction workflow, not an autonomous task runner, estimator or proof of agent execution. **Do not implement source code in this skill.**

## Authority and inputs

1. Read root/scoped `AGENTS.md`, `.agents/skills/ace-sdlc/SKILL.md`, the complete vendored `.agents/skills/to-tickets/SKILL.md`, and `.agents/skills/ace-sdlc/references/matt-pocock-compatibility.md`. Read `docs/operations/ai-assisted-sdlc.md`, the **reviewable existing-architecture-first `.agents/skills/ace-architecture-design/SKILL.md` result in `design.md`**, accepted ADRs/OpenSpec specs, existing `tasks.md`, and `docs/research/sdlc/source/templates/phase-template.md`. Never use To-tickets to invent the architecture after decomposition.
2. Inspect **current** source, owning tests, provider/client integration seams, actual dependency graph, merged/open PRs and earlier phase results before estimating. Reuse the existing OpenSpec change; never fork a second spec, issue queue, `.scratch` tracker or implementation orchestrator. Apply the normal ACE preflights and safe task branch/worktree rules before writes.
3. Use an actual host Skill invocation when supported. When the host lacks that capability, read/apply the full skill texts and report `Skill invocation: NOT_OBSERVED`; never claim that an LLM skill invocation happened because a Markdown file was read.

## Default size budget — no recurring granularity interview

**Owner default: approximately 1,000 changed lines per single fresh-context implementation pass, including tests.** Treat **700–1,200 forecast handwritten changed lines** as a comfortable planning band, *not* a hard limit, quota or justification for unrelated code. Count predicted added **plus deleted** lines of source, tests, scripts, config and relevant hand-edited documentation. Note generated/vendor bulk separately and account for its review/test burden; never hide manual complexity in an excluded category.

- **Under ~700:** proactively merge adjacent or related slices when together they remain a coherent, independently provable vertical behavior and fit the same trust/security boundaries. Small standalone real-provider trials, security gates, independent owner decisions, blocked external dependencies and truly complete changes may remain smaller. Never add filler or unrelated scope to hit a number.
- **~700–1,200:** preferred when the vertical slice and independent RED/GREEN/provider oracles fit one fresh context and one focused PR.
- **~1,200–1,500:** permissible only when the slice remains demonstrably one-pass; record the reason and how tests/review fit. Above **~1,500** forecast handwritten changed lines, split by another independently verifiable user-visible boundary unless this is an indivisible safe expand–contract migration; document the exception and its integration gate.
- **Risk trumps LOC:** split much earlier if a slice spans incompatible trust boundaries, unrelated contract changes, uncontrolled upstream hooks, several owner approvals or multiple expensive/long-lived external trials. A 100-line new concurrency/authorization boundary may be harder than a 1,000-line mechanical change. Never weaken G02, authorization, G11, secret handling or test depth for the target.
- **Forecast, not measurement:** LOC estimates are approximate until implementation. Do not claim a plan is mechanically proven to fit a context window. If implementation discovers a genuinely larger blast radius, checkpoint the outcome and re-slice only that affected frontier; preserve completed ACs and dependencies rather than restarting the interview.

## Decomposition algorithm (single agent, automatic)

1. Build a deduplicated acceptance-ID map from existing OpenSpec specs and G02 crosswalk (when T2), then identify actual runtime/test/provider ownership. Preserve historical accepted behavior, exact provider identities and compatibility. Mark unknown upstream hooks or external credentials as `UNKNOWN`/`BLOCKED`, not as solved.
2. Write the **fewest coherent, complete vertical tracer bullets** that each deliver observable behavior or a separately attestable real-provider/Harbor milestone. Specify the smallest live boundary: request/agent → domain/application/adapters → actual output or safe denial → owning negative/positive oracles. Avoid horizontal-only “write types” or “add tests” tickets.
3. Estimate changed handwritten LOC **per slice**, with code / tests / glue/config subestimates, and expected number of changed files. Repeatedly **merge overly small adjacent slices**, and **split overlarge or overly risky slices**, preserving all acceptance IDs and truly necessary blocking edges. Minimize PR count and unnecessary global serialization. Use expand–contract for wide atomic refactors; do not promise intermediate green commits when impossible.
4. For each slice record: ID/title; **Blocked by** exact prior IDs; observable deliverable; acceptance IDs; estimated source/test/other changed LOC and total; known files/seams (tentative until live HEAD); explicit RED and GREEN; mock vs real-provider/agent/Harbor evidence; rollback/stop condition; G02/egress prerequisites where applicable.
5. Review the plan **yourself** against coverage, missing or cyclic dependencies, vertical completeness, estimated LOC outliers, acceptance/security/provenance and actual one-context feasibility. Update the **existing** `openspec/changes/<id>/tasks.md` (or already governing plan). Treat the existing phase template as an execution-time checklist, not a competing persistent tracker.
6. **Do not ask the owner whether tasks are too large/small, how many chunks to use, or whether to merge/split.** This explicitly overrides the vendored `to-tickets` “Quiz the user” *on routine granularity only*. Choose automatically using the size and risk rules above. Ask only when a genuinely unresolved **material owner decision** is required (G02 architecture, provider/model/egress budget, behavior or safety policy); follow ACE's bounded-question rules. Planning may finish with blocked-dependent slices; no silence-as-approval.
7. Validate with available pinned OpenSpec/SDD structural checks and focused repository tests, and report actual results versus `NOT_RUN`. If a later plan change needs fresh owner G02 review, record it. Open a planning PR under `ace-stage-handoff`, then **route each selected chunk into `.agents/skills/ace-phase-plan/SKILL.md`** for its complete executable brief. Only `tasks.md` owns task checkboxes; phase files are non-tracking references. Never silently begin implementation or real provider egress.

## Output contract

In the response and canonical `tasks.md` include the **number of slices chosen by the algorithm**, a dependency DAG/frontier, one row per slice with its **forecast changed-LOC budget** and AC mapping, RED/GREEN and evidence obligations, and explicit outlier/uncertainty reasons. No fixed number of chunks is mandated: 3, 8 or 15 may all be correct depending on actual scope. Normal feedback is a summary of the finished plan, **not an invitation to negotiate granularity**.

State separately: branch/SHA, changed planning artifacts, checks observed, `Skill invocation` visibility, G02/owner decisions and actual provider tests (normally NOT_RUN). Do not claim that a 1,000-line estimate proves model-context fit, provider delivery, independent review or production readiness.
