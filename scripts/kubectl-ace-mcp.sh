#!/usr/bin/env bash
set -euo pipefail

namespace="${ACE_K8S_NAMESPACE:-ace}"
deployment="${ACE_K8S_DEPLOYMENT:-ace-mcp}"
container="${ACE_K8S_CONTAINER:-ace-mcp}"
kubeconfig="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

exec kubectl --kubeconfig "$kubeconfig" -n "$namespace" exec -i "deployment/$deployment" -c "$container" --   node /opt/ace/dist/bin/ace-mcp.js
