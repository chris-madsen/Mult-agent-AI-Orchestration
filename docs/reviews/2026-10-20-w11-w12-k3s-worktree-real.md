# Real k3s worktree acceptance — W11/W12 slice

**Date:** 2026-10-20T14:12:08.196Z  
**Runner commit:** `614e4de6d6672bd9408b141a8b8f0d555203dab9`  
**Status:** BLOCKED — K3S-10 only

## Real evidence

The exact-commit runner used a disposable git workspace, ephemeral CA/server/client
certificates, the host helper, and a temporary k3s Pod using the pinned utility
image recorded in `benchmarks/reports/k3s-worktree-real-614e4de.json`.
Only safe metadata, digests, error codes and artifact hashes were retained.

- `K3S-01` through `K3S-09`: **PASS**
- `K3S-05`: eight concurrent large-file reads returned explicit race errors; no
  false-current result was accepted.
- `K3S-08`: helper restart and client Pod restart recovered.
- `K3S-09`: source manifest digest was identical before and after the run.
- Finalizer verdict: `k3s-live-worktree-incomplete`, failure `fail:K3S-10`.

## Remaining blocker

An unrelated default-namespace workload reached the helper TLS boundary. mTLS
still rejected the request without the client certificate, but reachability itself
violates the required containment check. The committed ACE manifest intentionally
does not guess a host-helper CIDR or firewall rule, so this cannot be converted
to PASS by changing the test assertion.

## Unblock path

Provide an owner-approved, site-specific host firewall or cluster egress policy
for the actual helper address/port, apply it to the real deployment environment,
and rerun this exact runner. Retain the policy observation as a safe artifact.
Until then the k3s live-worktree evidence and production readiness remain
incomplete; no Graphiti, Vertex, token-savings, or local-only claims are changed.
