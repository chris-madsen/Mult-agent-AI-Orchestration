# Video SDLC — source reconstruction, provenance, and ACE adaptation

This directory records a **file-by-file reconstruction** of the methodology demonstrated in [the 52-minute video](https://www.youtube.com/watch?v=7oRBHxMvWxQ), grounded only in [user-supplied WebP screenshots](https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K) and video transcript summaries. PNG duplicates were not inspected.

**DO NOT mistake this reconstruction for the author's actual repository or source files.** The screenshots are incomplete. Each reconstructed file lists source frames, what is actually visible, and separately authored continuation. Files whose name alone is visible contain an explicitly proposed substitute, not an allegedly recovered original prompt.

## Structure and migration

- `source/commands/`: eight files named in the video. Research/design/implementation are reconstructed in detail; other command bodies are unshown, so substitutes are identified as such.
- `source/agents/`: four named persistent agent prompts; only codebase-researcher has its own visible body.
- `source/standards/`: ten Go-backend standards seen by name or brief description, restored as Markdown reference guides; full original .txt contents are **not** visible.
- `source/examples/user-avatar/`: observed feature-design outputs and 8 implementation-phase templates; illustrative example, **not** claims about ACE architecture.
- `source/templates/`: research, progress checkpoint, manual QA artifacts referenced by video prompts.
- `ACE-SINGLE-AGENT-SDLC.md`: **new ACE adaptation**, distinct from source reconstruction and explicitly agent-neutral.
- `ADOPTION-PLAN.md`: staged implementation guidance, compatibility and proof obligations.

## Evidence and trust

1. **Visible** — filename, title, rule or content is actually readable on a WebP frame.
2. **Inferred** — subject matter is supported by directory tree, plan overview or named reviewer role, not the complete file text.
3. **Reconstructed completion** — newly written executable guidance that fills gaps; never attribute this wording to the video.

Citations inside each file use the user's Google Drive source folder and image number. No Go-specific rule is automatically applied to ACE. The source subtree is historical research, not root-level agent instructions and not executable production policy.

## Source-group index

| Screenshots | Subject |
|---|---|
| IMG_5595–5599 | research command, codebase-researcher, research artifact and agent directory |
| IMG_5602–5606 | design_feature, conditional outputs and research synthesis |
| IMG_5607–5611 | design deliverables: architecture, behavior, decisions |
| IMG_5613–5616 | testing, persistence mapping, API contract |
| IMG_5619–5625 | implementation plan, per-phase files, file maps |
| IMG_5626–5639, 5641 | implementation command, reviewer prompts and iterative gates |
| IMG_5642 | bugfix manual QA and context-window protocol |

Read `SOURCE-TRACEABILITY.md` for an itemized evidence-to-file map and unavoidable unknowns.
