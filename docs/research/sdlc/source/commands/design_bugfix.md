# design bugfix — name-only reconstruction

> **Source reconstruction — not an original file.** Original path: `.claude/commands/design_bugfix.md`. Evidence: https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5595); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5602). Confidence: **filename only; body NOT visible**. This is a newly written functional substitute, not a transcription.
>
> Sections under **Reconstructed completion** are newly authored instructions inferred from visible fragments and engineering intent. They are **not quotations** from the creator. For exact source text use the screenshots.


## Reconstructed completion — executable substitute
Produce a root-cause-supported minimal fix design. Capture reproduction, violated invariant, affected boundaries and a RED regression before proposing changes. Compare options and backwards-compatibility implications. Approval gate: no speculative sweeping refactor.

**Inputs:** user goal; code and existing test evidence; accepted constraints; target runtime. **Outputs:** smallest necessary design/plan/diff and verified evidence report.

**Mandatory gates:** source and accepted-ADR compatibility; tests run vs skipped; security and trust boundary; requirement→acceptance mapping; PR with exact head SHA. Human review for irreversible decisions. Do not claim original prompt wording.

## Fully reconstructed executable continuation (name only in source)
This section is **not** attributed to the original video's prompt. It is a usable substitute with explicit inputs/outputs.

**Inputs:** user goal, scope, current implementation, accepted design (if relevant), exact branch/commit, risk tier.

**Process:** Document symptom and exact RED fixture, trace root cause with path:line, compare the smallest reversible designs, map failure states/contract impacts and propose one phase with explicit negative cases. Produce a written minimal design and owner decisions before code when needed.

**Verification:** list actual commands and results; include exact file:line proof and a requirement→test map, explain N/A and UNKNOWN; do not assume screenshots or runtime checks happened. Preserve unrelated worktree edits. Create focused PR, avoid direct-to-main writes. Production acceptance requires the project's real-provider evidence and owner review.

**Deliverable:** Summary, Change plan, Code/test evidence, Four-gate review table, Open decisions/blockers, PR SHA and next action.
