# ACE natural paired Harbor report

- Suite: `ace-harness-local-paired`
- Holdout: `true`
- Trials per configuration: `5`

| Configuration | Quality mean | Pass@5 | Input tokens | Output tokens | Total tokens | Cost USD | ACE calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| native-codex | 1 | 1 | 359072 | 3080 | 362152 | 0.0152608 | 0 |
| codex-plus-ace | 1 | 1 | 297813 | 2619 | 300432 | 0.012478199999999998 | 0 |

## Interpretation

- Quality delta (ACE - native): 0.
- Token delta (ACE - native): -61720.
- Cost ratio (ACE/native): 0.818.
- ACE MCP was available but not called in the natural paired task; this measures no-regression behavior, not retrieval quality or a speedup.

## Evidence

- native-codex: `artifacts/harbor-native-natural-repeat5-serial/ace-local-smoke-native-natural-repeat5-serial/result.json`, SHA-256 `586f7b1ade51e50ffa2f551b746295238383171c350dd7c13d47747e94046928`.
- codex-plus-ace: `artifacts/harbor-ace-natural-repeat5-serial/ace-local-smoke-ace-natural-repeat5-serial/result.json`, SHA-256 `066819cd357e3ffd3ce80053f3779b5dbe0ddfafe4d47ef700051748cdd51d3f`.

## Limitations
- This is one deterministic fixture task repeated five times, not a general coding benchmark.
- Both configurations achieved the same quality outcome; no quality advantage is established.
- The natural paired task made no ACE MCP calls in either arm; retrieval efficiency remains unmeasured.
- Serena, independent MCP and long-horizon memory extraction are not included in this comparison.
- The measured ACE overhead is provider-reported Codex usage/cost only; no external provider cost was present.
- No 5x improvement claim is permitted.
