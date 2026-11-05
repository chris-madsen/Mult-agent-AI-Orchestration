---
name: quality-gate-selection
description: Select the smallest meaningful set of ACE developer quality gates for a change, verify installed commands and their evidence, and avoid treating proposed scanners as active CI.
---

# Quality Gate Selection for ACE — portable, single agent

This Markdown skill is deliberately **agent-client neutral**. It does not require Claude Team APIs, LangGraph, MCP tools or a separate execution service. Clients that cannot load \`SKILL.md\` natively can read it as a normal repository instruction file.

## When to use

Invoke after issue/request intake, before T2 implementation, when deciding fast edit-loop/PR checks and before declaring a phase or PR complete. Also use it for a proposed new linter/rule rollout or when CI has failed.

Read the active [ACE operational SDLC](../../../../operations/ai-assisted-sdlc.md), [catalog](../../QUALITY-GATES-CATALOG.md), [quality standard](../../source/standards/Quality%20Gates.md), root AGENTS.md, accepted ADR/OpenSpec and actual current CI before taking action.

## Gate selection protocol

1. Record repository and full Git SHA, PR base/head, changed files and risk T0/T1/T2.
2. Identify exactly which accepted capability invariants and data/security policies are affected.
3. Read *actual* \`package.json\`, workflow YAML and scripts. Separate AVAILABLE/INSTALLED/ACTIVE from PROPOSED. Do not run nonexistent commands.
4. Choose G00/G01 for source facts, G02 before T2 code, and G03 for existing deterministic tests.
5. For changed TS boundaries apply only installed scoped ast-grep/import checks; report planned rules as pending.
6. For changed public contracts require compatibility and actual selected adapter/provider evidence, not a schema mock alone.
7. For changed docs/workflows/lockfile select their own applicable checks rather than compiling unrelated source.
8. For real provider changes select the actual relevant ACE integration commands with approval and source-bound evidence.
9. For slow/variable-cost tasks select nightly/release gates, not inner-loop gates.
10. For every applicable gate specify precise command, version, expected failure oracle, status and artifact.
11. Missing required permission, provider, test or owner approval is BLOCKED/NOT-RUN, not a PASS.
12. After a fix or commit record whether previous gate results remain valid for new SHA; re-run affected checks.
13. Report source-linked facts, separate from recommendations and assumptions.
14. Leave merge/production decisions with human owner.

## Pre-code G02 crosswalk

For each acceptance criterion create:

| AC | owner | decision/ADR | state/interface | phase | RED/GREEN | real-provider proof | status |
|---|---|---|---|---|---|---|---|

Fail/readiness BLOCKED if a mandatory owner, oracle, permission or architectural decision is missing. T1 may have one concise row. T0 N/A if no runtime/policy behavior changed.

## New rule authoring

1. Cite an accepted ACE invariant; give it an ID and concrete repair hint.
2. Check if project tests or an existing compiler/lint rule already enforce it.
3. Choose maintained tool suited to the semantics: ast-grep syntax, TS import graph, or SCIP only if type-aware necessity shown.
4. Implement **valid**, **invalid**, and likely false-positive fixture.
5. Run the rule's own tests, demonstrate intentional violation fails and allowed case passes.
6. Scope paths and generated/test file exclusions; avoid hiding a valid violation.
7. Measure cold runtime, cache and CI memory; compare cost with benefit.
8. Apply immediate fix for small debt; if widespread and noncritical, use expiring frozen exceptions with owner.
9. Never baseline/waive critical egress, auth, secrets or source integrity failure.
10. Only mark ACTIVE once it runs in GitHub Actions with observed failing and passing outcome on the relevant SHA.

## Response template

\`\`\`markdown
# ACE Gate Selection
Repository / PR / HEAD:
Changed scope and risk tier:
Existing source of truth:
| Gate ID | Required? | Actual tool / command | Installed? | Status | Evidence |
| ... |
G02 crosswalk:
Blocking findings:
Checks explicitly NOT-RUN:
Provider reality and authorization:
Tool additions proposed (do not count as gate PASS):
Next action:
Human decision required:
\`\`\`

## Negative correctness checks

- A docs-only PR must not require Qdrant model downloads.
- A TypeScript import rule must not pretend it resolves runtime provider composition if it only matches text.
- A real cloud upload must not be run just to satisfy this skill.
- A known provider timeout must not be interpreted as empty search success.
- A planned \`lychee\` or \`knip\` task does not count as executed.
- A green old commit is not a green new HEAD.
- One agent performing four passes does not create independent reviewer evidence.
- An OpenSpec design is not itself proof production code behaves as designed.
