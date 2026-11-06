# Base Mock — test doubles at explicit ports

## Goal
Provide reliable controlled behavior of external ports without confusing simulated and live provider evidence. The source Go service uses a BaseMock convention; ACE is not required to port that library.

## Rules
1. Mock interfaces at application/adapters boundary, not domain values.
2. Keep fakes small and explicit about behavior.
3. No hidden catch-all mock that returns success for unexpected calls.
4. Record invocation count, args and order only when relevant to contract.
5. Use strict fail-on-unexpected-call for security-sensitive routes.
6. Represent error/timeout/cancellation and partial response explicitly.
7. Avoid fake data that violates real provider schema.
8. For retries test at exact layer to avoid hidden multiplicative behavior.
9. For idempotent tool calls verify one side effect despite retry.
10. For policy denial verify provider was **not called**.
11. Fakes should be reset between test cases.
12. Use scoped lifetimes and deterministic clock/scheduler.
13. Model malformed wire data separately from transport errors.
14. Do not assert exact large prompt texts when semantic contract matters.
15. Preserve schema contract from official SDK where possible.
16. Separate provider-conformance tests that require real SDK from unit mock tests.
17. Keep a provider identity on real evidence.
18. Never mark an adapter production-ready from mock-only tests.

## Test matrix
| Scenario | Double returns | Required assertion |
|---|---|---|
| Normal | schema-valid response | mapped result correct |
| Denied | should not be invoked | zero calls |
| Timeout | explicit timeout error | typed unavailable, no false empty |
| Partial | incomplete sources | partial status |
| Retry | one 503 then success | bounded attempts |
| Crash window | replay request | no duplicate side effect |
| Malformed | invalid DTO | safe failure, no invented result |

## ACE note
Reuse existing Node test doubles and real-provider suites; do not add a new BaseMock dependency solely to emulate the Go screenshot.
