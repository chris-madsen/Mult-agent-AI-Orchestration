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
