# ACE SDLC adoption execution plan

**Date:** 2026-11-10  
**Status:** active implementation plan  
**Governing process:** `docs/operations/ai-assisted-sdlc.md`  
**Constraint:** this plan implements the SDLC already merged in PR #222. It MUST NOT change the intended Research → Design → Plan → Implement flow, tier meanings, gate meanings, owner authority, TypeSpec rollout semantics, or worktree/PR discipline.

## Goal

Move ACE from "the SDLC exists in documentation" to "the repository demonstrably operates under that SDLC" by adding narrowly scoped, maintained quality gates and by dogfooding the process on real PRs.

Success means:

1. at least one real repository PR is executed end-to-end under the merged SDLC with retained evidence;
2. the P0 quality gates selected by PR #222 are implemented as small independent PRs with positive, negative and false-positive fixtures where applicable;
3. new automation is pinned, reproducible, and uses maintained upstream tooling before custom code;
4. proposed/uninstalled gates remain `NOT-RUN` rather than being described as active;
5. TypeSpec rollout and optional Matt Pocock skills remain separate staged tracks and are not prerequisites for the SDLC itself.

## Current baseline

At plan start:

- PR #221 is merged: safe worktree lifecycle commands are available.
- PR #222 is merged: the single-agent SDLC, gate catalog, adoption plan, TypeSpec direction, functional DDD direction and research material are in `main`.
- Existing CI already provides deterministic TypeScript/Hermes verification plus capability-specific real Qdrant, LSP and Bifröst jobs.
- The following proposed tooling is not currently installed in ACE: offline Markdown link checker, secret scanner, GitHub workflow linter/security scanner, Knip, typed architecture pilot, TypeSpec compiler/codegen toolchain.
- No post-#222 PR has yet demonstrated the new SDLC on a real implementation change.

## Execution rules

Every implementation slice below:

- starts from current `origin/main`;
- uses the repository worktree lifecycle when a local worktree is available;
- uses one task → one deterministic branch → one PR;
- follows the risk tier chosen from `docs/operations/ai-assisted-sdlc.md`;
- records RED/GREEN or an explicit reason RED is not applicable;
- runs the four BUILD / ARCH / SEC / PLAN self-checks separately;
- records source PR HEAD separately from the actual CI-tested checkout/merge SHA;
- does not call a proposed gate active until a clean fixture and an intentional bad fixture have both been observed;
- does not weaken existing deterministic, real-provider or release gates.

## Phase P0 — make the SDLC operational

### SDLC-QG0 — offline documentation integrity

**Risk:** T1 process/tooling change with tightly bounded CI behavior.

**Objective:** extend docs-only verification beyond `git diff --check` with a maintained offline relative-link/anchor checker for changed Markdown files.

**Selected upstream:** `lycheeverse/lychee-action`, pinned by full commit SHA; lychee binary version pinned explicitly.

**Acceptance:**

- only Markdown files changed by the PR are checked;
- network access is disabled during link checking;
- a relative link to a missing checked-in file fails;
- a valid relative link passes;
- spaces, URL encoding and anchors are covered by fixtures;
- docs-only CI does not install the Node dependency tree or download model/provider artifacts;
- output identifies the failing file/link;
- existing unrelated legacy documentation debt does not become an unbounded blocker.

**Evidence:** controlled bad fixture run, corrected fixture run, final PR CI, exact source HEAD and tested checkout SHA.

### SDLC-DOGFOOD-1 — first real PR under the SDLC

Use SDLC-QG0 itself as the first real dogfood PR.

Required retained evidence:

- preflight/source identity;
- T1 classification and invariant;
- focused research of current docs-only CI;
- minimal design and plan;
- RED fixture before final implementation;
- GREEN fixture after implementation;
- BUILD / ARCH / SEC / PLAN findings;
- final CI and owner merge decision.

Completion of SDLC-QG0 plus this evidence satisfies the first practical adoption criterion from `ADOPTION-PLAN.md`.

### SDLC-QG1 — security and workflow checks

Implement as a separate PR after QG0.

**Objective:** catch accidentally committed secrets and unsafe GitHub Actions constructs before merge.

**Work:**

- compare Betterleaks vs Gitleaks and choose one maintained scanner;
- choose pinned `zizmor` plus `actionlint`/equivalent for workflow syntax/security;
- use harmless synthetic secret fixtures;
- use an intentionally unsafe workflow fixture and a clean fixture;
- ensure no secret value is echoed in logs;
- define scoped, expiring suppressions rather than broad ignores.

### SDLC-QG2 — architecture fitness rules 1.0

Implement as a separate PR after QG1.

Use ACE's already installed ast-grep capability first.

