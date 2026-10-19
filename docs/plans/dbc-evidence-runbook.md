# DBC evidence runbook

This runbook is the machine-checkable evidence handoff for the remaining real-environment gates in the unified ACE plan.

## Principle

A test result and a production claim are different things. Every DBC record is one of:

- `PASS` — the exact retained evidence supports the contract;
- `FAIL` — the test ran and the retained evidence contradicts the contract;
- `NOT_RUN` — no run was attempted in this environment;
- `BLOCKED` — a named dependency prevented the run.

`PASS` and `FAIL` require an exact command, fixture SHA-256, at least one observation, and at least one retained artifact whose SHA-256 is calculated by the generator. `DBC-12 PASS` additionally requires correlated ACE request IDs.

The generator reads the current Git commit itself. Do not copy an older SHA into an evidence report.

Evidence metadata is also scanned for credential-like values. Describe authorization scope (for example, `local-only` or `Vertex read-only corpus scope`) but never paste bearer tokens, API keys, passwords, private keys, or authorization headers into a draft.

## Draft format

Create a temporary draft such as:

```json
{
  "records": [
    {
      "dbcId": "DBC-14",
      "verdict": "BLOCKED",
      "toolVersions": {
        "node": "22.23.3",
        "vertex-api": "v1beta1"
      },
      "credentialScope": "Vertex read-only project/corpus scope; credential bytes not retained",
      "requestIds": [],
      "artifacts": [],
      "observed": [],
      "limitation": "Authorized synthetic fixture documents have not been ingested in this environment."
    }
  ]
}
```

For a completed real gate add `fixturePath`, `command`, observations, request IDs where applicable, and artifacts:

```json
{
  "records": [
    {
      "dbcId": "DBC-05",
      "verdict": "PASS",
      "fixturePath": "benchmarks/fixtures/source-race/fixture.json",
      "command": "npm run test:real-provider-race",
      "toolVersions": {
        "node": "22.23.3",
        "qdrant": "1.19.2"
      },
      "credentialScope": "local-only; no cloud credentials used",
      "requestIds": ["ace-request-from-real-run"],
      "artifacts": [
        {
          "path": "artifacts/dbc-05/provider-trace.jsonl",
          "kind": "provider-trace"
        }
      ],
      "observed": [
        "Final source verification detected the changed digest and no stale evidence remained direct/current."
      ]
    }
  ]
}
```

The example paths above are illustrative. Do not mark a record `PASS` until those real files exist.

## Generate

```bash
npm run evidence:dbc -- /path/to/draft.json artifacts/dbc-evidence.json
```

The generator:

1. obtains `git rev-parse HEAD`;
2. hashes the fixture and retained artifacts itself;
3. validates DBC IDs and verdict requirements;
4. rejects obvious embedded credentials in evidence metadata;
5. writes a normalized manifest plus PASS/FAIL/NOT_RUN/BLOCKED counts.

To make an acceptance job fail unless all fourteen records are real PASS results:

```bash
ACE_REQUIRE_ALL_DBC_PASS=true npm run evidence:dbc -- draft.json artifacts/dbc-evidence.json
```

A partial evidence manifest is useful during development, but it is not production acceptance.
