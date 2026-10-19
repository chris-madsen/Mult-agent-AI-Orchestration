# Serena vs direct TypeScript Language Service

**Date:** 2026-10-19
**Status:** partial provider comparison; no production winner selected.

## Evidence available

| Path | Result |
|---|---|
| Serena `2.0.0` installation | Installed with `uv tool install -p 3.13 serena-agent` |
| Serena project health check | Passed through isolated `uv tool run --from serena-agent`; the system `/home/ilja/.local/bin/serena` has an incompatible MCP/Pydantic environment and is not used as evidence |
| Serena same-name tools run | Passed: `find_symbol` distinguished `UserRepository/save` and `AuditRepository/save`; `find_referencing_symbols` returned the corresponding call site for each; diagnostics returned `{}` |
| Direct TypeScript LS | `npm run test:real-same-name` passed with structural spans, distinct definitions, references and assignment write locations |
| Real retrieval slice | Direct TypeScript LS verified the selected Tree-sitter candidates in the Qdrant E2E |

The current runtime deliberately uses direct TypeScript Language Service because
that path is already a typed in-process port and its definition agreement was
observed in the real retrieval fixture. Serena remains installed and is not
silently promoted or removed. The machine-readable comparison is in
`benchmarks/reports/serena-vs-ts-language-service-2026-10-19.json`.

## Missing comparison evidence

A fair decision still needs identical 2000+ line fixtures run through both
providers with the same definitions, references, same-name symbols, write
locations, diagnostics, cold/warm latency and resource measurements. This report
does not claim that direct TypeScript LS is the final approved LSP provider.
