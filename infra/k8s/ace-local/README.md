# ACE local provider dependencies

This directory retains the **Qdrant** and **FalkorDB** local-provider manifests used for development. It does **not** provide a production-approved ACE context extension or Bifröst deployment.

## Qdrant

Install the official pinned Qdrant chart with the documented pinned version, keeping the service private to the `ace` namespace.

## FalkorDB

Apply `falkordb.yaml` for local graph storage only. The legacy Graphiti tool-server adapter was removed. Graphiti-based extraction/retrieval is **NOT_READY** until a separately reviewed non-tool provider integration is implemented; the availability of FalkorDB is not evidence of a working memory adapter.

## Gateway-only deployment requirement

The only agent-facing ACE route is **Bifröst → ACE context extension Projection HTTP**. The projection service listens on **loopback only** (`127.0.0.1:8765` by default), so a future Bifröst+ACE deployment must share a network namespace (for example, an accepted sidecar layout), or use an explicitly reviewed secure transport. The retired standalone stdio deployment is intentionally removed rather than relabeled.

Do not open ACE context extension on an external IP or invent a service/CIDR: the existing loopback-only policy must remain authoritative. No Kubernetes release is certified until a real signed container, shared namespace, startup/runtime provenance, host-helper egress policy and real final-provider wire test have passed. An operator must not treat the presence of Qdrant/FalkorDB as Gateway readiness.

The prior local provider egress rules, state volume, signed image placeholder and mTLS host-helper requirements remain source considerations for a future approved deployment, not an executable rollout in this directory.
