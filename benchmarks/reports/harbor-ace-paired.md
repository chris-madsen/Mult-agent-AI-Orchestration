# Harbor native Codex vs Codex + ACE

**Date:** 2026-10-19
**Status:** not run; no paired quality or token claim.

The repository has Harbor adapters and report renderers, but this environment
does not yet contain a frozen multi-task retrieval-demanding holdout with matched
native-Codex and Codex+ACE jobs, verified ACE MCP call receipts, and attributable
embedding/indexing/provider costs. Existing smoke reports are not a substitute:
a TODO smoke or a run with zero ACE calls cannot establish retrieval quality or
token savings.

Required next run:

1. pin the same repository commit, Codex model/settings and timeout for both arms;
2. run at least three cross-file retrieval/impact tasks with repeated paired trials;
3. preserve raw Harbor/Codex/ACE traces, failures, quality verdicts, token
   breakdowns and external provider costs;
4. freeze an unseen holdout before tuning and report results below or above 5×
   without treating 5× as a gate.
