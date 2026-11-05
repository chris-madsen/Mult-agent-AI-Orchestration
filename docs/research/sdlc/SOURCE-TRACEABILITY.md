# Source-to-file traceability and reconstruction rules

**Method:** WebP stills and video transcript; non-visible content is never called recovered source. The images show an IDE and partial scroll positions, not a repository archive.

| Source original | WebP frames | Support | Reconstruction boundary |
|---|---|---|---|
| .claude/commands/research_codebase.md | 5595,5597,5598,5599 | direct visible body | bridge omitted scroll portions, agent-neutral implementation |
| .claude/agents/codebase-researcher.md | 5596 | direct body excerpt | extend output/evidence requirements |
| .claude/commands/design_feature.md | 5602,5603,5604,5605,5606 | selected body | missing middle design instructions authored as completion |
| .claude/commands/implement_backend.md | 5627–5639 | extensive body | team APIs/rules retained conceptually; missing fragments reconstructed |
| .claude/commands/fix_backend_bug.md | 5642 | end of file only | earlier steps are newly authored, not source-derived |
| .claude/commands/design_bugfix.md | 5595,5602 | name only | complete substitute, no claimed body fidelity |
| .claude/commands/design_frontend_feature.md | 5595,5602 | name only | complete substitute |
| .claude/commands/fix_frontend_bug.md | 5595,5602 | name only | complete substitute |
| .claude/commands/implement_frontend.md | 5595,5602 | name only | complete substitute |
| .claude/agents/architect-reviewer.md | 5596 | name only | complete inferred reviewer prompt |
| .claude/agents/blast-radius-analyzer.md | 5596 | name only | complete inferred prompt |
| .claude/agents/bug-tracer.md | 5596 | name only | complete inferred prompt |
| prompts/be/*.txt (10 files) | 5603,5629–5631 | filename + summarized demands | Markdown summaries are newly authored approximations; Go conventions MUST NOT be applied to TS directly |
| docs/user-avatar/01-04,06,08,README | 5607–5616,5627 | filenames + selected content | synthetic templates based on observed artifact types |
| docs/user-avatar/05-events.md | 5602 | conditional mention only | OPTIONAL template, not claimed created in video |
| docs/user-avatar/07-standards.md | 5602,5627 | filename only | purpose inferred |
| docs/user-avatar/plan/README.md and phase-01..08.md | 5619–5625,5627 | complete phase list, partial examples | individual plans are templates; missing phase bodies were not shown |
| .thoughts/research and progress; manual_qa | 5597–5599,5642 | target paths and partial template | filled-in template for reuse, not original completed report |

## Confidence discipline

Do not use a name-only reconstruction as evidence that the original author specified the included wording. If actual original repository files become available, replace only after diffing original text and updating this table. Distinguish documentation generated as part of a sample feature from reusable workflow instructions.
