# Production retrieval paired Harbor report

- Acceptance: **measured-not-necessarily-5x**
- Paired: true
- Quality non-inferior: true
- Provider receipts verified: true
- Savings factor (native / ACE raw total tokens): 0.567
- Token reduction: -0.762
- Cost savings factor: 0.667
- Cost reduction: -0.500

| Configuration | Trials | Successes | Raw tokens | Cost USD | ACE calls | Current-source calls |
|---|---:|---:|---:|---:|---:|---:|
| native-codex | 9 | 9 | 891950 | 0.05691319999999999 | 0 | 0 |
| codex-plus-ace | 9 | 9 | 1571768 | 0.08538924 | 9 | 9 |

## Per-task results

| Configuration | Task | Trials | Successes | Failures | Raw tokens | Cost USD | Median latency ms |
|---|---|---:|---:|---:|---:|---:|---:|
| native-codex | ace/cloud-policy-impact | 3 | 3 | 0 | 315354 | 0.01861288 | 46469 |
| native-codex | ace/semantic-retry-impact | 3 | 3 | 0 | 225967 | 0.014406760000000001 | 39010 |
| native-codex | ace/shared-archive-impact | 3 | 3 | 0 | 350629 | 0.02389356 | 53632 |
| codex-plus-ace | ace/cloud-policy-impact | 3 | 3 | 0 | 519029 | 0.0316716 | 151230 |
| codex-plus-ace | ace/semantic-retry-impact | 3 | 3 | 0 | 584193 | 0.027423919999999997 | 147092 |
| codex-plus-ace | ace/shared-archive-impact | 3 | 3 | 0 | 468546 | 0.02629372 | 152152 |

A ratio is publishable only when acceptance is not `rejected`; no automatic 5× claim is made.
