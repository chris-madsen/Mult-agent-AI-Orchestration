# Quality Gates adoption plan — scoped changes, no tool explosion

**Status:** proposal for implementation PRs; none of the recommended new tools is considered installed until its own implementation/test PR passes. Existing ACE scripts/CI continue to run under current AGENTS.md, accepted ADR/OpenSpec and testing-strategy.md.

## Rules before beginning any gate PR

- Start from current \`main\` and inspect active PRs, changed paths, tests and existing release checks. An old inventory is never proof a capability is missing.
- State exact invariant, owning contract ID, scope, test, failure mode and output evidence for each gate.
- Prefer maintained tools and pinned versions; avoid custom parsers and a second task runner unless a demonstrable gap.
- Keep fast gates for the **affected changed files** in the inner loop. Docs-only PRs must not require model downloads or full TS compilation.
- Do not change the accepted ACE architecture to accommodate a new linter; adjust rule semantics to architecture.
- Do not independently wire a new tool to cloud APIs, source archives or production secrets.
- No "enabled" checkbox without an observed execution against a known good fixture **and** an intentional bad fixture.
- Preserve the existing production supply-chain gate, real provider jobs and runtime provenance as separate authorities.

## PR-QG0 — offline documentation integrity (P0, smallest first)

**Goal:** extend docs-only \`git diff --check\` with a real offline relative-link/anchor verification for changed Markdown.

**Implementation approach:** pilot **lychee** as maintained tool (same family as Sphericon), pin version, use \`--offline\` and configuration excluding intentional generated links. No generic regex parser unless this tool is incompatible.

**Files:** scoped GitHub workflow change, tool version/lock configuration if chosen, minimal docs runbook and fixtures. Avoid sweeping formatting and avoid network access.

**RED/negative fixture:** a relative Markdown link to a nonexistent checked-in file; CI fails with file/anchor location. **GREEN:** a valid relative link passes. Include spaces, URL encoding and anchors. Existing docs may contain legacy broken links: report, fix small violations or bounded reviewed baseline that cannot grow.

**CI:** docs-only paths run diff + offline links; no npm model dependencies. **Exit:** confirmed PR check with predictable fail/pass, no external HTTP required.

## PR-QG1 — security and workflow checks (P0)

**Goal:** detect accidentally committed secrets, dangerous GitHub workflow constructs and untrusted CI permissions before merge.

**Tools to compare:** Betterleaks vs Gitleaks for source scan; zizmor + actionlint/jactionlint for workflow files. Pick one scanner per function and pin versions.

**Inputs:** changed Git files and workflows; historical scanning periodic, staged scanning optional. **No credentials** are uploaded to third parties by default.

**Negative tests:**
- harmless synthetic token formatted to trigger a known scanner rule, not a genuine secret;
- GitHub Actions snippet with dangerous untrusted expression or excessive token scope;
- clean allowed workflow baseline and known safe secret-placeholder.

**Blocking:** confirmed secret or unsafe workflow; false positives require scoped, expiring documented suppressions. **CI:** source scan on PR, workflow lints on workflow changes, scheduled history audit where appropriate. **Exit:** check fails on bad fixture, passes on clean fixture; no secret printed in logs.

## PR-QG2 — architecture fitness rules 1.0 (P0)

**Goal:** turn two or three of ACE's accepted invariants into executable, tested rules.

**Starting set (pilot only):**
- direct infrastructure imports forbidden in the specific domain/application package, if actual imports show a stable boundary;
- known anti-pattern converting provider technical failure into complete/empty-success in relevant adapters;
- disallowed cross-boundary import (MCP explicit tool layer vs gateway projection) where a simple import can prove it.

**Tools:** \`ast-grep\` rule files + valid/invalid test fixtures; use existing installed ast-grep provider only if the pinned CLI version supports rules and test command. Otherwise install a pinned CLI. For typed edges compare TS compiler graph / dependency-cruiser first. Don't use SCIP/easement until an actual typed rule is unexpressible cheaply.

**RED:** an intentional violating code fixture is detected with rule ID + repair hint. **GREEN:** allowed examples and real existing accepted paths pass. **False-positive test:** same suspicious string inside comment/fixture/legitimate code is not flagged. **Gate:** report-only until scoped fixture validated, then block new violations. **Review:** owner signs off each rule's semantic equivalence to accepted ADR.

**Files:** rule config, rules and fixture files, scoped \`check:arch\` command or equivalent, CI invocation, docs index. Do not copy Sphericon's Go ast-grep rules.

## PR-QG3 — pre-code Design Consistency gate (P0)

**Goal:** formalize G02 before any T2 implementation.

**Implementation:** integrate a read-only **agent procedure** into \`PROMPTS-ACE.md\`, \`source/commands/design_feature.md\`, phase plan and operational SDLC. No new orchestration service. Evidence crosswalk:
\`acceptance ID → owner → accepted decision → interface/state → phase → test oracle → provider requirement\`.

**Bad fixture:** intentionally omit one acceptance test or put two conflicting owners/ADR decisions; G02 reports BLOCKED. **Good fixture:** fully covered small design passes, with documented N/A categories.

**Human owner:** unresolved material architecture decisions cannot be auto-approved. For T0 mark N/A, T1 concise. **Exit:** next ACE implementation PR actually uses G02 and records the result.

## PR-QG4 — dependency usage & scheduled advisory checks (P1)

**Goal:** surface dead exports/unneeded dependencies and security advisories without destabilizing dynamic plugin loading.

**Tool choice:** pilot Knip on TS packages. Account for dynamic entrypoints, bundled assets, CLI invocations, tests, out-of-package tools and generated code. Compare against \`tsc\` and \`npm ls\` to avoid false "unused" findings.

**Policy:** first scan report-only; owner reviews legitimate unused files vs dynamic usage. New confirmed dead exports/deps can fail PR; legacy debt tracked with explicit expiry. **OSV:** schedule lockfile scan; keep existing production npm audit/release evidence. **Exit:** negative fixture for unused export and known dynamic plugin exception, reproducible scanner version.

## PR-QG5 — MCP/context contract compatibility (P1)

**Goal:** prevent one-agent changes from breaking clients/projections even with passing TS types.

**Scope:** changes to MCP input/output schema, context bundle completeness/freshness enums, typed error names or versioned Bifrost/Hermes interfaces.

**Procedure:** identify canonical OpenSpec/ADR contract owner, create pre/post JSON schema or typed snapshot when appropriate, compare breaking changes, require owner acceptance and explicit migration. Test both allowed additive change and breaking removal/rename. Do NOT add TypeSpec merely to implement this gate.

**Real integration:** official MCP SDK wire test / provider-bound Bifrost receipt must reflect the specific changed path; a schema-only mock cannot certify a live provider.

## PR-QG6 — nightly code health / security (P1)

**Goal:** isolate variable-cost or advisory-freshness checks from the deterministic edit cycle.

**Jobs:** CodeQL on suitable languages; OSV on lockfiles; selected parser/structured-output property tests and targeted mutations for critical source freshness, status/denial semantics; remote Markdown links (nonblocking because external websites fail). Keep full task/real provider benchmarks separate.

**Test quality:** mutation pilot must show a deliberately introduced wrong return/status is caught by existing tests; if a mutant survives, improve the oracle rather than maximizing a generic score. Fuzz tests must be bounded, deterministic seed saved, and resource safe.

**Exit:** one green and one deliberately failing controlled test for each enabled critical rule; measured CI duration and observability of failures; no auto creation of accepted production evidence.

## PR-QG7 — optional typed architecture & toolchain pilot (P2)

**Only if measured pain:** compare \`dependency-cruiser\` against \`easement + SCIP\` on a known true/false dependency violation; measure correctness, cold CI latency, cache behavior, maintenance effort and relation to TypeScript module resolution.

**Mise:** pilot a small pinned tool set only if recurring Node/Python/Go/Rust environment drift is observed. Don't replace existing Makefile/npx/npm commands for fashion. Preserve reproducible CI installation and no hidden project secret access.

**Parallelism / Heavy:** optional when two or more agent worktrees contend for real Qdrant, LSP, Postgres or large model downloads. A single agent gains no value from new daemon/orchestrator alone.

## PR-QG8 — TypeSpec-first public contracts (owner-selected, staged)

**TypeSpec:** only after a documented stable multi-client public HTTP API requirement. Pilot one operation and validate generated server+client schema ownership, compatibility, reproducibility and real consumers. If this duplicates MCP/Zod/OpenSpec, reject.

**SQL/Ent/Goose/Squawk/Schemalens/DB Cleaner:** not applicable to ACE's current Qdrant/Graphiti architecture. If ACE adopts SQL later, plan migration immutability, schema consistency and safe transaction test isolation then. Current storage gates must instead test Qdrant collection contracts, snapshots, revision/digest preservation and memory/archive compatibility.

## Gate baseline policy

Sphericon currently requires immediate fixes/no baseline for its check rules. ACE should likewise fix manageable violations before enabling a new rule. If a new noncritical rule finds widespread old debt, **temporary report-only** with frozen exceptions, owners, expiration and no expansion is acceptable. Critical auth/egress/source-freshness or secrets failures are blocking from day one.

## Rollout / ownership table

| Stage | Owner decision | Deliverable | Definition of done |
|---|---|---|---|
| P0 | approve gate policy and exemptions | QG0–QG3 PRs | bad fixture fails; clean passes; CI at HEAD |
| P1 | approve dependency/compat scope | QG4–QG6 PRs | confirmed detection, measured cost and low false positives |
| P2 | approve toolchain/architecture benchmark | QG7 only if needed | selected cheaper tool proves same or stronger invariants |
| P0/P1 | owner-selected TypeSpec public protocol rollout | QG8 TypeSpec | pinned codegen, exhaustive mapping, wire compatibility and exact SHA proof |
| Conditional | approve new SQL storage if introduced | SQL-only migration subplan | real schema and reversible migrations |

**Non-goal of this documentation PR:** install all tools, enable their CI jobs, create unused configs or claim the real agent successfully passed these new gates. That requires separate small implementation PRs with actual binary/test outcomes.

### Functional domain selection

Before a material domain implementation require Event Storming outputs, bounded-context ownership, immutable ADTs and pure transition functions, with Effect at external effects and CAS boundaries. Import Matt's `domain-modeling` as an auxiliary skill, not as a substitute for ACE architecture. See [selected policy](ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md) and [skills import](MATT-POCOCK-SKILLS.md).
