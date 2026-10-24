# Design — Agent-neutral multi-layer hybrid context

**Normative ADR:** ADR-014.

**Transport clarification (2026-10-24):** This specification governs ACE retrieval/projection semantics, not a mandatory MCP model-context path. Bifrost is selected but not implemented for gateway delivery (ADR-017), Hermes native ContextEngine exists (ADR-016), and MCP is an explicit tools interface.

## Retrieval pipeline

```text
query + source obligations + working context
             |
             +--> dense embedding ----------+
             +--> sparse BM25 --------------+--> Qdrant RRF --> optional reranker
             +--> structural/exact priors --+
                                                  |
                                                  v
                                         exact source reread
                                                  |
                                                  v
                                              LSP enrich
                                                  |
                 +--------------------------------+------------------+
                 |                                |                  |
                 v                                v                  v
             current code                    Vertex docs        Graphiti memory
                 |                                |                  |
                 +----------------------+---------+------------------+
                                        v
                             source-aware ContextBundle
                                        |
                               inline minimum + handles
                                        |
                                ace_expand exact bytes
```

## Provider ownership

ACE owns policy, orchestration, provenance, completeness and delivery.

ACE does not own:
- parser grammars;
- language-server project lifecycle;
- vector database internals;
- cross-encoder model training;
- Git implementation;
- graph database semantics.

## Hybrid code retrieval

A code point contains dense and sparse representations for the same structural chunk. Dense embeddings answer behavior/meaning queries. Sparse BM25 protects exact identifiers, configuration keys and rare literals.

Qdrant performs native candidate prefetch and RRF fusion. The initial shortlist is larger than the final delivery set.

The reranker, when approved, only reorders the fused shortlist.

## Working-state priors

ACE independently observes Git/worktree state. Authorized native/gateway adapters and explicit MCP tool clients MAY supply focus/open-file/range hints.

Working-state values influence ranking and context assembly but never override:
- exact source digest verification;
- source policy;
- required-source completeness.

## Delta delivery

ContextBundle evidence has stable identities. A client can provide known bundle/evidence identities. ACE omits unchanged body bytes and returns compact references, while `ace_expand` remains exact and lossless.

This is distinct from embedding cache reuse:
- embedding reuse reduces indexing compute;
- context delta delivery reduces repeated context-transfer/model input bytes on the authorized adapter, including explicit MCP tool responses where applicable.

## Failure semantics

Each optional stage reports whether it ran:
- sparse unavailable;
- reranker unavailable;
- LSP unavailable;
- docs/memory unavailable.

A required stage failure makes source coverage incomplete. An optional stage failure may degrade ranking but cannot be represented as if it ran successfully.

## Measurement

Every hybrid experiment reports:
- branch recall/rank;
- fused rank;
- rerank rank;
- context bytes before/after dedupe;
- new/reused/expanded bytes;
- agent tokens and tool calls;
- task quality.
