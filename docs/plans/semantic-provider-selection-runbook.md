# Semantic provider matched-comparison runbook

This is the reproducible W02 handoff for **Serena vs direct TypeScript Language Service**. It replaces provider-specific smoke comparisons with one fixture/oracle identity.

## Frozen corpus and oracle

Use only:

- `benchmarks/semantic/provider-comparison-v1/src/*`
- `benchmarks/semantic/provider-comparison-v1/oracle.json`

The fixture covers same-name methods, inheritance/override dispatch, Unicode identifiers, alias references, assignment/reference distinctions, syntax errors, and a 2,000+ line source file.

Do not edit v1 after using it to tune a provider. If the fixture or oracle needs correction after scoring, create v2.

## Direct TypeScript Language Service

Run:

```bash
npm run compare:semantic-tsls
```

The runner hashes the complete source fixture and oracle independently, executes the shared oracle twice, and retains:

- exact case-level verdicts/observations;
- provider/runtime version;
- fixture SHA-256;
- oracle SHA-256;
- cold initialization/preflight time;
- warm query p95;
- process RSS.

CI also evaluates the frozen oracle directly through the current TS-LS adapter, so its case verdicts are not hand-authored.

## Serena

Codex must run Serena against the **same source directory and oracle cases**. The Serena report supplied to the final selection gate must use the same `SemanticProviderReport` shape:

```json
{
  "provider": "serena",
  "providerVersion": "serena-agent/<version>",
  "fixtureSha256": "<must equal the TS-LS report>",
  "oracleSha256": "<must equal the TS-LS report>",
  "caseResults": [
    { "caseId": "<exact oracle case id>", "status": "pass", "observation": "<safe location/count evidence>" }
  ],
  "coldStartMs": 0,
  "warmQueryP95Ms": 0,
  "maxRssBytes": 0,
  "runtime": {
    "python": "<version>",
    "serena": "<version>"
  }
}
```

Do **not** copy old Serena smoke results into this structure. Run the actual cases and preserve raw Serena command/tool output as external evidence. A missing case, changed fixture digest, changed oracle digest, provider error, or different case set invalidates the comparison.

## Predeclare selection policy

Before inspecting final matched results, create a temporary policy with:

- exact selected provider ID;
- fixture/oracle SHA-256 from the frozen corpus;
- every required oracle case ID;
- any latency/RSS limits chosen in advance;
- verified provider/license evidence;
- `ownerApproval.status = "pending"`.

Example numbers are intentionally omitted: ACE does not invent acceptance thresholds after seeing the result.

## Selection gate

```bash
npm run gate:semantic-selection -- \
  /path/to/policy.json \
  benchmarks/reports/semantic-selection-verdict.json \
  benchmarks/reports/typescript-ls-provider-comparison-v1.json \
  /path/to/serena-matched-report.json
```

The gate rejects:

- different source fixture hashes;
- different oracle hashes;
- missing/extra case sets;
- failed/error required cases for the selected provider;
- threshold regressions;
- missing license evidence.

A clean measurement produces `MEASUREMENT_PASS_APPROVAL_PENDING` until the owner separately approves that exact provider. For release enforcement:

```bash
ACE_REQUIRE_SEMANTIC_PRODUCTION_APPROVAL=true npm run gate:semantic-selection -- ...
```

## Still external

Codex still needs the actual Serena matched run, raw tool evidence, fair cold/warm/RSS measurement, authoritative license verification, dirty-tree/snapshot transition real E2E, and owner approval. Until those exist, W02 remains open and direct TS LS is only the current implementation, not the approved winner.
