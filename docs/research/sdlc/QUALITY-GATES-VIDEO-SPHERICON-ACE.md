# Quality Gates research: video → Sphericon → ACE

**Status:** research and proposed adoption; no new Quality Gate is executable in ACE merely because it appears here.
**Scope:** ACE developer SDLC (one agent, TypeScript + Effect, existing GitHub Actions/OpenSpec/ADRs).
**Reviewed:** 2026-11-05. Source revision anchors: Sphericon \`main\` commit \`c9dc3fdd88f07ad815de0cf31b319be633fcde67\` (tree \`3b6297128b9fbad5f77351eb9f442fcdde8dbe63\`); ACE \`main\` commit \`ec09f51d6e87b1b913ce6edb2674472d62e8b0c3\` (tree \`32304542e6980f9b442c8c5bd62195364f03946a\`); SDLC PR #222 is separate and not merged.

## Evidence and attribution

**V (video):** [Quality Gates, архитектура и инструменты разработчика](https://www.youtube.com/watch?v=x-P_xC6No0I), *Организованное программирование*, published 2026-11-01. The public episode [description](https://podcasts.apple.com/ru/podcast/id1734325321?i=1000799228073) confirms Design First, TypeSpec, code generation, architecture/security/dependency/docs/schema gates, mise, worktrees and resource-isolation. The [public third-party summary](https://youtubesummary.com/summary/x-P_xC6No0I) describes more specific tools. **It is secondary evidence, not a verified verbatim transcript.** The linked video connector's transcript/question quota was exhausted, so no precise timestamps or word-for-word statements are claimed. Tool capabilities below are additionally verified from repository files.

**S (repository):** [getsphericon/sphericon](https://github.com/getsphericon/sphericon) at the commit above; directly inspected its \`AGENTS.md\`, \`.mise.toml\`, \`mise/tasks.toml\`, \`.github/workflows/{ci,nightly,codeql,scorecard}.yml\`, \`hk.pkl\`, \`sgconfig.yml\`, \`ast-grep/rules/*\`, \`ast-grep/tests/*\`, \`easement.yml\`, \`knip.ts\`, \`vacuum.yaml\`, \`schemathesis.toml\`, \`schemalens.yml\`, \`docs/standards/review-rules.md\`, \`CODING_STANDARDS.md\`, \`docs/agents/codegen.md\`, \`docs/adr/0047-*.md\` and relevant configs. These files establish what Sphericon **declares and wires**; no Sphericon CI was executed here.

**A (ACE):** [ACE](https://github.com/chris-madsen/Mult-agent-AI-Orchestration) \`AGENTS.md\`, \`docs/AGENTS.md\`, \`.github/workflows/ace-contracts.yml\`, \`package.json\`, \`.eslintrc.cjs\`, \`docs/operations/{testing-strategy,supply-chain-release-evidence}.md\`, \`docs/docs/architecture/07-architecture-fitness-contracts.md\`. Existing ACE tests and provider gates are real project features; this comparison **does not infer** they passed for a given commit.

## Executive findings

1. Sphericon keeps **review rules separate from how to run tools**: \`docs/standards/review-rules.md\` is a numbered rules catalog; \`CODING_STANDARDS.md\` maps enforceable rules to analyzers and \`mise run check\`; \`AGENTS.md\` says which checks apply. ACE should replicate **that separation of concerns**, not those Go implementation details.
2. Syntax-only invariants use **ast-grep rules with positive and negative rule tests**. Type-aware invariants use Sphericon's Go custom \`go/analysis\` and **SCIP-based** \`easement\` for inter-package boundaries. ACE can start with a few TS ast-grep checks; escalate to SCIP/easement only when ordinary import/AST constraints cannot express the actual rule.
3. Sphericon's code generation is **one-way**: TypeSpec → OpenAPI → generated Go/TypeScript, Ent → generated storage and mapping, with generated-file ownership checks. ACE has no comparable proven multiparty TypeSpec source of truth. **Historical recommendation from the initial comparison:** before the owner selected TypeSpec, keep existing MCP schemas, Effect contracts and OpenSpec and defer TypeSpec. That recommendation is superseded by the owner decision below: TypeSpec is selected for new and migrated public machine contracts, while compiler/emitter/generator adoption remains staged and evidence-gated.
4. Sphericon uses many **independently scheduled gates**. Heavy language/package tests run in PR CI, whereas mutation testing, API fuzzing, coverage, CodeQL and vulnerability freshness are scheduled/nightly. ACE already splits fast deterministic PR verification from real Qdrant/LSP and production gates.
5. Sphericon's \`mise\` pins heterogeneous tool versions, runs tasks, dev services and hooks; \`hk.pkl\` is fast staged-file checks only. ACE could benefit from pinned tools eventually, but **adding mise is not the prerequisite** to making its SDLC useful.
6. Sphericon's schema-consistency (\`schemalens\` with Ent adapter), migration immutability (Goose/Squawk), DB test rollback and SQL contract fuzzing are tied to a **PostgreSQL/Ent** stack. ACE does not need a fabricated relational database migration gate for Qdrant/Graphiti. Translate the invariant to **collection/payload-schema, snapshot, reindex and retained-memory provenance tests** instead.
7. Source evidence is stronger than conventions: the Sphericon docs state **no baseline of violations** for their current check rules, although the video summary discusses baseline as an adoption technique. For ACE a temporary **frozen, owned, expiring baseline** may be practical *only for new rules with existing legacy violations*. It must never suppress egress/auth, critical security or source-integrity failures.

## Exact comparison — which tools to reuse, adapt or reject

Legend: EXISTING = already present in ACE; ADOPT = suitable next implementation; PILOT = evaluate before dependency; CONDITIONAL = only if feature requires; NOT-APPLICABLE = reject for current ACE. None of ADOPT/PILOT denotes an installed check.

| Concern | Sphericon implementation | ACE today | ACE recommendation |
|---|---|---|---|
| Strict TS type checking | \`tsc\` (and oxlint typed layer) | \`npm run check\`, \`verify:pr\` | **EXISTING**; preserve |
| Lint | oxlint/oxfmt + golangci-lint | ESLint \`--max-warnings=0\` | **EXISTING**, compare speed before migrating |
| Formatting | \`oxfmt --check\`, staged hook | Git diff check/docs; no formatter command verified in ACE \`package.json\` | **ADOPT** focused Prettier/oxfmt, pinned and narrow |
| Test selection | affected files locally, full CI | \`test:affected\`, impact selector and self-test | **EXISTING**; avoid duplicate runner |
| Syntax architecture rules | \`ast-grep scan\` + \`ast-grep test\` | ast-grep used as retrieval provider, not a repo policy-rule suite in current inspected ACE | **ADOPT**, start with 2–4 tested ACE-specific rules |
| Type-aware boundaries | SCIP \`easement check\` with Go+TS indexers | TypeScript imports and existing architecture contracts | **PILOT**, compare with dependency-cruiser / native TS graph |
| Custom type-aware analyzer | \`go/analysis\` in custom golangci-lint | TS + Effect compiler and tests | **CONDITIONAL**; TypeScript/ts-morph analyzer only if needed |
| Stale/generated artifacts | codegen pipeline and \`check:generated\` | compiled runtime provenance manifest | **ADOPT conditionally** for real generated assets; do not invent a new generator |
| API-first contract | TypeSpec → OpenAPI / SDK | OpenSpec, MCP/tool and projection contracts | **PILOT TypeSpec**, only if multiple independently versioned clients justify |
| OpenAPI spec lint | Vacuum + custom response rule | No stable generated OpenAPI verified | **CONDITIONAL** when OpenAPI introduced |
| API fuzz | Schemathesis on live external API, nightly | MCP/agent E2E and typed contracts | **PILOT** schema-based MCP fuzz/property tests before HTTP fuzz |
| Backwards compatibility | contract/migration upgrade checker | ADR/contract tests, release evidence | **ADOPT** protocol/schema compatibility when versioned clients exist |
| Dead code / deps | Knip | no Knip task identified | **ADOPT** report-only first, dynamic entries exclude false positives |
| Secret scanning | Betterleaks staged/full history | strong privacy rules and release audit; no PR secret scanner verified | **ADOPT P0** Git hook + PR scanner and CI evidence |
| GitHub Actions lint | jactionlint + zizmor | one active workflow; no workflow-security linter verified | **ADOPT P0** pin versions, workflow changes scope |
| Dependency vuln | OSV and govulncheck nightly; dependabot | production npm audit in release supply-chain gate | **ADOPT** PR lockfile/check and scheduled OSV, scoped suppressions |
| Markdown links | lychee offline PR, remote nightly | docs-only \`git diff --check\` | **ADOPT P0** offline internal-links for changed docs |
| Markdown typos | typos + \`_typos.toml\` | not verified | **PILOT**, mixed English/code terms baseline |
| Commit discipline | Conventional Commits + commitlint | PR rules in \`AGENTS.md\` | **PILOT** commitlint for PR history; no premature hook mandate |
| Precommit hooks | \`hk.pkl\`: staged secrets, oxlint, oxfmt, ast-grep, workflow lint | no repo-pinned hook runner verified | **PILOT** optional local fast hooks; CI always authoritative |
| License/SBOM/provenance | security tools + security jobs | **EXISTING release gate** tied to SBOM, image digest, npm audit, license review | **EXISTING**; move source-code lockfile risk earlier without duplicating release attestation |
| Coverage | nightly total coverage floor | deterministic tests and capability E2E; no overall threshold identified | **PILOT** changed-code coverage only for meaningful logic, avoid vanity % |
| Mutation testing | nightly focused business logic | not verified | **PILOT** targeted critical source freshness/policy functions |
| Fuzz/property tests | parser fuzz, schema fuzz nightly | contract and error-path tests | **PILOT** property-based tests for boundaries, parser, invalid source spans |
| DB schema checker | schemalens + Ent adapter | Qdrant payloads / archive / Graphiti | **NOT-APPLICABLE directly**; adopt store-specific state contracts |
| Migration lint | Squawk/Goose, immutable SQL files | non-relational stores; source/schema evolution | **NOT-APPLICABLE directly**; state/data migration gate as needed |
| Heavy concurrency control | Heavy, slot pools, nested task limits | one development agent; expensive CI providers | **CONDITIONAL** on measured agent-worktree contention |
| Toolchain management | mise locked versions + services | Node/npm, Python, Go, Rust tool setup already in CI | **PILOT** \`mise\` when provisioning drift measured; don't replace Makefile today |
| Worktree isolation | separate worktrees/ports/DB | ACE has worktree helper and data safety policy | **EXISTING concept**; improve shared-provider namespace isolation only if concurrent worktrees used |
| Image/bundle size | size-limit for tracker | no browser bundle in ACE core | **NOT-APPLICABLE** |
| CI security / supply-chain | CodeQL, OpenSSF Scorecard, pinned actions | existing releases and actions | **ADOPT staged** CodeQL first, Scorecard periodic; validate permissions/cost |

## Sphericon's implementation highlights worth imitating

### 1. One rule, one owner, one test
See [review-rules.md](https://github.com/getsphericon/sphericon/blob/c9dc3fdd88f07ad815de0cf31b319be633fcde67/docs/standards/review-rules.md), [example ast-grep rule](https://github.com/getsphericon/sphericon/blob/c9dc3fdd88f07ad815de0cf31b319be633fcde67/ast-grep/rules/no-common-refusal-in-handlers.yml), [its fixture](https://github.com/getsphericon/sphericon/blob/c9dc3fdd88f07ad815de0cf31b319be633fcde67/ast-grep/tests/no-common-refusal-in-handlers-test.yml). The latter has **valid and invalid code examples**, preventing a weak rule from passing based on misleading regex syntax.

ACE should require for every new static rule: a numbered requirement, meaning, explicit scope, negative and positive fixture, exception policy, severity, repair hint, and regression if the rule ever misfires.

### 2. Type-aware boundaries, no magic import-lint
See [easement.yml](https://github.com/getsphericon/sphericon/blob/c9dc3fdd88f07ad815de0cf31b319be633fcde67/easement.yml) and [CI arch job](https://github.com/getsphericon/sphericon/blob/c9dc3fdd88f07ad815de0cf31b319be633fcde67/.github/workflows/ci.yml). It uses SCIP indexers and caching; a separate job avoids CPU starvation from language linters. ACE shouldn't install SCIP until a typed dependency/ownership rule genuinely requires it.

### 3. Generated contract is owned once
See [codegen.md](https://github.com/getsphericon/sphericon/blob/c9dc3fdd88f07ad815de0cf31b319be633fcde67/docs/agents/codegen.md) and [generated check](https://github.com/getsphericon/sphericon/blob/c9dc3fdd88f07ad815de0cf31b319be633fcde67/mise/scripts/check-generated.ts). In ACE generated clients and compiled artifacts require one source schema and exact generation verification **if introduced**, not duplicate manually kept TypeSpec/OpenAPI/MCP/Zod descriptions.

### 4. Fast vs slow gates
See [ci.yml](https://github.com/getsphericon/sphericon/blob/c9dc3fdd88f07ad815de0cf31b319be633fcde67/.github/workflows/ci.yml) and [nightly.yml](https://github.com/getsphericon/sphericon/blob/c9dc3fdd88f07ad815de0cf31b319be633fcde67/.github/workflows/nightly.yml). Sphericon schedules:
- **PR:** lint, arch, generated code, contract decorators, schema consistency, DB-backed tests, e2e, upgrade checks.
- **Nightly:** coverage, race, mutation, API fuzzing, parser fuzz, vulnerabilities, external links, container smoke.
ACE should **not** run expensive Qdrant embeddings on every docs-only commit merely because Sphericon runs DB-backed Go tests per PR; instead keep existing ACE provider matrix but rationalize scope.

### 5. Honest baseline policy
Sphericon rules explicitly reject persistent baselines. A new ACE rule that finds many legacy issues may start in *report-only* for one cycle with a frozen set; any critical privacy/egress violation remains blocking from day one. Baselines cannot auto-expand or become an excuse to never fix a violation.

## Ranked ACE adoption decisions

### P0 — minimal, measurable, low-maintenance
1. **Offline Markdown links** across changed docs; keep existing \`git diff --check\`. A code-only PR need not run remote link checks.
2. **Secrets/workflow safety**: staged scanner locally optional; CI source/diff secret scanning, \`zizmor\`/actionlint or jactionlint for workflow changes. Use official version pinning, avoid indiscriminate GitHub token permissions.
3. **Named architecture rules catalog**: 2–4 ACE syntax rules with test fixtures *before* a system-wide ast-grep scan. Avoid duplicate ownership of established port-level tests.
4. **New pre-implementation G0 Design Consistency gate**: acceptance → owner → contract → phase → test; block T2 if missing or conflicting.
5. **Changed-scope PR evidence**: gate status and exact SHA, NOT-RUN/UNKNOWN unambiguous, no false skip=>PASS.

### P1 — after P0 is measured
6. **Knip** report-only unused exports/deps with explicit dynamic-entry exceptions; fail only new confirmed debt.
7. **TypeScript architecture import/SCIP pilot** on selected DDD boundaries, compare simple TS graph / dependency-cruiser with Easement before deciding.
8. **Change compatibility gate** for MCP/tool schemas, context projection payloads and public error enums; breaking changes require intentional owner decision.
9. **Nightly risk checks**: CodeQL, OSV lockfiles, negative/property tests of parsing and source freshness.
10. **Targeted mutation tests** for policy denial, stale-source and completeness decisions if their test oracles are weak.

### P2 — conditional engineering investments
11. **Contract-first generation (TypeSpec)** only with a stable multi-client public API; measure reduced duplicate code and generation drift versus added complexity.
12. **SCIP-based enterprise boundary analysis** only if simple rules miss meaningful violations and CI cost justified.
13. **No `mise daemons` in ACE target architecture.** Local k3s owns reusable integration services and namespace/worktree isolation; small fake HTTP/MCP/provider dependencies stay in-process. Tool version pinning remains with existing lockfiles/CI unless a concrete gap appears.
14. **Worktree resource partitioning in k3s** only where concurrent integration environments need isolation.
15. **SQL schema lint/DB Cleaner** only if a relational SQL store is introduced; Qdrant/FalkorDB require different state-level contracts today.

## Acceptance of the research itself

- No claim that a suggested gate is installed in ACE.
- No claim of verbatim video transcript or invented timestamp.
- Each Sphericon tool mentioned above corresponds to a file that was inspected.
- Go/Postgres/frontend-specific checks are explicitly conditional rather than mandatory ACE requirements.
- Suggestions preserve ACE's current test strategy and source-of-truth hierarchy.

## Owner architectural decision after the initial audit (2026-11-05)

The earlier comparison classified TypeSpec as a conditional pilot because it had not been selected yet. **That recommendation is superseded:** TypeSpec is now the chosen public machine contract language for ACE. Sphericon codegen inspection also shows generated server/client interfaces, runtime schema clients, converter implementations, enum completeness, permission tables, mocks/fixtures and docs — much more than type generation. See [ACE codegen coverage](TYPESPEC-CODEGEN-COVERAGE.md). Its Go-specific generator (goverter/ogen/Ent) is not automatically ACE's TypeScript generator; choose maintained equivalents and require unmapped-field/enum negative tests.

Sphericon's Matt skills are **runtime-vendored via mise**, not tracked under their final `.agents/skills` tree. ACE documents a curated pinned selection of 23 original Matt skills in the [import plan](MATT-POCOCK-SKILLS.md), but **does not yet contain their source files**. They do not supersede ACE's one-agent workflow and OpenSpec/ADR authority.

## Owner decision: no mise daemons for ACE

ACE already has a local k3s path and real k3s worktree acceptance evidence. Therefore the Sphericon `mise daemons` pattern is **not adopted** as an ACE service orchestrator. Long-lived/reusable Qdrant, Graphiti/FalkorDB, ACE Gateway and other integration services should use k3s where container/runtime fidelity matters; tiny deterministic dependencies should use in-process fakes/stubs. This avoids two competing orchestration layers. Sphericon's use of mise remains useful reference material for task/gate design and pinned Matt-skill provenance only.
