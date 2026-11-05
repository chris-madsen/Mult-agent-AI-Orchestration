# RepoModel

## Rules

Keep persistence DTO/mapping separate from domain entities. Round trips must preserve semantically relevant values and optional/null distinctions. Verify entity -> storage -> entity across nulls, migrations, compatibility and error cases. In ACE, also preserve archive identity, tombstones, provenance and source digest safety.

## Review procedure
1. Identify affected domain and caller/callee boundaries using actual files and line references.
2. Check applicable claims against accepted project standards and tests; note any mismatch between original Go example and current project language.
3. Produce PASS/FAIL/NOT-APPLICABLE/UNKNOWN with a reproducible line-level explanation.
4. If any required evidence is absent, state what still must be measured; never report green based on expectation.

## Use in ACE
