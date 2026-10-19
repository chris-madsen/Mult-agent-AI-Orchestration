# ACE live worktree host helper — mTLS deployment contract

**Status:** implementation and deterministic contracts exist; **real k3s pod → host evidence is still required** before production promotion.

ACE must observe uncommitted/untracked source without mounting the host worktree into the pod. The selected boundary is the `ace-worktree-helper` host process plus the `WorkspaceFilePort` mTLS client.

## Security boundary

- The host owns the only `workspace_id -> canonical root` mapping through `ACE_WORKTREE_HELPER_WORKSPACES_JSON`.
- The client never sends an absolute host path. Requests contain only the configured workspace ID, observation time, or a validated relative POSIX repo path.
- The helper reuses `NodeWorkspacePort`, so canonical-root allowlisting, symlink containment, Git-state failure handling and read-time inode/mtime/size race detection remain authoritative.
- Transport is HTTPS with **mutual TLS**. The server uses `requestCert=true` and `rejectUnauthorized=true`; the client also verifies the server through its configured CA.
- Do not expose port 7443 to another LAN/VPN/interface unless the firewall and certificate identity intentionally authorize it. Prefer binding to a host address reachable only from the local k3s node/pod network.
- The pod stores only the client certificate/key/CA. The host server certificate/key and workspace mapping stay outside Kubernetes.
- Helper logs must not contain source bytes, absolute roots, private keys or bearer tokens.

The reference Graphiti and worktree helper boundaries are trusted-local components, not public network APIs.

## Host configuration

Required environment for the host process:

```text
ACE_WORKTREE_HELPER_WORKSPACES_JSON={"ace-workspace-id":"/absolute/host/repository"}
ACE_WORKTREE_HELPER_TLS_CERT=/secure/path/server.crt
ACE_WORKTREE_HELPER_TLS_KEY=/secure/path/server.key
ACE_WORKTREE_HELPER_TLS_CA=/secure/path/ca.crt
ACE_WORKTREE_HELPER_HOST=<host address reachable only from the local pod network>
ACE_WORKTREE_HELPER_PORT=7443
```

Run the compiled helper with:

```bash
npm run worktree-helper
```

The helper deliberately rejects an unavailable/outside-allowlist configured root at startup.

## ACE pod/client configuration

```text
ACE_WORKSPACE_ID=ace-workspace-id
ACE_WORKSPACE_ROOT=/workspace-logical
ACE_WORKTREE_HELPER_URL=https://<helper-dns-or-ip>:7443/v1/worktree
ACE_WORKTREE_HELPER_TLS_CA=/var/run/ace-helper-tls/ca.crt
ACE_WORKTREE_HELPER_TLS_CERT=/var/run/ace-helper-tls/client.crt
ACE_WORKTREE_HELPER_TLS_KEY=/var/run/ace-helper-tls/client.key
```

`ACE_WORKSPACE_ROOT` is only a bootstrap candidate in helper mode; `canonicalizeRoot` replaces it with a non-secret logical root token. A caller-provided absolute host root is never transmitted.

Provision the client TLS material as a narrowly scoped Kubernetes Secret volume. Do **not** put private key bytes into ConfigMaps, manifests, Git, logs or command arguments.

## Required real-k3s acceptance

Before marking W11 complete, record the actual cluster/node/provider versions and execute all of the following with a disposable test workspace:

1. pod can snapshot committed, uncommitted and untracked files through mTLS;
2. an unknown workspace ID receives `WORKSPACE_NOT_FOUND`;
3. `../`, absolute paths, empty segments and backslashes are rejected before host reads;
4. symlink inside the repository pointing outside the allowlisted root is rejected;
5. swap/rename/write during `read_exact` yields `WORKTREE_RACED`, `DIGEST_MISMATCH`, or another explicit non-current result — never false-current bytes;
6. invalid/expired/untrusted client certificate cannot reach the service;
7. a client with the correct certificate still cannot address a workspace absent from the host map;
8. helper restart and ACE pod restart recover without changing the user worktree;
9. source files remain byte-identical before/after the entire test;
10. network policy/firewall evidence shows the helper is not generally reachable from unrelated workloads/interfaces.

Store only safe metadata/request IDs/digests in the evidence report.

## Rollback and failure policy

Rollback is to stop/remove the helper endpoint and unset `ACE_WORKTREE_HELPER_URL`. ACE must then report the live-worktree capability as unavailable/not-ready unless an explicitly approved local mode is being used. **Never** fall back to a writable `hostPath`, arbitrary cloud source upload, or a different unapproved filesystem path.

If a certificate, helper route, workspace mapping or exact read fails, the current-source proof fails closed. A technical outage may produce a truthful partial/not-ready result; a policy/authentication failure must not be bypassed.

## Multi-node/RWX note

This contract is for the accepted single-host/local-k3s direction. It does not claim correctness for multi-node failover, RWX/NFS coordination or distributed leases. Those require a separate measured design/ADR.
