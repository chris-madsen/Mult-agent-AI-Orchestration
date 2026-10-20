# ACE local provider dependencies

These manifests describe the single-node development deployment used by the
ACE real-provider closure plan. They keep services internal to the `ace`
namespace and use the existing k3s `local-path` provisioner. They are not a
high-availability production deployment.

## Qdrant

Install the official Qdrant Helm chart at the pinned version:

```bash
KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl create namespace ace --dry-run=client -o yaml | \
  KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl apply -f -
KUBECONFIG=/etc/rancher/k3s/k3s.yaml helm repo add qdrant https://qdrant.github.io/qdrant-helm
KUBECONFIG=/etc/rancher/k3s/k3s.yaml helm repo update qdrant
KUBECONFIG=/etc/rancher/k3s/k3s.yaml helm upgrade --install qdrant qdrant/qdrant \
  --version 1.19.2 --namespace ace --values qdrant-values.yaml --wait
```

The chart creates one `qdrant` pod, a ClusterIP service, and a 10Gi RWO PVC.

## FalkorDB

Apply the pinned official FalkorDB image manifest:

```bash
KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl apply -f falkordb.yaml
KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl -n ace rollout status statefulset/falkordb
```

The manifest creates one internal `falkordb` service and a 5Gi RWO PVC. The
Graphiti MCP extraction server is intentionally not bundled here: it requires
an approved LLM and embedder credential/configuration and must not start with
a fabricated key or an unapproved cloud/local fallback.


## ACE MCP runtime pod — stdio through `kubectl exec`

ACE does **not** expose a new HTTP MCP service in this deployment. The production
transport remains the official MCP SDK stdio server. The `ace-mcp` pod is a
long-lived runtime container; Codex or an operator starts one MCP process with
stdin/stdout attached through:

```bash
scripts/kubectl-ace-mcp.sh
```

This avoids inventing a second network protocol merely to place the runtime in k3s.

### 1. Build and sign an exact image

`Dockerfile.ace` deliberately has no default base image. Supply an already
verified base digest:

```bash
docker build \
  --build-arg ACE_NODE_IMAGE='node:22-bookworm-slim@sha256:<verified-base-digest>' \
  -f Dockerfile.ace \
  -t '<registry>/ace-harness:<release>' .
```

Push/sign it using the release process, then use the **signed image digest**
accepted by `npm run release:supply-chain`. Never replace the Kubernetes
placeholder with a floating tag.

The image pins the local Python parser/runtime packages used by the current
code path. It intentionally does not bundle Graphiti or a cloud credential.

### 2. Pre-stage the embedding artifact

The committed NetworkPolicy has no generic internet egress. Therefore the
FastEmbed model/artifact cache must be present on `ace-runtime-state` before
the production MCP process starts, unless a separately reviewed temporary
egress policy is used for model staging.

A missing or mismatched artifact is expected to make pinned embedding preflight
fail; do not enable lexical fallback to make the pod look green.

### 3. Create release configuration and mTLS material

`ace-mcp.yaml` references a required `ace-runtime-release` ConfigMap that is
**not committed**, because its values belong to the exact release/environment.
It must provide at least:

- `ACE_WORKSPACE_ID`
- `ACE_WORKTREE_HELPER_URL`
- `ACE_EMBEDDING_MODEL`
- `ACE_EMBEDDING_MODEL_REVISION`
- `ACE_EMBEDDING_ARTIFACT_MODEL`
- `ACE_EMBEDDING_ARTIFACT_REVISION`
- `ACE_EMBEDDING_ARTIFACT_DIGEST`
- `ACE_EMBEDDING_DIMENSION`
- `ACE_EMBEDDING_PREPROCESSING`

The digest/revisions must be the production-approved values; do not use the
development winner as an implicit approval.

Create `ace-worktree-client-mtls` from the issued client certificate, private
key and trusted CA. Do not commit that Secret or its source files.

### 4. Host-helper egress is site-specific and deny-by-default

The committed policy permits DNS and local provider ports 6333/6379 only. It
does **not** contain a guessed host CIDR or helper port. Add a separate
environment-specific NetworkPolicy that permits only the actual host-helper
IP/CIDR and TLS port.

This is intentional: a generic `0.0.0.0/0:443` rule would defeat the local
data boundary. Vertex also stays disabled in this default code-only profile and
requires a separately reviewed egress policy when that capability is enabled.

### 5. Apply and set the signed image digest

```bash
KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl -n ace apply -f infra/k8s/ace-local/ace-mcp.yaml

KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl -n ace set image \
  deployment/ace-mcp \
  ace-mcp='<registry>/ace-harness@sha256:<signed-release-digest>'
```

The committed `registry.invalid/...` image is deliberately non-runnable. A
release cannot accidentally pull a placeholder.

### 6. Readiness claim boundary

The Kubernetes readiness probe checks only that the hardened runtime container,
required release config and mTLS files are present. It does **not** claim Qdrant,
embedding, worktree, Vertex, Graphiti or unified context readiness.

After launching MCP through `kubectl exec -i`, `ace_workspace_status` remains
the capability-level truth source. A green pod with a provider failure is not
ACE production readiness.

Run the K3S-01…10 acceptance suite and finalize
`evidence:k3s-worktree` before using the `real-k3s-live-worktree` release
evidence label.
