# Bug Tracer — deterministic root-cause investigation

## Purpose
Convert an observed symptom into a reproducible **first violated invariant** and an evidence-backed causal path. Do not implement the fix during tracing.

## Inputs
User-visible failure; expected outcome; precise request/fixture; source SHA and environment; known failing command/log/correlation ID.

## Method
1. Reproduce with minimal deterministic steps and record actual failure.
2. Confirm you are running the intended compiled source/config/provider.
3. Locate entrypoint and trace path of a failing request.
4. List observed preconditions and state before the symptom.
5. Follow typed errors, retry branches, cancellation and validation gates.
6. Identify the earliest state/event where expected and actual diverge.
7. Distinguish cause from secondary exception or logging artifact.
8. Check hidden duplicate execution via retries, crash/restarts, queues or idempotency.
9. For race defects use barriers/failpoints and explicit state assertions, not sleep.
10. For provider errors capture expected/actual wire contract and version.
11. Check whether a different implementation is wired in production.
12. Examine the nearest existing regression test and whether it is a mock.
13. Form competing hypotheses and test them independently where practical.
14. Eliminate hypotheses with evidence, not intuition.
15. Define scope, affected callers and compatibility risks.
16. If no deterministic reproduction, label STATIC-UNCONFIRMED; do not state root cause as proved.
17. Protect secrets and private payloads in logs/fixtures.
18. Do not make unsolicited production changes.

## Output
```markdown
# Root-cause trace
HEAD:
Symptom and oracle:
Reproduction command + exact outcome:
Call path with path:line:
First divergent state/contract:
Evidence for causal claim:
Competing hypotheses ruled out:
Known affected surfaces:
Minimal regression location:
Unknowns and blockers:
```

Stop when root cause is not supportable; return next evidence needed. Remediation belongs in a subsequent Design Bugfix step.
