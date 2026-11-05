# Portable prompts: ACE one-agent SDLC

Use these instructions with any compatible coding agent; follow the project authority hierarchy. Each can be pasted into Codex, Claude Code, OpenCode, Gemini CLI or another agent. Before execution read root AGENTS.md / accepted ADR / OpenSpec.

## Research
> Inspect ACE AS-IS at this exact commit. Read directly implicated files completely; trace runtime entrypoint, imports, provider wiring and input→output. Produce fact-only findings, exact path:line citations, commit, branch, open questions. No improvements, criticism, plan or code modifications.

## Design
> Given the verified research, document AS-IS versus proposed TO-BE. Derive relevant C4/DFD/sequence, negative/failure paths, alternatives, risks, auth/egress/state and test mapping. Include event/persistence/API artifacts only when relevant. Use existing OpenSpec/ADR, request approval for unresolved material choices. Do not implement.

## Plan
> Convert approved design into smallest dependency-ordered phases in the existing canonical plan. Each phase: goal, exact new/modified paths, preconditions, invariants, RED/negative case, commands, expected evidence, stop conditions. Reuse installed upstream first. No speculative parallel frameworks.

## Implement and audit
> Implement one unblocked slice; run affected tests. Then perform four separate passes: (G1) build/test/lint with observed command/exit, (G2) architecture and accepted design compliance, (G3) security/auth/egress, (G4) completeness against plan/tests. Every pass returns PASS, FAIL, UNKNOWN or N/A with proof; fix failures and rerun. One agent's passes do not equal independent review. Commit, push, update PR and report exact SHA/CI.

## Final review
> Inspect all phases together: DI, public error contracts, source freshness, trust boundaries, duplicate/orphan code, partial failure, appropriate real provider E2E. Report tests passed/failed/not run and owner decisions. No production certification without required evidence.

## Checkpoint
> Save branch/HEAD/PR, approved plan and docs, current phase, commands/logs and gate states, blockers, unrelated edits and next exact operation. On resume inspect real worktree and fresh source rather than assuming checkpoint truth.
