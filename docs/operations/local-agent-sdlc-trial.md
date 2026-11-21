**Active local SDLC trial, not provider-wire acceptance:** model-invoked ACE tools and Hermes-native ContextEngine are retired. Verify the current Native Responses/Bifröst/CBM runtime. See [current architecture](current-architecture.md).

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

> Follow `AGENTS.md`, `.agents/skills/ace-sdlc/SKILL.md` and the full Research stage of `docs/operations/ai-assisted-sdlc.md`. Research the actual source-backed Hermes Native Responses → Bifröst connector → authenticated ACE context extension v2 → CBM/Qdrant/LSP runtime path. Identify the runtime composition, source identity, typed unavailable behavior and real versus mocked provider evidence. Record the current SHA and file/line citations. Do **not** change code or suggest a redesign during Research.

Acceptance: no modified source files; research facts tied to real code, and no real provider egress claim derived from local projection or mock-wire success.

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

This negative preflight can report exit 2 / `G02=BLOCKED` for a missing crosswalk; that **diagnostic is not itself a prohibition** on owner-directed offline implementation of an existing canonical phase. A new material architecture choice still requires G02 and real provider egress requires independent approval. A `--g02` file does not establish owner approval. Preserve exact tool output and owner authorization as separate evidence.

## 5. What to preserve in the trial report

- Local repository, worktree branch, source SHA, cached `origin/main` and actual PR base/head.
- Risk tier, selected **complete** stage command, accepted ADR/OpenSpec and exact canonical plan ID.
- The agent's G00/G01 results, G02 crosswalk or explicit blocker, RED and GREEN commands/output.
- BUILD/ARCH/SEC/PLAN review findings separately, actual installed checks and their versions.
- Real provider or agent E2E: `PASS` only with real observed commands/artifacts; otherwise `NOT-RUN` or `UNKNOWN`.
- PR number, source head, CI checkout/merge SHA, review and owner decision. A failed prior CI attempt stays visible.

The selected Matt Pocock helper subset is vendored under `.agents/skills/` and pinned by `.agents/matt-pocock-skills-v1.3.2-manifest.json`; read the ACE compatibility overlay before invoking it. This is repository-level availability, not proof of a live model invocation or provider acceptance. TypeSpec native Responses v2 compiler/codegen is installed and CI-checked; production provider acceptance remains a separate G11 stage. Never use a second orchestrator or `mise daemons` to run this SDLC.
