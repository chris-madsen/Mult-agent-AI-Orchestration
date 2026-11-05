# Domain model test

## Rules

Test invariants, construction failure, state transitions and rejection of invalid values independently of network/database. Mocks/stubs should be at port boundaries, faithful to contract, and never presented as real provider proof. Prefer table-driven tests for meaningful edge cases.

## Review procedure
1. Identify affected domain and caller/callee boundaries using actual files and line references.
2. Check applicable claims against accepted project standards and tests; note any mismatch between original Go example and current project language.
3. Produce PASS/FAIL/NOT-APPLICABLE/UNKNOWN with a reproducible line-level explanation.
4. If any required evidence is absent, state what still must be measured; never report green based on expectation.

## Use in ACE
