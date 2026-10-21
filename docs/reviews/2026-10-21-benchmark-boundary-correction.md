# Benchmark boundary correction

The previous Hybrid milestone implementation committed a concrete external
repository's manifests, holdout cases and Harbor task environments into ACE.
That was an incorrect repository boundary.

The corrected design keeps ACE responsible only for generic benchmark
interfaces, canonical scoring, telemetry contracts and gates. Release-grade
multi-repository source specifications, checkouts, manifests, cases, Harbor
tasks and raw evidence live in an external evidence workspace.

The holdout freezer accepts explicit `repository-id=checkout-root`
mappings. It now refuses to write holdout or manifest outputs inside the ACE
checkout. Harbor four-arm validation receives repository IDs from the external
composition through `ACE_HARBOR_REPOSITORY_IDS`.

This correction does not change H4/H5 semantics or claim that retrieval,
reranker or agent benchmarks have been executed. Those gates remain open until
real external evidence is available.
