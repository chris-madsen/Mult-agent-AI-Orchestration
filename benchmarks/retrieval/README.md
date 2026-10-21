# External retrieval holdouts

Release-grade multi-repository holdouts are evidence artifacts, not ACE source
fixtures. Keep their source specifications, repository checkouts, manifests,
cases, scored runs and reports in an external evidence directory.

The freezer accepts explicit repository mappings and refuses to write its
holdout or manifests inside the ACE checkout:

```bash
npm run freeze:retrieval-holdout -- \
  <external-evidence>/source-spec.json \
  <external-evidence>/frozen/holdout.json \
  <external-evidence>/frozen/manifests \
  repo-a=<external-checkout-a> \
  repo-b=<external-checkout-b>
```

Every checkout must already be at the exact revision declared by the external
source specification. The freezer records deterministic path, size and
SHA-256 entries, derives canonical candidate IDs from repository identity and
source ranges, and refuses to overwrite a frozen holdout.

Use the resulting external holdout path with the generic retrieval evaluator,
ablation gate and reranker gate. Do not copy repository source, repository
task definitions or generated manifests into ACE.

Harbor four-arm validation receives repository IDs through
`ACE_HARBOR_REPOSITORY_IDS`, for example `repo-a,repo-b`. The ACE checkout
contains only the generic gate and ACE-local development tasks; final
multi-repository Harbor jobs and their task environments belong to the
external evidence workspace.
