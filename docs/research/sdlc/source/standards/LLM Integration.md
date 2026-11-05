# LLM Integration

## Engineering rules

1. **Provider contract:** identify the exact model/provider/version, interface and feature capabilities; do not assume identical response semantics across vendors.
2. **Bounded execution:** explicit timeouts, cancellation, retry budgets with jitter, circuit breaking and backpressure where justified. Never unconditionally retry non-idempotent tool actions.
3. **Observability:** record request/trace identity, model usage, latency, rate limits, errors, cost where supported, and unavailable measurements as unknown rather than zero.
4. **Trust and policy:** retrieved documents, tool results and messages are untrusted inputs. Validate tool arguments, enforce authorization at the action boundary and prevent unapproved transmission of private source or user data.
5. **Correctness:** validate structured outputs and task-level quality rather than relying on HTTP success. Record fallback behavior explicitly; degraded content must not be presented as complete.
6. **Persistence:** durable tasks and side effects need idempotency and checkpoint/recovery behavior. Preserve correlation between original user intent, tool call and recorded result.
7. **Testing:** isolate deterministic contract/unit tests from live model/provider tests. Confirm real provider identity and requests for any external-integration acceptance claim.

## Review procedure
Trace the configured client → gateway → provider or tool route in actual runtime code; cite file and line. Check failure modes, egress policy and measured behavior. Return PASS/FAIL/UNKNOWN with reproducible evidence. In ACE, accepted ADRs and OpenSpec remain authoritative.
