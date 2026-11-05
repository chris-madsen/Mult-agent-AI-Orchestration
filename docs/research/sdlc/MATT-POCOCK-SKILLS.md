# Matt Pocock Agent Skills — pinned ACE import

## Provenance and license

- Upstream: https://github.com/mattpocock/skills, tag **v1.3.2**, source tree \`d1478fcb140db0b93c0c8df17bcfd311844749d0\`.
- Reference workflow: https://github.com/getsphericon/sphericon at tree \`2ba7879b511a970b16310a433d7092492f10dd29\`.
- Actual Sphericon mechanism: \`.mise.toml\` and \`mise.lock\` pin Matt skills to **1.3.2**; \`mise/tasks.toml\` \`["skills"]\` selects named skill directories from Matt's packaged release, copies into \`.agents/skills\`, then links \`.claude/skills\` to \`.agents/skills\`. Sphericon also includes a separate Samber/Go-specific skill, not imported for ACE.
- License: **MIT, Copyright (c) 2026 Matt Pocock**. A copy is retained at [license](../../../.agents/LICENSE-MATTPOCOCK-MIT.txt). Files beneath \`.agents/skills/<name>/\` preserve upstream content from pinned v1.3.2; additional ACE-owned skill files are separately authored. This is vendoring, not a claim we wrote Matt's prompts.
- ACE method: tracked copy under \`.agents/skills\` (existing native OpenSpec skills remain intact), with no \`mise\` prerequisite or Claude-only symlink. The repository is not automatically subscribed to upstream updates.

## Imported subset

Curated from the 29 Matt skills selected by Sphericon. Full upstream skill files with supporting Markdown/YAML files where applicable are in \`.agents/skills/\`:

**Core engineering:** \`code-review\`, \`codebase-design\`, \`diagnosing-bugs\`, \`domain-modeling\`, \`grill-with-docs\`, \`implement\`, \`improve-codebase-architecture\`, \`pr\`, \`research\`, \`retro\`, \`tdd\`, \`to-spec\`, \`to-tickets\`.

**Other/reference workflows:** \`ask-matt\`, \`implement-spec\`, \`prototype\`, \`setup-matt-pocock-skills\`, \`grill-me\`, \`grilling\`, \`handoff\`, \`to-questionnaire\`, \`wait-what\`, \`writing-for-agents\`.

There are **23 imported named skills** in this snapshot. Some optional per-client metadata was omitted for late-selected productivity entries; each imported skill has its original \`SKILL.md\`, and referenced reference documents for its included implementation are copied. The import is **not the full 29-skill Sphericon selection**.

**Not imported:** \`triage\`, \`wayfinder\`, \`wizard\`, \`teach\`, \`claude-handoff\`, \`loop-me\`. Reasons: repo-specific issue automation, broad exploration, executable shell scaffold, tutorial workflow, Claude-specific handoff, and potentially autonomous loops; none is necessary for current single-agent ACE SDLC. This list makes intentional omissions explicit.

## Project-level precedence: important

Vendoring a skill **does not override** ACE root/nested \`AGENTS.md\`, approved ADRs, OpenSpec and the canonical SDLC. A Matt skill may provide a technique or optional command; it cannot introduce a different source of truth, approval policy or execution mode.

| Imported skill | ACE integration | Override/constraint |
|---|---|---|
| \`domain-modeling\` | Event Storming, ubiquitous language, context map, glossary, ADR | prefer existing strategic DDD docs; preserve **functional DDD** with immutable ADTs and pure transitions; no rich OO entity mandate |
| \`grill-with-docs\` / \`grill-me\` | resolve domain ambiguity and owner decisions at G02 | ask only genuinely unresolved material questions; never re-ask already answered decisions |
| \`to-spec\` | OpenSpec behavioral specs/acceptance | do not create a second tracker/spec or override accepted ADR |
| \`to-tickets\` | dependency-ordered OpenSpec tasks / governing plan | one agent, one phase at a time; existing PR/branch discipline |
| \`tdd\` | focused RED/GREEN at agreed public seam | no redundant tests; real provider evidence separate |
| \`code-review\` | additional review lens for G06/G10 | one-agent self-review is not independent; four named gates still required |
| \`diagnosing-bugs\` | first violated invariant, smallest repair | deterministic failpoints for races and exact source provenance |
| \`codebase-design\` / \`improve-codebase-architecture\` | review deep module seams and avoid god service | no OO class requirement or speculative microservices |
| \`research\` | source-grounded research under ACE's own research command | no recommendation in Research, record exact revision; follow project artifact paths |
| \`pr\` / \`handoff\` | PR summary and context checkpoint | commit/push, checks at exact SHA, no unauthorized merge |
| \`writing-for-agents\` | improve prompts and AGENTS docs | avoid duplicate policy and token-heavy inline copies |
| \`implement\` | code implementation after approved plan | use ACE stage command and provider-specific test portfolio |
| \`implement-spec\` | reference **only**, not default executor | upstream asks for parallel/subagents; ACE remains ONE agent unless owner explicitly changes direction |
| \`setup-matt-pocock-skills\` | reference **only**; not auto-run | could create/overwrite tracker and domain docs, requires owner-scoped plan |
| \`ask-matt\` | optional upstream router | may refer to unimported skills; prefer ACE \`PROMPTS-ACE.md\` for automatic stage selection |

## Maintenance and verification

1. Pin release tag/tree and exact selected path manifest; no remote \`latest\` at runtime.
2. Update through a dedicated PR, review source diff and MIT notice; retain or replace generated files deliberately.
3. Verify each imported \`SKILL.md\` exists; check internal references to included supporting documents. Some cross-skill upstream links may lead to omitted skills — use the local ACE router instead.
4. Ensure the coding client can discover \`.agents/skills\`; clients lacking native discovery can read files by path. Do not create a Claude-only symlink as a universal requirement.
5. Execute project tests/CI and gate acceptance at exact PR SHA; these are **documentation/vendor files** and do not prove upstream skills worked successfully on a coding task.
