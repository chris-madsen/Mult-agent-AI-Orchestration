# Tests Style — cheapest strong proof of behavior

## Values
One test should prove a clear observable behavior. Prefer deterministic assertions, meaningful failures and a curated portfolio to a larger count of nearly identical tests.

## Procedure
1. Start from invariant or acceptance criterion, not implementation detail.
2. Find current cheapest test owner before adding a file.
3. Use Arrange → Act → Assert with clearly named fixtures.
4. Assert result, side effects and negative conditions when needed.
5. Avoid fragile snapshot tests for nondeterministic provider output.
6. Keep clocks, random seeds and external dependencies controllable.
7. Prefer table-driven cases for boundary values.
8. Use exact structured error assertions, not only "throws".
9. Check that unauthorized access performed no forbidden side effect.
10. Use deterministic barriers/failpoints for races; do not assert sleep timing.
11. Separate unit, contract, process, provider and agent E2E by distinct evidence roles.
12. Avoid fake provider tests that claim live integration.
13. Don't run a full costly suite per edit; select affected tests conservatively.
14. Use real SDK client when verifying SDK protocol contract.
15. If test can pass with an intentionally broken implementation, the oracle is weak.
16. Avoid duplicated tests across levels unless higher level proves unique wiring.
17. Preserve raw evidence when benchmark or release gate requires it.
18. Record exact test command, exit code and source SHA.

## TypeScript / Node example
```ts
import test from "node:test";
import assert from "node:assert/strict";

test("denied egress makes no provider request", async () => {
  const fake = createSpyProvider();
  const result = await invokeDeniedRequest(fake);
  assert.equal(result.kind, "policy_denied");
  assert.equal(fake.callCount, 0);
});
```
The code is illustrative only; use real ACE test helpers and interfaces.

## Reviewer question
What broken code would fail this test? If answer is vague, improve oracle instead of adding another identical test.
