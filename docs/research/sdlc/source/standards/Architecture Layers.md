# Architecture Layers

## Rules

Document the allowed direction between HTTP/controller, application/use case, domain and infrastructure adapter boundaries. Review imports and runtime dependency injection, not just directory names. Domain types must not import adapters. Identify cycles and secret provider dependencies. For ACE use its accepted TypeScript/Effect DDD/ports contracts, not the Go package layout.

## Review procedure
1. Identify affected domain and caller/callee boundaries using actual files and line references.
2. Check applicable claims against accepted project standards and tests; note any mismatch between original Go example and current project language.
3. Produce PASS/FAIL/NOT-APPLICABLE/UNKNOWN with a reproducible line-level explanation.
4. If any required evidence is absent, state what still must be measured; never report green based on expectation.

## Use in ACE