Pilot only 2–3 accepted invariants whose semantics can be expressed reliably, for example:

- forbidden direct infrastructure import from a specific domain/application boundary;
- known provider-failure → fake complete/empty-success anti-pattern;
- forbidden import crossing between explicit MCP tools and Gateway Projection where a simple import edge is authoritative.

Each rule requires:

- stable rule ID;
- violating fixture;
- valid fixture;
- false-positive fixture;
- repair hint;
- owner-approved semantic equivalence to the relevant ADR/contract.

Start report-only; promote to blocking only after observed fixture behavior and low false-positive risk.

### SDLC-QG3 — demonstrate G02 on a real T2 change

Do not rewrite G02. It is already part of the merged SDLC as a procedural pre-code gate.

The next suitable T2 implementation PR must retain a crosswalk:

`acceptance ID → owner → accepted decision → interface/state → phase → deterministic oracle → provider requirement`

Missing or conflicting entries produce `BLOCKED`, not a fabricated pass.

## Phase P1 — strengthen PR and scheduled assurance

### SDLC-QG4 — dependency usage and advisory reporting

- pilot Knip in report-only mode;
- explicitly model dynamic entrypoints/plugin loading;
- add an intentional unused-export fixture and a known dynamic-use exception;
- schedule OSV/advisory checks while preserving the existing production npm audit/release evidence;
- block only new confirmed violations after owner review.

### SDLC-QG5 — contract compatibility guard

Cover MCP input/output schemas, context completeness/freshness enums, stable error names and versioned Bifrost/Hermes interfaces.

- identify the canonical OpenSpec/ADR owner;
- capture pre/post schema or typed snapshots where appropriate;
- prove additive changes pass and breaking removal/rename is detected;
- require owner-approved migration for breaking changes;
- keep real MCP SDK/Bifrost integration proof separate from schema-only checks.

### SDLC-QG6 — nightly code health/security

Move variable-cost/freshness checks out of the inner edit loop.

Candidates:

- CodeQL;
- OSV/advisory freshness;
- bounded structured-output/parser property tests;
- targeted mutation tests for critical freshness/status/denial invariants;
- nonblocking remote Markdown link reporting.

Every enabled rule needs a controlled failing case and measured CI cost.

## Phase P2 — conditional tooling only when measured need exists

### SDLC-QG7 — typed architecture/toolchain pilot

Do not implement by default.

Only if an actual typed dependency rule cannot be expressed cheaply:

- compare dependency-cruiser with SCIP/easement;
- measure correctness, cold CI time, cache behavior and maintenance cost;
- retain k3s as the reusable integration-service orchestration plane;
- do not add a second daemon supervisor or a toolchain manager without a separately measured reproducibility problem.

## Separate architecture track — TypeSpec rollout

TypeSpec is owner-selected but is not a prerequisite for the SDLC.

Start only when a real new/migrated public versioned contract provides the driver.

Follow the existing staged plan without changing it:

- **TS-00:** inventory current wire/schema owners and compatibility baseline;
- **TS-01:** one Gateway Projection HTTP vertical slice;
- **TS-02:** automated mapping completeness;
- **TS-03:** policy/schema metadata if supported;
- **TS-04:** MCP/native bridge mapping without replacing official transports;
- **TS-05:** generated-artifact ownership/reproducibility;
- **TS-06:** incremental wider migration after parity proof.

No big-bang schema replacement and no deletion of handwritten authority before compatibility proof.

## Separate optional dependency track — Matt Pocock skills

Not required for SDLC adoption.

If imported, use a dedicated vendor PR against pinned upstream v1.3.2:

- verified commit `d1478fcb140db0b93c0c8df17bcfd311844749d0`;
- verified tree `42b57b23ac2979fce601ce1d4b4d6c1d46471bbe`;
- only the reviewed 23 skill directories;
- byte/source verification and retained MIT notice;
- preserve ACE/OpenSpec skills;
- test discovery and ensure no second runner/spec/issue authority is activated.

## Recommended order

1. SDLC-QG0 + SDLC-DOGFOOD-1
2. SDLC-QG1
3. SDLC-QG2
4. SDLC-QG3 on the next suitable real T2 implementation
5. SDLC-QG4
6. SDLC-QG5
7. SDLC-QG6
8. SDLC-QG7 only if measured need appears
9. TypeSpec TS-00..06 when a real public-contract migration starts
10. Matt skills vendor import when their concrete value justifies the dependency

## Definition of "project operates under the new SDLC"

Minimum milestone:

