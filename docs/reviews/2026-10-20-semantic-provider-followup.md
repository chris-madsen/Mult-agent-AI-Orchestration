# Semantic provider follow-up — direct TypeScript Language Service

**Date:** 2026-10-20  
**Status:** direct-provider evidence refreshed; semantic provider selection is not approved.

## Verified locally

| Check | Result |
|---|---|
| `npm run test:real-same-name` | PASS: two same-name methods resolved to distinct exact definitions; references remained separated; assignment was not a definition |
| `npm run compare:semantic-tsls` | PASS: 9/9 frozen oracle cases |
| Fixture digest | `a797557e7a7dc451d395f786a7d675a517a573ee2aa1d6bf4486ae55f4f64459` |
| Oracle digest | `2937a609f896df4470c86f1010b6602a9c8ed056e1f726f6dbd6837f89fd73f7` |
| Provider | `typescript-language-service`, TypeScript `5.9.3` |
| Runtime sample | cold start `777.35 ms`; warm query p95 `64.55 ms`; RSS `418775040` bytes |

Machine-readable output is retained in [`benchmarks/reports/typescript-ls-provider-comparison-v1.json`](../../benchmarks/reports/typescript-ls-provider-comparison-v1.json). The same-name report remains at [`benchmarks/reports/real-same-name-lsp-e2e.json`](../../benchmarks/reports/real-same-name-lsp-e2e.json).

## Claim boundary

This is real local TypeScript-LS/Tree-sitter evidence for the frozen fixtures. It does **not** prove that direct TypeScript LS is the selected production semantic provider. A matched Serena-vs-direct comparison on the same 2000+ line fixture, including diagnostics, definitions, references, Unicode coordinates, cold/warm latency and resource usage, plus owner approval, remains open. No semantic production approval or release readiness is claimed.
