# SDLC prompt library — delivery report

PR: https://github.com/chris-madsen/Mult-agent-AI-Orchestration/pull/222
Status: documentation change on a feature branch; production implementation not implied.

## Repairs to the initial version
The first deliverable contained prompts too short to drive an engineering workflow. They have now been expanded into independent instruction files with:
- explicit input contracts, constraints and failure conditions;
- current-revision research with code-level evidence;
- conditional design artifacts and architecture/behavior/test matrices;
- phase decomposition and specific RED/GREEN oracles;
- four separate review passes with defect repair loops;
- PR/CI evidence and durable context checkpoints;
- TypeScript/Effect and ACE gateway/RAG/privacy rules;
- runnable templates and prompt acceptance scenarios.

## Primary runnable files
- source/commands/research_codebase.md
- source/commands/design_feature.md
- source/commands/implement_backend.md
- source/commands/fix_backend_bug.md
- source/commands/design_bugfix.md
- source/commands/design_frontend_feature.md
- source/commands/implement_frontend.md
- source/commands/fix_frontend_bug.md

Each commands file is independent of a particular AI client. The source/agents directory holds research, architecture-review, blast-radius and bug-trace procedures. The source/standards directory contains 10 distinct standards. PROMPTS-ACE.md is a routing/entrypoint layer that loads the full file for each stage, not a replacement for those files.

## Open source methods consulted
See REFERENCE-PROJECTS.md. The most closely matching research material was located in HumanLayer's indexed research command and parcadei/continuous-claude-v3. The other projects contribute detailed planning, inline execution, code review, testing and pre-build gate techniques.

## Limitations
The screenshots did not expose every original prompt from the presenter; descriptions were expanded using source-grounded behaviors and independently authored instructions. The materials must not be represented as recovered verbatim private source. The present PR does not demonstrate that an agent has followed these prompts successfully in an actual ACE coding task.

## Remaining validation
- Verify PR file inventory and CI at exact pushed HEAD.
- Review Markdown internal paths and stage references.
- Run the prompt acceptance scenarios on a controlled example.
- Apply complete SDLC to an unresolved ACE task in a separate PR and capture real tests and human review.

## Quality Gates research update (2026-11-05)

Added [QUALITY-GATES-VIDEO-SPHERICON-ACE.md](QUALITY-GATES-VIDEO-SPHERICON-ACE.md), [QUALITY-GATES-CATALOG.md](QUALITY-GATES-CATALOG.md) and [QUALITY-GATES-IMPLEMENTATION-PLAN.md](QUALITY-GATES-IMPLEMENTATION-PLAN.md), plus a full Quality Gates reviewer standard and a portable skill. Updated operational SDLC, design/implementation prompts, phase template and documentation index.

The Sphericon repository was inspected directly: actual task definitions, CI/nightly workflow division, ast-grep rule tests, package boundary configuration, schema and contract checks, secrets/Actions scanners, generated-code ownership and toolchain. Video summary evidence came from publicly accessible description and secondary summary; connected transcript unavailable due user account limit. No unverified transcript quotes or timestamps claimed.

This is a **documentation/process change**, not installation of new automation. Existing ACE CI remains authoritative and future QG0–QG8 tool PRs are described in the plan. New G02 Design Consistency is a procedural requirement for T2 designs; no false CI PASS claimed.
