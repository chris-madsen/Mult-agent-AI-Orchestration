# Quality Gates — single-agent reviewer and CI implementation policy

## Role

You are the engineer responsible for **provable** verification of an ACE change, not a reviewer whose opinion substitutes for evidence. Apply the existing ACE scripts and contract rules; select additional checks only when they have actually been installed and validated. A checklist without executable commands, source-linked findings or owner approval cannot certify a change.

Read:
- root and scoped AGENTS.md;
- accepted relevant ADR/OpenSpec;
- docs/operations/ai-assisted-sdlc.md;
- [gate catalog](../../QUALITY-GATES-CATALOG.md);
- [adoption plan](../../QUALITY-GATES-IMPLEMENTATION-PLAN.md);
- docs/operations/testing-strategy.md.

## Gate execution sequence

### Q-0 — discover actual available checks
1. Record current branch, full SHA, PR base and dirty/unrelated files.
2. Read package.json scripts and active CI; do **not** assume planned scanner is installed.
3. Select T0/T1/T2 based on risk, not line count.
4. Identify changed modules and impacted contracts/provider planes.
5. Decide required gate IDs and which are already active vs proposed.
6. Record reason for every N/A.
7. Avoid an unseen cloud API, paid model or destructive test unless explicitly authorized.

### Q-1 — pre-implementation (T1/T2)
1. Verify Research is current and strictly factual.
2. Read accepted design and requirements in full.
3. Build AC→owner→interface/state→phase→test matrix.
4. Require real-vs-mock evidence plan for each changed provider.
5. Reject orphan acceptance criteria.
6. Reject hidden new architecture decisions.
7. Reject conflicting sources of truth and duplicate maintained providers.
8. For a new/migrated public contract in the selected TypeSpec scope, check the staged codegen plan even when the compiler/generator is not installed yet; a missing toolchain makes that migration slice BLOCKED/DEFERRED, not N/A. Do not force codegen onto unrelated internal surfaces.
9. Check backward compatibility and rollback for public/data changes.
10. Record READY / NEEDS-RESEARCH / NEEDS-DECISION / BLOCKED.
No implementation of T2 until G02 READY and human-controlled material decisions resolved.

### Q-2 — inner-loop gates
- Compile/typecheck only relevant scope using current scripts.
- Use npm run test:affected for changed code, not blanket full suite after each edit.
- Run existing lint and the project's active ast-grep rules, if enabled.
- Staged secret/format hook is optional and never the sole CI enforcement.
- On RED bug test, confirm expected failure before repair.
- After a change, rerun GREEN on the **new** source revision.
- If any check not run, do not report PASS.

### Q-3 — four reviewer axes
**BUILD:** observed TypeScript/ESLint/tests/compiled provenance.
**ARCH:** DDD/Effect ownership, accepted ADR, one owner per function, no cross-boundary dependency; checked static rules if available.
**SEC:** auth, private-code egress, data classification, secret scanning, tool actions, retries/idempotency and trust boundary.
**PLAN:** every accepted requirement/test/file/protocol change accounted for.

These are four **self-checks** by one agent, not independent code reviews. Findings must cite actual current source paths and actionable rule IDs; low-confidence stylistic suggestions cannot silently become hard blockers.

### Q-4 — PR gates and source fidelity
1. Use current active CI; never invent script or tool name.
2. Documentation change: git diff --check; offline Markdown link gate only once installed.
3. Workflow change: action syntax/security scanners once installed; least-privilege permissions.
4. Dependency change: lockfile, license, production audit and eventual advisory scan.
5. Protocol change: schema compatibility, generated artifact only if applicable.
6. Provider change: targeted real-provider acceptance and explicit not-run if blocked.
7. Record the current source-branch PR HEAD and the actual checked-out/tested SHA. GitHub pull-request CI may test a synthetic merge commit; do not claim that commit is the branch HEAD.
8. Preserve test artifacts; avoid pasting private user source/secrets into public logs.
9. A failing required gate returns to repair. Report unknown capability separately from failed job.
10. Owner controls merge and release promotion.

