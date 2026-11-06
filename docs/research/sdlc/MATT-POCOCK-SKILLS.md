# Matt Pocock skills — verified source and pending import

**Status:** the original skill sources are **not installed or committed into ACE**. The source files were retrieved and compared against the pinned upstream release, but the attempted GitHub commit of vendored skill content was not completed. Do not report the skills as installed or claim that ACE has run them.

## Provenance

- Matt's original repository: https://github.com/mattpocock/skills
- Pinned source: **v1.3.2**; annotated tag resolves to commit `d1478fcb140db0b93c0c8df17bcfd311844749d0` and Git tree `42b57b23ac2979fce601ce1d4b4d6c1d46471bbe`.
- Reference implementation: https://github.com/getsphericon/sphericon at commit `2ba7879b511a970b16310a433d7092492f10dd29` (tree `f67e313fe0ec9494b75368456b13c273fd774da0`).
- Sphericon's `.mise.toml` defines the tagged-release source with `version = "latest"`; its committed `mise.lock` resolves and pins that source to **1.3.2** with archive checksum. `mise/tasks.toml`, `["skills"]` copies selected directories into `.agents/skills`. The final skills are populated by setup and therefore do not appear as vendored skill files in Sphericon's committed Git tree.
- License: **MIT Copyright (c) 2026 Matt Pocock**, text retained in [license](../../../.agents/LICENSE-MATTPOCOCK-MIT.txt).
- ACE already has its own OpenSpec skills in `.agents/skills`; they must not be overwritten.

## Reviewed selection (23 of Sphericon's 29 Matt skills)

**Engineering:** `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `grill-with-docs`, `implement`, `improve-codebase-architecture`, `pr`, `research`, `retro`, `tdd`, `to-spec`, `to-tickets`.

**Supporting/optional:** `ask-matt`, `implement-spec`, `prototype`, `setup-matt-pocock-skills`, `grill-me`, `grilling`, `handoff`, `to-questionnaire`, `wait-what`, `writing-for-agents`.

At pinned `v1.3.2`, the 23 selected skill directories contain **64 upstream blobs**. This review verified the tag commit/tree identity and that every selected directory exists at that pin. **The upstream skill files remain uncommitted and are not part of PR #222.**

Not selected from Sphericon: `triage`, `wayfinder`, `wizard`, `teach`, `claude-handoff`, `loop-me`. The last two are especially ill-suited to a client-independent, one-agent workflow; issue-triage and wizard automation require a separate decision.

## Reproducible future import

Use a dedicated, human-reviewed vendor PR against the pinned upstream release. Matt's README may document convenience installers, but ACE must **not** use an unpinned `@latest` installer for this dependency, even interactively when preparing committed vendor content. Select tag `v1.3.2` / verified tree `d1478fcb140db0b93c0c8df17bcfd311844749d0`, verify the retrieved source against that identity, copy only the approved skill directories into the existing `.agents/skills` folder, preserve the MIT notice, run a path/reference check and commit the exact reviewed bytes. Sphericon uses pinned `mise` release archives; ACE is not required to add mise solely to import skills.

No automation should execute arbitrary scripts from a newly imported skill until owner review, and no skill installation should delete existing OpenSpec skills.

## ACE compatibility overlay

- Root `AGENTS.md`, accepted ADR/OpenSpec and our [operational SDLC](../../operations/ai-assisted-sdlc.md) outrank optional skills.
- `domain-modeling`: retain Event Storming, bounded contexts and ubiquitous language; implement passive immutable ADTs + cohesive pure domain functions, not mandatory rich OO entities.
- `to-spec`/`to-tickets`: map to existing OpenSpec behavioral specs and task graphs rather than a second issue/spec source.
- `tdd`/`diagnosing-bugs`/`code-review`: augment current ACE RED/GREEN and four quality checks; provider acceptance remains separate.
- `implement-spec`: upstream multi-agent execution is incompatible with the **current one-agent** decision; treat as reading/reference only until explicitly changed.
- `setup-matt-pocock-skills`: may write repo config, glossary and tracker; do not auto-run without reviewing impact on existing ACE governance.
- `ask-matt` may refer to intentionally unselected skills; use ACE `PROMPTS-ACE.md` as the default router.
- `pr`/`handoff`: preserve focused commit, push, exact SHA/CI, human owner control and no direct-to-main behavior.

## Required evidence before status becomes INSTALLED

1. All selected `SKILL.md` files and referenced Markdown/resources exist at the intended paths.
2. Confirm file bytes against pinned upstream tree; no extra instructions accidentally modified.
3. MIT notice is retained; change reviewed as a software dependency.
4. Repository-native skills are preserved.
5. Agent discovery and single-agent process are tested; no second runner/issue tracker silently activated.
6. GitHub PR head contains committed files and actual CI status, not an unattached Git tree.
