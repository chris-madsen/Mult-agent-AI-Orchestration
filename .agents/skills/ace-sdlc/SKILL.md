---
name: ace-sdlc
description: Apply ACE's existing single-agent, client-neutral Research → Design → Plan → Implement workflow, G02 owner decisions and evidence-backed quality gates. Use before investigating, planning, modifying or reviewing ACE code; never run a second orchestration framework.
---

# ACE SDLC — thin local agent entrypoint

This skill **routes to canonical ACE instructions**. It does not replace root `AGENTS.md`, accepted ADR/OpenSpec, the SDLC command files, or the existing worktree lifecycle skill.

1. Read repository-root `AGENTS.md` and scoped `AGENTS.md`; current explicit owner decisions, accepted ADR/OpenSpec and current source retain their prescribed authority.
2. Read `docs/operations/ai-assisted-sdlc.md` and choose **T0/T1/T2 by risk**, not diff size. Read `docs/research/sdlc/PROMPTS-ACE.md` and the matching **complete** `source/commands/*.md` file.
3. Run the **read-only** preflight with an explicit stage and tier:

   ```bash
   npm run sdlc:preflight -- --tier T1 --stage research --json
   ```

   `READY_FOR_AGENT` means only that local preflight has no blockers; it is **not** G02, CI, provider or production acceptance. `REVIEW_REQUIRED` means unresolved human/agent decisions. `BLOCKED` means stop and repair the stated condition.
4. Before branch/worktree mutation use the existing `npm run worktree:preflight -- --task-id <id> --json` and `worktree:start` commands. Reuse existing task branch/PR. Never develop on `main` or discard unrelated edits.
5. **Research:** fact-only runtime tracing at exact SHA, real vs fake evidence clearly separated. **Design:** AS-IS/TO-BE, Event Storming and functional ADTs for relevant T2 domain changes, TypeSpec only at selected new/migrated public wire contracts. **Plan:** add acceptance, dependency, RED/GREEN and real-provider oracles to the existing OpenSpec or governing plan. Do not create parallel specs.
6. **Before T2 implementation:** perform G02 design consistency and retain accepted owner decisions in the canonical plan. A preflight result or the mere existence of a crosswalk file **cannot approve** G02. For code-stage preflight provide `--task-id`, `--plan`, and `--g02` as applicable.
7. **Implement:** one approved phase, smallest change, RED before GREEN where practical, then separate BUILD, ARCH, SEC and PLAN reviews. Run `npm run test:affected` while editing and the bounded `npm run verify:pr` once for handoff. Use `npm run verify:full` only for explicit nightly/manual full verification. Run relevant actual provider/agent E2E separately; mocks cannot satisfy it.
8. Push a focused PR against `main`, record **source branch HEAD and actual CI-tested checkout SHA separately**, report all PASS/FAIL/UNKNOWN/NOT-RUN evidence; leave merge and production acceptance to the owner.
9. Before context handoff fill `docs/research/sdlc/source/templates/progress-checkpoint.md` and re-read live Git/source on resume.

Local dry-run procedure and explicit negative checks: `docs/operations/local-agent-sdlc-trial.md`.
