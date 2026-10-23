# Proposal — Hermes request-time ACE context integration

**Status:** Accepted direction; implementation/evidence pending.

## Why

The current Hermes path exposes ACE as an optional MCP server. That lets Hermes call ACE tools, but it does not guarantee that ACE controls the context sent to the model. ACE requires a request-time transformation seam that can select, deduplicate, rank, budget, and source-verify the context while preserving the durable agent transcript.

Hermes provides a replaceable `ContextEngine` with request-time `select_context(...)`; this change integrates ACE through that seam.

## What changes

1. Define a versioned ACE context-transformation request/response contract.
2. Expose the existing ACE retrieval/delivery composition through a direct local JSONL bridge, separate from MCP transport.
3. Implement a Hermes `ContextEngine` plugin that calls the bridge and returns a request-only message projection.
4. Preserve message groups, provider-specific reasoning carriers, tool-call/result integrity, and durable history.
5. Bind transformation receipts, runtime identities, source manifests, and provider traces to Harbor trials.
6. Replace the current primary Hermes feedback-loop MCP injection with the ContextEngine path; retain MCP for optional diagnostics and exact expansion.
7. Add exact preflight and a fresh one-task Hermes native-vs-Hermes+ACE smoke gate.

## Non-goals

- Do not rewrite Hermes durable session history to inject ACE context.
- Do not force an ACE MCP tool call into Hermes prompts.
- Do not duplicate Qdrant, embedding, LSP, or source-verification logic in Python.
- Do not change the underlying GPT subscription/model solely for this integration.
- Do not reuse historical Codex results as Hermes evidence.
