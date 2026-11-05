# Base Mock

## Rules

The original project references a BaseMock library in Go test doubles. Its actual source and API are not visible. Do not recreate BaseMock in ACE. Use existing test harness doubles for behavioral contracts, mark as mocks and keep real-provider acceptance separate.

## Review procedure
1. Identify affected domain and caller/callee boundaries using actual files and line references.
2. Check applicable claims against accepted project standards and tests; note any mismatch between original Go example and current project language.
3. Produce PASS/FAIL/NOT-APPLICABLE/UNKNOWN with a reproducible line-level explanation.
4. If any required evidence is absent, state what still must be measured; never report green based on expectation.

## Use in ACE
