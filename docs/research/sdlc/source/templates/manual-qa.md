# Manual QA / smoke test flow

## Identity
- Feature and requirement ID:
- Tested source commit / PR:
- Operator, date and environment:
- Backend service / endpoint/tool version:
- Real provider or test double:
- Authorization identity/scope (no secrets):
- Data classification and permitted outbound calls:

## Preconditions
- Disposable fixture and cleanup:
- Required services and health checks:
- Provider/model/SDK and schema version:
- Feature flag and configuration state:
- Correlation/log location:
- Reversible operations only; warn on any billable or destructive action.

## Test cases
| ID | Scenario | Expected status | Expected state/side effect | Security property |
|---|---|---|---|---|
| QA-01 | normal input | ... | ... | authorized |
| QA-02 | missing/invalid input | 4xx/typed | none | no leak |
| QA-03 | denied principal | denied | zero provider calls | fail closed |
| QA-04 | missing entity | 404/typed | none | no existence leak |
| QA-05 | repeated mutation | stable response | one effect | idempotency |
| QA-06 | provider unavailable | unavailable/partial | no false success | no forbidden fallback |
| QA-07 | cancel midflight | typed cancel | no untracked effect | cleanup |
| QA-08 | stale source | stale/changed | no false current | source integrity |

## Request execution example
Replace placeholders with an actual safe local endpoint and fixture; never claim commands below were run until observed.

```bash
curl --include --request POST \
  --url 'http://127.0.0.1:<port>/<path>' \
  --header 'Content-Type: application/json' \
  --data '{"example":"replace-me"}'
```

**Expected:** exact status, response schema, stable error code and persisted state.
**Observed:** command/output/exit, redacted for secrets.

## Side effect verification
- Before state:
- After state:
- Provider requests/receipts:
- Idempotency keys or correlation:
- Retry attempts and backoff:
- Cleanup/compensation:
- Audit record:
- Unexpected egress:
- Crash/restart observation:

## Results
| Case | PASS/FAIL/NOT-RUN/UNKNOWN | Command/result evidence | Issue |
|---|---|---|---|

## Release notes
- Unexecuted cases and reason:
- Root cause for failures:
- Related automated tests:
- Compatibility/migration:
- Owner approval:
- Proof bound to exact source/runtime identity:
