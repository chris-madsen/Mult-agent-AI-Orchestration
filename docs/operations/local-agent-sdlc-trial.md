# Local agent SDLC trial — reproducible operator procedure

Status: local **developer-process** experiment, not ACE provider/agent quality acceptance or release approval. Canonical rules: `AGENTS.md`, `docs/operations/ai-assisted-sdlc.md`, `docs/research/sdlc/PROMPTS-ACE.md`, accepted ADR/OpenSpec. The `.agents/skills/ace-sdlc` and `.codex/skills/ace-sdlc` entries only route to those rules.

## 1. Start from current main; do not overwrite a dirty checkout

```bash
# Inspect local changes before doing any update; stop and reconcile unrelated work if dirty.
git status --short
git fetch origin main
git switch main
git pull --ff-only origin main
npm ci --ignore-scripts             # only on a fresh/changed lockfile install
npm run test:sdlc-preflight        # standalone Node built-in contract tests
npm run sdlc:preflight -- --tier T0 --stage research --json
npm run worktree:audit -- --json
```

The preflight is **read-only and offline**: it does not fetch or update Git, run npm, create a PR, attest CI, verify G02, or make external provider calls. `cachedOriginMain` is explicitly a **cached** ref and may be stale. A missing ref is `UNKNOWN`. Exit code 2 means `BLOCKED`; exit code 0 can still be `REVIEW_REQUIRED`, which must not be promoted to PASS.

## 2. First agent trial — fact-only Research (no writes)

Provide the coding agent with this exact task:

> Follow `AGENTS.md`, `.agents/skills/ace-sdlc/SKILL.md` and the full Research stage of `docs/operations/ai-assisted-sdlc.md`. Research the actual source-backed path by which `ace_context` is registered in MCP stdio. Identify the runtime composition, source identity, typed unavailable behavior and real versus mocked provider evidence. Record the current SHA and file/line citations. Do **not** change code or suggest a redesign during Research.

Acceptance: no modified source files; research facts tied to real code, and no Bifröst model-bound injection claim derived from MCP tool success.

## 3. Second agent trial — isolated T1 defect or bounded improvement

First use the existing worktree guard (substitute your own stable task ID and path):

```bash
npm run worktree:preflight -- --task-id sdlc-local-t1 --json
npm run worktree:start -- --task-id sdlc-local-t1 --path ../ace-sdlc-local-t1 --json
cd ../ace-sdlc-local-t1
# Use the actual existing canonical OpenSpec/tasks or docs/plans file for this task.
npm run sdlc:preflight -- --tier T1 --stage research --task-id sdlc-local-t1 --json
```

Ask the agent to pick a **real, reproducible, limited T1 defect** in the existing implementation, not a fabricated example, and stop after diagnosis if no RED oracle can be established. It must cite the exact source, produce focused research, minimal plan in the existing owning artifact, observed RED/GREEN, four separate self-review results and a PR. Run affected tests in the inner loop and the **fast, affected-only** `npm run verify:pr` once before PR handoff. The exhaustive `npm run verify:full` belongs to nightly/manual testing. Do not claim external provider acceptance based on mocks.

Implementation-stage preflight requires an existing canonical plan, such as:

```bash
npm run sdlc:preflight -- --tier T1 --stage implement \
  --task-id sdlc-local-t1 --plan docs/plans/<existing-plan>.md --json
```

The tool **never** checks the human's actual plan approval or whether a branch belongs to a task. The agent must independently use the worktree guard and accepted owner decisions.

## 4. Negative T2 gate test (do not implement an unapproved feature)

From an isolated task branch, run without a G02 crosswalk:

```bash
npm run sdlc:preflight -- --tier T2 --stage implement \
  --task-id sdlc-local-t2 --plan docs/plans/<existing-plan>.md --json
```

Expected: exit **2**, verdict `BLOCKED`, `G02=BLOCKED` even if the plan exists. Add `--g02 openspec/changes/<change>/design.md` **only after** an actual G02 crosswalk exists and the owner has reviewed its decisions. The tool must still return `G02=REVIEW_REQUIRED`, **never** automatic `PASS` merely because a file exists. Do not mark a real T2 task delivered until design, accepted decisions, implementation tests, provider evidence if needed, CI and human review are observed.

## 5. What to preserve in the trial report

- Local repository, worktree branch, source SHA, cached `origin/main` and actual PR base/head.
- Risk tier, selected **complete** stage command, accepted ADR/OpenSpec and exact canonical plan ID.
- The agent's G00/G01 results, G02 crosswalk or explicit blocker, RED and GREEN commands/output.
- BUILD/ARCH/SEC/PLAN review findings separately, actual installed checks and their versions.
- Real provider or agent E2E: `PASS` only with real observed commands/artifacts; otherwise `NOT-RUN` or `UNKNOWN`.
- PR number, source head, CI checkout/merge SHA, review and owner decision. A failed prior CI attempt stays visible.

Optional skills such as Matt Pocock's upstream collection remain uninstalled unless separately verified and vendored. TypeSpec is selected architecture, but no compiler/codegen is asserted as installed. Never use a second orchestrator or `mise daemons` to run this SDLC.
