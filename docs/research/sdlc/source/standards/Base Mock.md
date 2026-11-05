# Base Mock.txt — reconstructed reference

> **Original filename:** `prompts/be/Base Mock.txt`. Source: [WebP IMG_5629](https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K). **Evidence: name and short requirements only; full original body is not visible.** The following standard is a newly written completion, **not** recovered wording. Original language and Go-specific requirements are preserved as observations only.

## Proposed usable standard

The original project references a BaseMock library in Go test doubles. Its actual source and API are not visible. Do not recreate BaseMock in ACE. Use existing test harness doubles for behavioral contracts, mark as mocks and keep real-provider acceptance separate.

## Review procedure
1. Identify affected domain and caller/callee boundaries using actual files and line references.
2. Check applicable claims against accepted project standards and tests; note any mismatch between original Go example and current project language.
3. Produce PASS/FAIL/NOT-APPLICABLE/UNKNOWN with a reproducible line-level explanation.
4. If any required evidence is absent, state what still must be measured; never report green based on expectation.

## Applicability to ACE
Only consult this historical reconstruction as research. The governing ACE sources remain root `AGENTS.md`, Accepted ADRs, OpenSpec and existing tests; do not activate this guide as a second conflicting policy.