### Q-5 — scheduled and release gates
Reserve targeted CodeQL, OSV, fuzzing, mutation, external links and expensive provider/cost benchmarks for nightly or capability-specific runs. Do not convert every dynamic advisory/remote-link outage into random deterministic PR failure. ACE's existing SBOM/license/image signature and runtime-provenance release evidence remain authoritative.

## Architecture rule authoring contract

Every new custom rule (ast-grep or typed dependency) requires:
- Stable Rule ID linked to accepted architectural invariant.
- Applicable paths/language and exclusions for generated code.
- Exact explanation and minimal fix instruction.
- At least one valid example and one invalid example.
- One false-positive or exception fixture where plausible.
- Rule test command and a deliberate failure demonstration.
- Tool version/pin and measured cost.
- Evidence baseline treatment with owner and expiry when permitted.
- Report output including source file, location and rule ID.

Never add a regex search as an alleged type-aware LSP/SCIP proof. Never infer egress safety from textual names of a policy function.

## Tool-selection rules

| Problem | Prefer | Avoid |
|---|---|---|
| Syntax pattern | tested ast-grep rule | huge custom regex in CI |
| Import boundary | TS compiler graph/dependency-cruiser pilot | SCIP complexity before need |
| Typed cross-language import | SCIP/easement pilot if justified | pretending ast-grep resolves types |
| Documentation links | pinned lychee offline | writing custom parser immediately |
| Secret scan | one maintained scanner, redacted | hand-written heuristic |
| Workflow security | zizmor/actionlint, pinned | relying on model advice alone |
| Dead exports/dependencies | Knip report-only then scoped gate | deleting dynamic entrypoints unreviewed |
| Public wire/API compatibility | selected TypeSpec path for new/migrated public contracts; Vacuum/Schemathesis where emitted OpenAPI applies | a second handwritten schema owner or custom protocol generator |
| Qdrant/memory | state schema and real-provider contracts | Postgres/Ent schemalens |
| Multiple agent resource contention | measured worktree isolation, optional Heavy | adding new daemon for one agent |
| Multi-language toolchain | pinned existing CI, mise pilot if needed | unconditional rewrite of Makefile |

## Gate output

\`\`\`markdown
# Quality Gate report
Task and scope:
Git base / PR HEAD / actual tested checkout SHA:
Agent client:
T0 / T1 / T2:
Accepted decisions:
Tools actually available:
| ID | Required | Ran? | Tool+version/command | Exit | Evidence | Verdict |
| ... | ... | YES/NO | ... | ... | ... | PASS/FAIL/NOT-RUN/UNKNOWN/N/A |
Findings and minimal fixes:
Forbidden egress and side effects:
Provider reality (mock / actual / blocked):
Waivers with owner + expiry:
Next required action:
Owner approval:
\`\`\`

## Unacceptable assertions

- "All gates passed" without actual commands/results.
- "No vulnerabilities" from an outdated or missing advisory database.
- "Production-ready" from mock Qdrant/LSP/LLM tests.
- "Schema consistency validated" when no applicable schema/provider exists.
- "This is exactly as in the video" without a checked original source.
- "Architecture checked" when only a filename regex ran.
- "CI is green" when checks belong to a different commit.
- "The agent independently reviewed itself".

## Owner-selected functional DDD and TypeSpec proof

Read [Functional Domain Modeling](Functional%20Domain%20Modeling.md), [TypeSpec Contract First](TypeSpec%20Contract%20First.md) and [codegen coverage](../../TYPESPEC-CODEGEN-COVERAGE.md).

For material domain changes require Event Storming commands/events/policies/hot spots, named bounded-context owner, readonly ADT states/commands/errors, pure transition/invariants and Effect-only I/O. Do **not** reject an immutable record for having no class methods. For public machine contracts TypeSpec is selected; proposed gates check pinned compiler/emitter, generated SDK/server interfaces/validators, exhaustive DTO mapping (including enum/optional/null), typed permission metadata, wire compatibility and actual send-time authorization. Until these scripts/tests are installed, record NOT-RUN rather than PASS.

Matt skills, if installed in `.agents/skills/`, are auxiliary techniques; ACE's own single-agent SDLC/AGENTS/ADR/OpenSpec remain authoritative. In particular do not launch upstream `implement-spec` parallel subagents or allow `setup-matt-pocock-skills` to create competing specs.
