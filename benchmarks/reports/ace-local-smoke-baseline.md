# Comparison report ace-local-smoke-baseline

- Suite: ace-harness-local-smoke v1
- Frozen suite: `17a89ffad4a0605cba707eabc39a882a99d531aab57add853a8bacfc9cfc46fd`
- Runs: 2; successful: 1
- Quality pass rate: 0.5
- Evidence hash: `9bbba3a3c44e47785d51364c746a24e50f0b126787349685115f9d80656c6289`

| Run | State | Quality | Total tokens | Cost USD |
|---|---|---|---:|---:|
| harbor-oauth-success | Recorded | passed | 60298 | 0.00367496 |
| harbor-api-key-failure | RecordedIncomplete | unknown | unknown | unknown |

## Limitations
- One successful smoke task is not a baseline-vs-ACE comparison.
- The failed API-key run is retained as an incomplete run and contributes no success.
- No 5x claim is permitted; the repeated native-vs-ACE holdout report is retained separately because the baseline smoke is a different historical run.
