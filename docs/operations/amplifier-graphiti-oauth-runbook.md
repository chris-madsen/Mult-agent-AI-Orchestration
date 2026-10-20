# Amplifier + official Graphiti MCP preflight

This runbook implements the selected upstream composition for the committed
synthetic Graphiti fixture. It does not authorize private Codex-session upload,
does not use `codex-kimi`, ports `8098/8000/8099`, or a repository shim, and does
not claim that a local FalkorDB proves local inference.

## Pinned inputs

The exact upstream commits and license/provenance metadata are in
[`infra/providers/amplifier-graphiti/pins.json`](../../infra/providers/amplifier-graphiti/pins.json):

- Amplifier Agent HTTP face: `a289011169520f8cb2d023f0a486cbbb00082a8f`;
- official ChatGPT/Codex OAuth provider: `b1341edd1545ba4b89a416184797ccfbc346413b`;
- official Graphiti MCP: `3cc723cd292eb5c2ac5ea2c5539270b8e1b6389f`.

Do not replace a commit with a moving branch during evidence collection.

## OAuth and loopback face

Install the pinned Amplifier Agent HTTP package and the pinned provider module
in an external uv environment. The repository must not vendor either checkout or
the OAuth cache. Register/install the provider through Amplifier's standard
provider manager, then run the official device login:

```bash
amplifier module add provider-openai-chatgpt --source /path/to/amplifier-module-provider-openai-chatgpt
amplifier provider install openai-chatgpt --force
amplifier provider add openai-chatgpt
# Re-authentication, when required:
amplifier provider login openai-chatgpt
```

The device flow stores tokens under `~/.amplifier/openai-chatgpt-oauth.json`.
Never copy that file into the repository, print it, include it in receipts, or
put it into `AMPLIFIER_AGENT_FACE_TOKEN`. The face token below is a separate
random loopback bearer generated in the shell.

```bash
source infra/providers/amplifier-graphiti/amplifier-face.env.example
export AMPLIFIER_AGENT_FACE_TOKEN="$(openssl rand -hex 32)"
uv run amplifier-agent-face
```

The face must bind to loopback and use `AMPLIFIER_AGENT_APPROVALS=deny`; Graphiti
needs a text completion only and must not receive shell/filesystem tools.

## Graphiti configuration

Use the official `mcp_server/main.py` at the pinned Graphiti checkout, with the
committed config copied or referenced through `CONFIG_PATH`:

```bash
export ACE_AMPLIFIER_FACE_URL="http://127.0.0.1:9099/v1"
export ACE_AMPLIFIER_MODEL_ID="gpt-5.6-luna"
export ACE_AMPLIFIER_FACE_MODEL="$ACE_AMPLIFIER_MODEL_ID"
export ACE_GRAPHITI_SOURCE_ROOT=/absolute/path/to/graphiti-at-pinned-commit
export ACE_GRAPHITI_CONFIG="$PWD/infra/providers/amplifier-graphiti/graphiti-config.yaml"
export ACE_GRAPHITI_COMMAND=uv
export ACE_GRAPHITI_ARGS_JSON='["run","--directory","/absolute/path/to/graphiti-at-pinned-commit/mcp_server","main.py","--transport","stdio"]'
export ACE_GRAPHITI_E2E_ACK_SYNTHETIC_ONLY=true
export ACE_GRAPHITI_EMBEDDER_PROVIDER=sentence_transformers
export FALKORDB_URI=redis://127.0.0.1:6379

npm run preflight:amplifier-graphiti -- --output artifacts/amplifier-graphiti/preflight.json
```

The preflight reads `/v1/models` and
`/v1/providers/openai-chatgpt/models` through the loopback face. The requested
model is usable only when it appears in the live account catalog. It records
model IDs and status, never authorization headers or response payloads.

At the pinned Graphiti MCP commit, the official config schema accepts only
`openai`, `azure_openai`, `gemini`, and `voyage` embedder providers. It also has
a BGE fallback implementation, but its factory does not expose a configuration
switch for selecting that local reranker when the LLM is the OpenAI-compatible
Amplifier face. Therefore the preflight is expected to be `not_ready` in the
current environment. This is an upstream capability blocker, not permission to
write a shim, switch to a cloud embedder/reranker, or pass with mocks.

When an updated official Graphiti MCP commit adds both capabilities, update the
pin, rerun this preflight, and retain the exact source ref and provider package
identities in the real lifecycle receipt.

## Data policy and evidence boundary

Only `benchmarks/fixtures/graphiti-memory-lifecycle-v1.json` is authorized until
the synthetic lifecycle, structured extraction, local embedding, local reranker,
FalkorDB retrieval, purge, and crash/reconcile receipts all pass. Private Codex
sessions require a separate policy profile, explicit owner approval reference,
and a destination-time authorization check. OAuth authentication alone is not
authorization for private cloud inference.

Neither this preflight nor a successful provider call closes the 5x token-saving
claim or the `Graphiti local-only` production claim. Those require real provider
traces, policy evidence, reproducible Harbor trials, and owner sign-off.
