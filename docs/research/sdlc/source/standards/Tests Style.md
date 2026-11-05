# Tests Style

## Rules

The Go example uses test suites, t.Parallel(), Arrange–Act–Assert and targeted assertions. For ACE transfer the ideas, not the syntax: project-native Node test runner, deterministic fixtures, narrow assertions, no unbounded sleeps and no duplicated E2E coverage unless it proves unique provider wiring.

## Review procedure
1. Identify affected domain and caller/callee boundaries using actual files and line references.
2. Check applicable claims against accepted project standards and tests; note any mismatch between original Go example and current project language.
3. Produce PASS/FAIL/NOT-APPLICABLE/UNKNOWN with a reproducible line-level explanation.
4. If any required evidence is absent, state what still must be measured; never report green based on expectation.

## Use in ACE