- QG0, QG1 and QG2 are merged with observed negative+positive fixtures;
- at least one real T1 PR has gone end-to-end through the new SDLC;
- at least one suitable T2 PR has demonstrated G02 before implementation;
- every automated gate clearly distinguishes ACTIVE from PLANNED/NOT-RUN;
- worktree/branch/PR discipline is used for completed repository changes;
- CI evidence records source HEAD and actual tested checkout separately;
- no SDLC semantic change was required to achieve adoption.

## Current slice

**Active task:** `SDLC-QG0` + `SDLC-DOGFOOD-1`.

Next implementation step: add a pinned offline Lychee check to the docs-only branch of `.github/workflows/ace-contracts.yml`, with controlled RED/GREEN fixtures and retained evidence.

## Adoption closure crosswalk (reviewed 2026-11-11)

This section is a delivery checklist under the existing SDLC, not a second
specification or a claim that unmerged checks are active. Check current PR
HEADs, exact merge candidates, and CI again before accepting any row.

| ID | Dependency | Completion evidence | State at review |
|---|---|---|---|
| AC-SDLC-01 | #223 | QG0 merged; normal changed-Markdown PR rejects a broken relative file/anchor; Unicode paths are included; docs-only checks avoid npm/provider installs; source SHA and checkout SHA retained | #223 draft; review fixes committed, final acceptance pending |
| AC-SDLC-02 | AC-SDLC-01, #224 | QG1 merged; synthetic new secret blocks, output redacted, clean input passes; a secret adjacent to the excluded reviewed fixture is detected; actionlint/zizmor reject unsafe workflow and accept clean workflow | #224 draft; review fixes committed, final acceptance pending |
| AC-SDLC-03 | AC-SDLC-02, #225 | QG2 merged; each native ast-grep rule passes valid/invalid/false-positive and re-export cases; production scan remains report-only until owner authorizes blocking promotion | #225 draft; review fixes committed, final acceptance pending |
| AC-SDLC-04 | AC-SDLC-01..03 | One combined fresh PR verifies all three gates together on the post-merge main; no existing runtime or provider gate is weakened | NOT-RUN |
| AC-SDLC-05 | AC-SDLC-01..04 | Branch/rules policy makes required checks and human approval enforceable; do not claim protection from an inaccessible GitHub endpoint | UNKNOWN — requires repository owner confirmation |
| AC-SDLC-06 | AC-SDLC-01, owner merge | T1 dogfood evidence for #223 archived at merged SHA, with real RED/GREEN, four distinct gate passes and human review | PENDING merge/owner |
| AC-SDLC-07 | Appropriate real T2 task | G02 acceptance→owner→decision→state/contract→phase→RED/GREEN→provider-proof crosswalk accepted **before code**, then implemented, tested, reviewed and merged | NOT-RUN |
| AC-SDLC-08 | AC-SDLC-01..07 | Two further independent real tasks (one contained T1 bugfix, one material T2 change) demonstrate repeatable process and honest provider/agent E2E; human audits quality rather than merely checking template fields | NOT-RUN |

### Required integration after merge

Merge order is QG0 (#223), QG1 (#224), QG2 (#225), each rechecked
against the **current main** rather than treating green isolated PR runs as
integration proof. Preserve separate branch HEAD and actual tested checkout
SHA. Use a disposable test PR to show a genuinely broken local Markdown link,
synthetic newly introduced credential, and unsafe workflow are independently
rejected by their relevant checks. A clean changed-document PR must pass.
QG2 is intentionally advisory/report-only until an owner-approved promotion;
do not count its warnings as blocking.

GitHub branch protection or ruleset configuration is a repository-owner action.
Do not label checks mandatory merely because their workflows exist. Validate
the effective merge policy and required checks using a non-production test PR.

### Beyond minimum operational adoption

- **P1:** QG4 Knip/OSV report-only pilots, QG5 public contract compatibility
  with positive and breaking fixtures, QG6 scoped nightly CodeQL/advisory/
  property or mutation checks after measuring their noise and cost.
- **Risk-driven:** QG7 typed import/SCIP pilot only where the native TS graph or
  ast-grep cannot prove an accepted invariant.
- **Separate approved architecture track:** TypeSpec TS-00..TS-06 with generated
  API SDK/server/validators/mapping and negative wire compatibility, source
  identity and actual provider tests. It is selected policy but no installed
  code generator is asserted.
- **Optional:** pinned Matt Pocock skills vendor import; never activate a
  second agent orchestrator or alternative OpenSpec authority.

Operational SDLC adoption does **not** retroactively prove every existing ACE
runtime module is architecturally compliant. Existing code concerns should be
prioritized by incident/security impact, checked against accepted ADR/OpenSpec
and maintained upstreams, and repaired as small RED/GREEN PRs with removal of
superseded implementations.
