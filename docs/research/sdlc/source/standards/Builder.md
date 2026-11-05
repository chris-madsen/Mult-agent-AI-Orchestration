# Builder

## Rules

The original example mentions a three-stage builder: checkRequired -> fillDefault -> validateBusiness. Distinguish missing required values, defaultable configuration and business invariants. Only use the Builder pattern where it reduces complexity; don't invent one for trivial immutable TS structures.

## Review procedure
1. Identify affected domain and caller/callee boundaries using actual files and line references.
2. Check applicable claims against accepted project standards and tests; note any mismatch between original Go example and current project language.
3. Produce PASS/FAIL/NOT-APPLICABLE/UNKNOWN with a reproducible line-level explanation.
4. If any required evidence is absent, state what still must be measured; never report green based on expectation.

## Use in ACE
