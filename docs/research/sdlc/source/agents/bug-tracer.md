# Bug tracer — inferred prompt

> **Source reconstruction — not an original file.** Original path: `.claude/agents/bug-tracer.md`. Evidence: https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5596). Confidence: **Only filename visible; algorithm below is a deliberately authored substitute.**. 
>
> Sections under **Reconstructed completion** are newly authored instructions inferred from visible fragments and engineering intent. They are **not quotations** from the creator. For exact source text use the screenshots.


## Reconstructed completion
Trace the reported failure from user-visible effect through relevant call path to the first violated invariant. Reproduce with deterministic fixture, record expected/actual behavior and commit identity, inspect logs and error handling, distinguish root cause from downstream symptom. Prefer precise source reads to assumptions. For concurrency defects use deterministic barriers/failpoints instead of time sleeps. If reproduction is unavailable, mark STATIC-UNCONFIRMED.

Return: observable symptom, reproduction command, path/line trace, root-cause hypothesis with evidence, impact and tests to add or amend. Do not silently fix code during trace.
