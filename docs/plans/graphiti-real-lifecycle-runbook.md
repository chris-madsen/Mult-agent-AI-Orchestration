# Real Graphiti lifecycle E2E

This is the runnable W06/W07 acceptance handoff. It uses only the committed synthetic fixture and does **not** authorize importing private Codex history.

## Preconditions

Start the supported local Graphiti MCP server, FalkorDB and the chosen local inference stack. Set the Graphiti command/arguments exactly as used by the real environment.

Required:

```bash
export ACE_GRAPHITI_E2E_ACK_SYNTHETIC_ONLY=true
export ACE_GRAPHITI_COMMAND="..."
export ACE_GRAPHITI_ARGS_JSON='["..."]'
```

Recommended evidence metadata:

```bash
export ACE_GRAPHITI_VERSION="..."
export ACE_GRAPHITI_LLM_ID="..."
export ACE_GRAPHITI_EMBEDDER_ID="..."
export ACE_GRAPHITI_RERANKER_ID="..."
```

The script creates isolated random ACE workspace and Graphiti group IDs. It never reuses a production group.

## Run

```bash
npm run test:real-graphiti-lifecycle -- \
  benchmarks/fixtures/graphiti-memory-lifecycle-v1.json \
  artifacts/graphiti-real-lifecycle/evidence.json
```

The gate requires the following sequence to succeed:

1. exact synthetic original archived with SHA-256;
2. durable projection intent recorded;
3. Graphiti `add_memory` enqueued;
4. projection becomes observable through Graphiti;
5. `search_memory_facts` returns a fact whose episode provenance maps back to the exact ACE archive episode;
6. Graphiti derived episode is purged;
7. absence is verified;
8. only then is the original archive episode tombstoned;
9. outbox state becomes `tombstoned`.

A pending enqueue is not a pass. A search hit without exact episode provenance is not a pass. A delete acknowledgement without verified absence is not a pass.

On success, retain both:

- `artifacts/graphiti-real-lifecycle/evidence.json`
- `artifacts/graphiti-real-lifecycle/provider-trace.jsonl`

Feed these files into the DBC evidence manifest for DBC-10/11 after recording exact tool versions and the current source commit.

This repository does not claim this real gate has run merely because the script exists.
