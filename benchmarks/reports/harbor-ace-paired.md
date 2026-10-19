# Harbor native Codex vs Codex + ACE

**Date:** 2026-10-19
**Status:** historical **forced-use diagnostic**, not a production DBC-12 acceptance measurement. Arithmetic is preserved, but the experimental protocol does not establish naturally attributable retrieval savings.

The earlier native-only attempt remains preserved as
`benchmarks/reports/harbor-native-exploratory-failure.json`; it had an
`invalid_api_key` failure and is not used for this result. The fresh run used
the existing k3s Qdrant through a temporary loopback port-forward, pinned
Codex/Codex OAuth configuration, serial execution and three retrieval-demanding
tasks with three repetitions per arm. No `OPENAI_API_KEY` was used.

Evidence and rendered reports:

- gate JSON: `benchmarks/reports/ace-retrieval-paired-3x3-final-indexkey.json`;
- Markdown/CSV/JSON rendering:
  `benchmarks/reports/ace-retrieval-paired-3x3-final-indexkey/`;
- native: 9/9 successful, 0 ACE calls, 891,950 raw total tokens, `$0.0569132`;
- ACE: 9/9 successful, 9 completed `ace_context` calls, 9 current-source calls,
  9 valid provider traces, 1,571,768 raw total tokens, `$0.08538924`;
- quality: non-inferior (9/9 vs 9/9), with receipts for embedding, Qdrant,
  Tree-sitter and TypeScript Language Service in every ACE trial.

The measured raw-token savings factor is `0.567482x` and token reduction is
`-76.217%`; cost savings factor is `0.666515x` and cost reduction is
`-50.034%`. In other words, this implementation is currently more expensive
on this paired set. The arithmetic is preserved as a truthful historical observation, but the reported `measured-not-necessarily-5x` acceptance in the original snapshot is **superseded**. This was forced ACE usage with extra instructions, tiny repeated fixtures, uncorrelated provider operations, and no metering of local inference/indexing CPU/RAM cost. The updated gate reports `diagnostic-only` and production acceptance remains open.

Remaining gates are owner review of the provider/model approval and a larger
frozen holdout. The measured overhead is intentionally not hidden or converted
into a claimed saving.

See [2026-10-19-ace-efficiency-benchmark-audit.md](../../docs/reviews/2026-10-19-ace-efficiency-benchmark-audit.md) for the specific audit and required corrected experiment.
