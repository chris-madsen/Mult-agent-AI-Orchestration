# Builder — separate required data, defaults and business validation

## Core protocol
When object construction genuinely needs defaults and validation, separate three logical concerns:
1. `checkRequired` — ensure caller supplied all required fields.
2. `fillDefault` — set *authorized* defaults for optional inputs.
3. `validateBusiness` — ensure resulting object satisfies domain constraints.

These are semantic stages, not necessarily three physical methods in every language.

## Rules
1. Determine if a Builder pattern is warranted; use direct immutable factory for simple types.
2. Clearly distinguish user-supplied value, default and derived value.
3. Run required checks before expensive processing.
4. Do not default a security-critical identity or authorization scope.
5. Do not silently turn invalid input into valid-looking default.
6. Reject unknown enum and impossible state values.
7. Cross-field validation happens after values are normalized.
8. Diagnostics avoid secrets and private source content.
9. No partly constructed mutable entity can escape a failed build.
10. Map validation errors to typed failures with stable public representation.
11. Time-dependent defaults use injected clock where test requires determinism.
12. Externally supplied IDs should be validated at trust boundary.
13. Defaults are versioned or audited when changing them changes compatibility.
14. Avoid chaining builders that obscure data provenance.
15. Distinguish data construction from restoration from trusted persistence.

## ACE translation
Default to **pure factories and readonly ADTs**, returning typed domain errors. Builders and setters are optional, not an OO requirement. Once TypeSpec generates public schemas, avoid hand-maintained duplicate boundary schemas; runtime decoding is still required. No Go-specific builder mandate. For stored memory, original provenance must be restored and validated without manufacturing owner approval.

## Tests
Valid required inputs; omitted optional; invalid required; invalid cross-field; explicit null vs missing; unsafe default rejection; restoration/migration; no partial mutation. Include a table for each rule.

## Review
Where is default applied? Who is authorized to choose it? Which invariant guards the result? Which error appears? If any answer is unknown, request evidence.

## Functional implementation

A pure `makeValue(input): Result<Value, Error>` can perform required checks, safe defaults and domain validation without retaining partially mutable objects. TypeSpec owns external shapes; explicit adapter maps decoded DTO to ADT. Do not generate constructors from wire DTOs if that bypasses domain invariants.
