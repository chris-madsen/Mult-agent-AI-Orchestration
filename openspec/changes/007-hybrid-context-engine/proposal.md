# Proposal — Hybrid Context Engine completion

**Status: Accepted direction; implementation/evidence pending.**

## Why

Current ACE already has maintained structural extraction, dense Qdrant retrieval, generic LSP, exact source verification, progressive expansion, docs and memory adapters. It still lacks the full multi-layer retrieval/context behavior required by ADR-014:

- sparse lexical/BM25 retrieval fused with dense retrieval;
- evidence-gated reranking;
- first-class working-state priors;
- context receipts/delta delivery to avoid retransmitting unchanged evidence;
- ablation proving which layers improve agent quality/tokens.

## What changes

1. Add Qdrant dense+sparse hybrid retrieval with RRF.
2. Add an optional local maintained reranker behind a provider port.
3. Add authoritative Git working-state signals plus optional MCP focus/open-file hints.
4. Add stable bundle/evidence receipts and delta delivery.
5. Make compact structural outlines available in locate-mode ContextBundles.
6. Benchmark dense-only, sparse-only, hybrid, reranked and delta-delivery arms.
7. Preserve current source verification, exact expansion, source obligations and provider truthfulness.

## Non-goals

- cloning Cursor internals;
- migrating to Turbopuffer in the local ACE milestone;
- custom Merkle tree;
- separate Tantivy service before Qdrant BM25 is measured;
- custom parser/LSP/vector DB/reranker model;
- mandatory code graph/CPG;
- replacing exact originals with summaries.
