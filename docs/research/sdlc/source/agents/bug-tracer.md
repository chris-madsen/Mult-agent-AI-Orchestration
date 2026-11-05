# Bug tracer

## Procedure
Trace the reported failure from user-visible effect through relevant call path to the first violated invariant. Reproduce with deterministic fixture, record expected/actual behavior and commit identity, inspect logs and error handling, distinguish root cause from downstream symptom. Prefer precise source reads to assumptions. For concurrency defects use deterministic barriers/failpoints instead of time sleeps. If reproduction is unavailable, mark STATIC-UNCONFIRMED.

Return: observable symptom, reproduction command, path/line trace, root-cause hypothesis with evidence, impact and tests to add or amend. Do not silently fix code during trace.
