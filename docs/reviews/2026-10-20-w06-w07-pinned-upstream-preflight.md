# W06/W07 pinned upstream preflight — 2026-10-20

This follow-up records a real workaround attempt from branch commit
`9dc457b`: the three pinned upstream repositories were fetched into a
disposable `/tmp` checkout, not vendored into ACE.

Pinned checkout identities were verified:

- Amplifier Agent: `a289011169520f8cb2d023f0a486cbbb00082a8f`;
- ChatGPT/Codex provider: `b1341edd1545ba4b89a416184797ccfbc346413b`;
- Graphiti MCP: `3cc723cd292eb5c2ac5ea2c5539270b8e1b6389f`.

Receipt: `benchmarks/reports/amplifier-graphiti-preflight-9dc457b.json`.
The preflight now observed PASS for the official Graphiti command, exact source
ref, secret-free config, `json_object` structured-output mode, loopback
FalkorDB URI, loopback face URL, and committed-synthetic policy.

## Remaining blocker

The pinned Graphiti schema exposes cloud embedder providers only; it does not
expose the requested local Sentence-Transformers embedder. Its factory has a
local BGE reranker fallback, but the configured OpenAI-compatible LLM path
selects provider-backed reranking and there is no accepted configuration switch
that proves local reranker selection. No shim, cloud fallback, or mock was
introduced.

The loopback Amplifier face was not started because the official OAuth device
login and live model catalog were unavailable. No OAuth token, bearer token,
private dialogue, or source bytes were logged or retained.

An additional official `uv run --extra providers` startup attempt was made with
the committed config and no credentials. It began resolving a large
sentence-transformers/PyTorch CUDA dependency set and was stopped before server
startup to avoid uncontrolled resource consumption. This is not provider or
Graphiti lifecycle evidence.

Therefore W06/W07 remain blocked: no structured extraction, local embedding,
local reranker, temporal recall, purge, SIGKILL/reconcile, or backup/restore
provider receipt is claimed.
