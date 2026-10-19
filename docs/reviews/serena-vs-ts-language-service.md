# Serena vs direct TypeScript Language Service

**Date:** 2026-10-19
**Status:** partial provider comparison; no production winner selected.

## Evidence available

| Path | Result |
|---|---|
| Serena `2.0.0` installation | Installed with `uv tool install -p 3.13 serena-agent` |
| Serena project health check | Passed; LSP backend, TypeScript Language Server `5.1.3`, workspace TypeScript `5.9.3`, symbol/reference checks |
| Direct TypeScript LS | Existing contract tests passed for definitions, references, type information and diagnostics |
| Real retrieval slice | Direct TypeScript LS verified the selected Tree-sitter candidates in the Qdrant E2E |

The current runtime deliberately uses direct TypeScript Language Service because
that path is already a typed in-process port and its definition agreement was
observed in the real retrieval fixture. Serena remains installed and healthy,
not silently promoted or removed.

## Missing comparison evidence

A fair decision still needs identical 2000+ line fixtures run through both
providers with the same definitions, references, same-name symbols, write
locations, diagnostics, cold/warm latency and resource measurements. This report
does not claim that direct TypeScript LS is the final approved LSP provider.
