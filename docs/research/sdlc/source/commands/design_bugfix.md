# design bugfix — name-only reconstruction

> **Source reconstruction — not an original file.** Original path: `.claude/commands/design_bugfix.md`. Evidence: https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5595); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5602). Confidence: **filename only; body NOT visible**. This is a newly written functional substitute, not a transcription.
>
> Sections under **Reconstructed completion** are newly authored instructions inferred from visible fragments and engineering intent. They are **not quotations** from the creator. For exact source text use the screenshots.


## Reconstructed completion — executable substitute
Produce a root-cause-supported minimal fix design. Capture reproduction, violated invariant, affected boundaries and a RED regression before proposing changes. Compare options and backwards-compatibility implications. Approval gate: no speculative sweeping refactor.

**Inputs:** user goal; code and existing test evidence; accepted constraints; target runtime. **Outputs:** smallest necessary design/plan/diff and verified evidence report.

**Mandatory gates:** source and accepted-ADR compatibility; tests run vs skipped; security and trust boundary; requirement→acceptance mapping; PR with exact head SHA. Human review for irreversible decisions. Do not claim original prompt wording.
