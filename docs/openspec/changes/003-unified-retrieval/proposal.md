# Proposal — Unified context retrieval with Qdrant, AST/LSP and Vertex documentation

## Why

The central PRD hypothesis requires all three knowledge classes in one accurate, freshness-aware context path, rather than independent unrelated MCP servers.

## What Changes

Implement local code discovery, Tree-sitter/ast-grep structure, approved LSP adapter, Vertex documentation retrieval and one composed ContextBundle with source provenance and lossless drill-down.

## Capabilities

### New Capabilities

- `code-discovery` — Local hybrid code candidates, versioned indexes.
- `semantic-verification` — Tree-sitter AST, LSP facts and dynamic uncertainty.
- `documentation-retrieval` — Vertex AI RAG for project documentation.
- `unified-context` — Adaptive-composable evidence and lossless disclosure.

## Impact

- **Domain contexts:** consult `docs/architecture/01-strategic-ddd.md`; references ADR-001…010 as applicable.
- **Dependencies:** previous numbered changes must be reviewed and completed first.
- **Non-goals:** Write own AST parser, implement full static-analysis engine, default cloud code upload, enforce arbitrary token cap, always run expensive retrieval engines.
- **Risk:** provider contracts/versions, security and provenance must be tested before asserting production behavior.
- **Acceptance:** normative scenarios in `specs/*/spec.md` plus `tasks.md`; no performance claim without measured evaluation.
