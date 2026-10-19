# Harbor native Codex vs Codex + ACE

**Date:** 2026-10-19
**Status:** rejected exploratory run; no paired quality or token claim.

The repository has Harbor adapters and report renderers plus a three-task
exploratory suite. The native-only attempt produced three errors: Codex was
rejected by the upstream provider with `invalid_api_key`, and the two new task
contexts had a missing `environment/fixture` path in that pre-fix run. No ACE
arm was run, no verifier reward or token/cost value was available, and no
quality or savings claim follows. The redacted evidence is
`benchmarks/reports/harbor-native-exploratory-failure.json`.

Required next run:

1. pin the same repository commit, Codex model/settings and timeout for both arms;
2. run at least three cross-file retrieval/impact tasks with repeated paired trials;
3. preserve raw Harbor/Codex/ACE traces, failures, quality verdicts, token
   breakdowns and external provider costs;
4. freeze an unseen holdout before tuning and report results below or above 5×
   without treating 5× as a gate.
