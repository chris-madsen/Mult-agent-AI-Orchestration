# SPIKE-K8S-WORKTREE — Safe live working-tree access

**Status:** Design spike completed; production mount intentionally not deployed
**Scope:** `001-foundation`

## Question

How can the ACE process in the existing local Kubernetes deployment read the live
Codex working tree while preserving symlink containment, race detection and the
read-only boundary?

## Options considered

| Option | Current assessment | Reason it is not accepted yet |
|---|---|---|
| `hostPath` mount | High risk | Broad host visibility and permission mistakes can violate workspace isolation. |
| PVC/PV snapshot | Insufficient for live reads | A snapshot does not represent uncommitted Codex edits in real time. |
| CSI/local mount | Unknown | Requires cluster-specific driver and permission validation. |
| Host helper protocol | **Selected design** | Keeps filesystem access outside the pod; requires an authenticated, race-aware protocol. |

## Current foundation boundary

The TypeScript `WorkspaceFilePort` is implemented behind an adapter and tested
directly against a local filesystem. It enforces canonical roots, symlink
containment, digest checks and read-time race detection. This does **not** claim that
the Kubernetes deployment has safe live working-tree access.

## Required experiment

Before production deployment, test each viable option with:

1. allowlisted root and cross-workspace traversal attempts;
2. symlink replacement during read;
3. concurrent write/rename/delete during snapshot and materialization;
4. least-privilege permissions and pod restart recovery;
5. explicit failure when no consistent digest can be returned.

The accepted outcome records the selected mechanism, permissions, threat model,
rollback path and reproducible race-test evidence below. Live Kubernetes freshness
remains `experimental` until the helper protocol itself is implemented and deployed;
it cannot produce `VerifiedCurrent` claims today.

## Current local k3s observations

The local environment runs an existing k3s server (`/usr/local/bin/k3s server`,
`k3s.service`, API `https://127.0.0.1:6443`). Its administrative kubeconfig is
`/etc/rancher/k3s/k3s.yaml`; the read-only probe reached the API successfully:

- Kubernetes server: `v1.35.5+k3s1`;
- node `xmg`: `Ready`, control-plane, containerd `2.2.3-k3s1`;
- namespaces available: `default`, `kube-system`, `monitoring` and the standard
  public/lease namespaces.

The initial read-only observation found a pre-existing DiskPressure incident:
5 `Running`, 17 `Completed`, 12,483 `Evicted`, 4 `Pending` and 4
`ContainerStatusUnknown` pods, with monitoring workloads not ready. That incident
was remediated outside the ACE workload by applying k3s eviction thresholds,
removing disk-pressure tolerations from the monitoring deployments, and deleting
only failed pod objects. The current post-remediation observation is:
`xmg Ready`, `MemoryPressure=False`, `DiskPressure=False`, `PIDPressure=False`,
monitoring deployments `1/1`, and the DATA filesystem at approximately 84% used
with roughly 57 GiB free. No ACE workload or live-working-tree mount was deployed,
so no Kubernetes mount claim is reported as passing.

Repeat the read-only connectivity check with:

```bash
KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl version --output=json
KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get nodes -o wide
KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get pods --all-namespaces
```

### Design outcome

Do not mount the host working tree into the pod. The selected boundary is a small
host-side helper protocol: the pod sends workspace ID, canonical relative path and
expected digest; the helper resolves the allowlisted root, reads through the same
symlink/race-safe `WorkspaceFilePort`, and returns bytes plus the observed digest.
The helper must authenticate the pod identity, reject paths outside the root, never
accept a caller-provided absolute path, and audit only safe metadata. Any read race
returns `WORKTREE_RACED`; it is never silently retried into a fabricated current read.
Rollback is removing the helper endpoint and leaving the ACE pod without live-tree
access. No `hostPath`, CSI mount or production pod is accepted by this spike.

## Local container restart smoke (2026-10-18)

On the existing k3s node `xmg`, a disposable `busybox:1.36` pod named
`ace-foundation-restart-smoke` was created, waited to `Running`, logged
`ACE_FOUNDATION_FIRST_OK`, deleted, recreated with the same name, waited to
`Running`, logged `ACE_FOUNDATION_SECOND_OK`, and was deleted. The final lookup
confirmed the pod was absent. This verifies basic scheduling/start/recreate
behavior only; it does not verify a host working-tree mount or race safety.
