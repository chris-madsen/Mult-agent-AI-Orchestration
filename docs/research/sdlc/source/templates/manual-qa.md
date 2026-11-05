# Manual QA / smoke flow

## Preconditions
Environment, service version/SHA, base URL (non-secret), data-fixture setup, authentication method and scope.

## Happy path
```bash
curl -i -X <METHOD> '<URL>' -H 'Content-Type: application/json' -d '<request>'
```
Expected HTTP status, JSON schema and persisted side effects.

## Negative and edge paths
- Missing/malformed payload, missing permissions, unknown identifier, repeated request and simulated dependency failure.
- Expected status, stable application error code, no secret disclosure, recovery behavior.

## Results
Record real commands, responses redacted for secrets, SHA and operator. Unexecuted commands remain NOT-RUN.
