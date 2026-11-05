# ACE SDLC adoption plan, current-state-aware

## Delivered in this documentation PR
- Full source reconstruction under docs/research/sdlc/source: eight commands, four named persistent agents, ten standards converted to Markdown and screenshot-grounded feature-design/phase example.
- Per-file provenance and visible-versus-reconstructed distinctions.
- ACE one-agent adaptation, copy/paste prompts and canonical operational workflow.
- No changes to agent runtime, LangGraph or production semantics. No claim of independent review, live-provider acceptance or token savings.

## Stage A — enable guidance without tool lock-in
- Root AGENTS.md remains canonical; link, do not duplicate the operational workflow.
- Existing accepted ADRs/OpenSpec supersede examples from the video.
- Define T0/T1/T2 scope and evidence formats in docs/operations/ai-assisted-sdlc.md.
- Manual invoke by an agent with ordinary natural language. No slash command dependency.

## Stage B — one real demonstration PR (separate future coding PR)
- Pick one unclosed, source-verified ACE reliability bug; inspect open PRs before assigning task.
- Record research with file:line evidence, design decision and T1/T2 plan.
- Execute RED→GREEN and four sequential checks, capturing exact commands + CI run.
- Run relevant real-provider acceptance rather than accepting mock-only pass; preserve logs.
- Final cross-phase acceptance + human review. This is the evidence needed to mention the workflow in CV.

## Stage C — tighten gates selectively
- Audit missing controls (secret scanning, dependency/architecture/Markdown link checks) against the actual repository and existing workflow, do not assume any are absent without inspecting their active configuration.
- Add low-cost checks only when their failure semantics and owners are clear. Tests are a curated portfolio, not an append-only pile.
- For large T2 changes include conditional C4/DFD/sequence and strict phase-file mapping.
- Keep expensive provider/k3s/Harbor checks capability-scoped; collect exact SHA and artifacts.

## Explicit exclusions
- Four runtime reviewers, TeamCreate and Claude-specific APIs.
- Porting Go-style Builders, BaseMock, test packages into TS/Effect without evidence.
- A second OpenSpec, CI runner or plan authority.
- Automatic production sign-off, unverified cost/quality claims and direct-to-main changes.

## Definition of done
- Documentation is discoverable and no existing normative rule is weakened.
- At least one actual implementation PR is completed with RED/GREEN, four passes, exact CI SHA and owner review.
- Only then consider CV statement about having *applied* the AI-assisted SDLC, citing the implementation PR.
