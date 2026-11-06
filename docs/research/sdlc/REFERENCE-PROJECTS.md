# Related AI-assisted SDLC implementations

These are public projects inspected to strengthen the runnable prompt library. They are sources of design practices; no wholesale source code was copied.

## HumanLayer research command
- Repository: https://github.com/humanlayer/humanlayer
- Historical source file: https://github.com/humanlayer/humanlayer/blob/c2c31d656807cad9d389acfcbc19002733958218/.claude/commands/research_codebase.md
- Note: current `main` removed that path in the later repository replacement; the commit-pinned link above remains directly retrievable and is the research source used here.
- License of the repository: Apache-2.0.
- Transferable: as-is codebase documentation, complete source reads, evidence-citing synthesis, separation of research from design.

## parcadei/continuous-claude-v3
- Repository: https://github.com/parcadei/continuous-claude-v3
- Verified research file: https://github.com/parcadei/continuous-claude-v3/blob/d07ff4b06b62f43771bc0c927d0211b734d6149e/.claude/skills/research/SKILL.md
- Inspected content: 214 lines. License: MIT.
- Transferable: a full research protocol with explicit non-recommendation restrictions, task decomposition, citations and durable artifacts.

## obra/superpowers
- Repository: https://github.com/obra/superpowers
- Writing plans: https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/writing-plans/SKILL.md
- Inline execution: https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/executing-plans/SKILL.md
- Verification: https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/verification-before-completion/SKILL.md
- License: MIT.
- Transferable: atomic phases, exact test oracles, RED/GREEN, evidence ledger, proof before completion and single-agent inline execution.

## smarzban/agent-sdlc
- Repository: https://github.com/smarzban/agent-sdlc
- Plan: https://github.com/smarzban/agent-sdlc/blob/ea09572c8aa396c079b1825d32bfd310703b20f1/skills/plan/SKILL.md
- Gate: https://github.com/smarzban/agent-sdlc/blob/ea09572c8aa396c079b1825d32bfd310703b20f1/skills/gate/SKILL.md
- License: Apache-2.0.
- Transferable: acceptance -> component -> task traceability; read-only pre-build consistency checks; light vs full execution modes.

## Portable client-independent examples
- LiteObject/Copilot-SDLC-Demo: https://github.com/LiteObject/Copilot-SDLC-Demo
- Portable design: https://github.com/LiteObject/Copilot-SDLC-Demo/blob/c3565e71e48fac08ebb3b74163d3fc5e9f394b2f/docs/architecture/agent-design.md
- Prism SDLC: https://senssei.github.io/prism-local/sdlc/
- Transferable: stage ownership, explicit review/gate transitions, separate client adapters and durable artifacts.

## Revision note
External file links above are commit-pinned to the revisions rechecked during the 2026-11-06 audit; repository home links remain navigational.

## ACE application
Use ACE's existing root AGENTS.md, accepted ADR and OpenSpec, TypeScript + Effect, established tests and PR/CI discipline. Never copy another repository's tool-specific team API, Go layer directories or substitute spec authority.
