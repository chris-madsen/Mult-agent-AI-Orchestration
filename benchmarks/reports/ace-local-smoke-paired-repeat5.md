# ACE paired Harbor report

- Suite: `ace-harness-local-paired`
- Holdout: `true`
- Trials per configuration: `5`

| Configuration | Quality mean | Pass@5 | Input tokens | Output tokens | Total tokens | Cost USD | ACE calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| native-codex | 1 | 1 | 261125 | 2316 | 263441 | 0.01129732 | 0 |
| codex-plus-ace | 1 | 1 | 649389 | 5530 | 654919 | 0.03184308 | 10 |

## Interpretation

- Quality delta (ACE - native): 0.
- Token delta (ACE - native): 391478.
- Cost ratio (ACE/native): 2.819.
- The result measures integration correctness and overhead for this holdout; it does not prove retrieval quality or a speedup.

## Evidence

- native-codex: `artifacts/harbor-native-repeat5-valid4/ace-local-smoke-native-repeat5/result.json`, SHA-256 `524e1294a19383be4e247b6928493be570452b78609229bfc3045e4d1622b78b`.
- codex-plus-ace: `artifacts/harbor-ace-repeat5-valid/ace-local-smoke-ace-repeat5/result.json`, SHA-256 `6fef95669db4179d6af8febeccbb08e2ccf5a107e51e1e80b9b617888fbee7dc`.

## Limitations
- This is one deterministic fixture task repeated five times, not a general coding benchmark.
- Both configurations achieved the same quality outcome; no quality advantage is established.
- Serena, independent MCP and long-horizon memory extraction are not included in this comparison.
- The measured ACE overhead is provider-reported Codex usage/cost only; no external provider cost was present.
- No 5x improvement claim is permitted.
