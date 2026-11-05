# Domain Model

## Rules

Use domain entities/value objects with explicit invariants, validate at construction or trusted boundaries, avoid impossible states and raw primitive confusion where domain meaning matters. Define public state transitions and typed failure. The original Go screen references private fields/getters; in ACE choose idiomatic TS readonly types and branded value objects when justified, not mandatory getters for every field.

## Review procedure
1. Identify affected domain and caller/callee boundaries using actual files and line references.
2. Check applicable claims against accepted project standards and tests; note any mismatch between original Go example and current project language.
3. Produce PASS/FAIL/NOT-APPLICABLE/UNKNOWN with a reproducible line-level explanation.
4. If any required evidence is absent, state what still must be measured; never report green based on expectation.

## Use in ACE
