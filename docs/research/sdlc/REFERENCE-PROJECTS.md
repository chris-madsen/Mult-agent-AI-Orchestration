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
- Verified research file: https://github.com/parcadei/continuous-claude-v3/blob/main/.claude/skills/research/SKILL.md
- Inspected content: 214 lines. License: MIT.
- Transferable: a full research protocol with explicit non-recommendation restrictions, task decomposition, citations and durable artifacts.

## obra/superpowers
- Repository: https://github.com/obra/superpowers
- Writing plans: https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md
- Inline execution: https://github.com/obra/superpowers/blob/main/skills/executing-plans/SKILL.md
- Verification: https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md
- License: MIT.
- Transferable: atomic phases, exact test oracles, RED/GREEN, evidence ledger, proof before completion and single-agent inline execution.

## smarzban/agent-sdlc
- Repository: https://github.com/smarzban/agent-sdlc
- Plan: https://github.com/smarzban/agent-sdlc/blob/main/skills/plan/SKILL.md
- Gate: https://github.com/smarzban/agent-sdlc/blob/main/skills/gate/SKILL.md
- License: Apache-2.0.
- Transferable: acceptance -> component -> task traceability; read-only pre-build consistency checks; light vs full execution modes.

## Portable client-independent examples
- LiteObject/Copilot-SDLC-Demo: https://github.com/LiteObject/Copilot-SDLC-Demo
- Portable design: https://github.com/LiteObject/Copilot-SDLC-Demo/blob/main/docs/architecture/agent-design.md
- Prism SDLC: https://senssei.github.io/prism-local/sdlc/
- Transferable: stage ownership, explicit review/gate transitions, separate client adapters and durable artifacts.

## ACE application
Use ACE's existing root AGENTS.md, accepted ADR and OpenSpec, TypeScript + Effect, established tests and PR/CI discipline. Never copy another repository's tool-specific team API, Go layer directories or substitute spec authority.
