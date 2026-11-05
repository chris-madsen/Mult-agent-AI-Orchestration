# AI-assisted SDLC — full working prompts, standards and ACE integration

This directory contains a **multi-file practical instruction set**, designed for one coding agent and portable across Codex, Claude Code, OpenCode, Gemini CLI, Cursor and similar tools. The source-methodology was demonstrated in the [AI SDLC video](https://www.youtube.com/watch?v=7oRBHxMvWxQ); missing instructions were expanded using working engineering practices and comparable public projects. These are maintained working files, not a verbatim archive of the presenter’s private repository.

## Start here
1. Read [ACE operational SDLC](../../operations/ai-assisted-sdlc.md).
2. Use [PROMPTS-ACE.md](PROMPTS-ACE.md) to choose the stage.
3. Read the **complete command file** linked for that stage.
4. Read relevant engineering standards and the repository's accepted ADR/OpenSpec.
5. Record actual acceptance/evidence in canonical plan/PR.

## Command files
- [research_codebase.md](source/commands/research_codebase.md) — fact-only investigation, source citations, runtime wiring and evidence ledger.
- [design_feature.md](source/commands/design_feature.md) — conditional research, architecture, behavior, decisions, testing, event/persistence/API contracts.
- [design_bugfix.md](source/commands/design_bugfix.md) — bounded remediation design and test oracle.
- [implement_backend.md](source/commands/implement_backend.md) — complete phase executor, RED/GREEN and four detailed gates.
- [fix_backend_bug.md](source/commands/fix_backend_bug.md) — reproduction, root-cause, blast radius, repair, regression and QA.
- [design_frontend_feature.md](source/commands/design_frontend_feature.md) — only for actual UI work.
- [implement_frontend.md](source/commands/implement_frontend.md) — phased UI implementation.
- [fix_frontend_bug.md](source/commands/fix_frontend_bug.md) — UI defect diagnosis and repair.

## Analytic/reviewer roles
- [codebase-researcher.md](source/agents/codebase-researcher.md)
- [architect-reviewer.md](source/agents/architect-reviewer.md)
- [blast-radius-analyzer.md](source/agents/blast-radius-analyzer.md)
- [bug-tracer.md](source/agents/bug-tracer.md)

A single agent can run these as distinct sequential instruction sets. This does not create independence that is not present.

## Engineering standards
- [Architecture Layers](source/standards/Architecture%20Layers.md)
- [Clean architecture](source/standards/Clean%20architecture.md)
- [Domain Model](source/standards/Domain%20Model.md)
- [Builder](source/standards/Builder.md)
- [RepoModel](source/standards/RepoModel.md)
- [Tests Style](source/standards/Tests%20Style.md)
- [Domain model test](source/standards/Domain%20model%20test.md)
- [Go style](source/standards/Go%20style.md) — only where Go applies; not ACE core.
- [Base Mock](source/standards/Base%20Mock.md)
- [LLM Integration](source/standards/LLM%20Integration.md)

## Artifacts and examples
- [Template: research](source/templates/research-output.md)
- [Template: implementation phase](source/templates/phase-template.md)
- [Template: progress checkpoint](source/templates/progress-checkpoint.md)
- [Template: manual QA](source/templates/manual-qa.md)
- [Example: user-avatar design and 8-phase plan](source/examples/user-avatar/README.md) — illustrative Go service, not ACE modules.
- [Single-agent ACE architecture](ACE-SINGLE-AGENT-SDLC.md)
- [Adoption plan](ADOPTION-PLAN.md)
- [Prompt acceptance scenarios](PROMPT-ACCEPTANCE-SCENARIOS.md)
- [Related open source projects](REFERENCE-PROJECTS.md)
- [Delivery report](REPORT.md)

## Core behavior
Research documents **facts only**. Design proposes changed behavior and accepts human decisions. Plan defines dependency-ordered slices and exact test oracles. Implement executes one slice and four separate quality reviews with proof. A failure returns to repair; a successful phase is committed and delivered in a PR. Final cross-phase and real-provider checks happen before any production claim.

## ACE constraints
Root AGENTS.md, Accepted ADRs, OpenSpec and existing CI retain full authority. No automatic 5× savings claim, no model-bound Bifrost claim from MCP-only tests, no false source freshness, no unauthorized cloud egress, no Go-style runtime rewrite and no second agent orchestrator.

## Quality Gates and reusable reviewer procedure

- [Video + Sphericon evidence and ACE gap audit](QUALITY-GATES-VIDEO-SPHERICON-ACE.md)
- [Complete Quality Gate catalog, G00–G14](QUALITY-GATES-CATALOG.md)
- [Phased tool implementation plan](QUALITY-GATES-IMPLEMENTATION-PLAN.md)
- [Quality Gates reviewer standard](source/standards/Quality%20Gates.md)
- [Portable gate-selection skill](skills/quality-gate-selection/SKILL.md)

The operational SDLC routes Design G02 before code and directs the one-agent reviewer to apply actually installed checks. These documents do **not** mean the optional scanners are already enabled in GitHub Actions.

## Functional DDD, TypeSpec and original Matt skills

- [Owner-selected functional DDD + TypeSpec architecture](ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md): Event Storming, ADT, pure functions and Effect shell.
- [Expanded TypeSpec codegen coverage](TYPESPEC-CODEGEN-COVERAGE.md): server interfaces, SDK, validators, mapping, permission metadata, test fixtures/docs and fail-on-unmapped gates.
- [Vendored Matt Pocock skills manifest](MATT-POCOCK-SKILLS.md): 23 selected original MIT skills from version v1.3.2 used by Sphericon, with single-agent/OpenSpec overrides.
- [Functional Domain Modeling standard](source/standards/Functional%20Domain%20Modeling.md)
- [TypeSpec Contract First standard](source/standards/TypeSpec%20Contract%20First.md)
- [Project-owned ACE TypeSpec Codegen skill](../../../.agents/skills/ace-typespec-codegen/SKILL.md)

TypeSpec generation and codegen CI are **selected future work**, not claims of an installed compiler. Domain business rules remain in cohesive pure functions, not generated handler bodies.
