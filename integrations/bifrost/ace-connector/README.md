# ACE Bifrost connector

This directory contains the thin, provider-neutral Go IPC client for the versioned `ace.gateway.v1` projection contract.

Current status:

- `adapter-implemented`: request identity, bounded body transport, original-body digest binding, decision validation and fail-closed application are implemented.
- `provider-wire-tested`: the pinned Bifrost revision `fe7634a6c828927d05ffdd57c62be0aaab04193f` loaded the plugin and a mock upstream captured the transformed body; retained evidence is in `docs/reviews/2026-10-25-bifrost-gateway-wire-e2e.md`.
- `agent-E2E-tested`: NOT RUN.

The connector does not implement retrieval, compaction, reranking, policy selection or provider credentials. The pinned plugin calls `Project` from the authenticated HTTP transport seam. A strict projected request with a missing receipt or configured fallback is short-circuited before the provider call; a repeated PreLLM attempt is also blocked rather than reusing the ingress receipt. Per-attempt reauthorization, native-plugin rebuild verification at the new revision, and retry/fallback provider-wire evidence remain NOT RUN / NOT IMPLEMENTED. No retry/fallback certification is claimed.

Run the isolated contract tests with:

```bash
go test ./...
```

Build the native Bifrost plugin against an exact external Bifrost checkout:

```bash
GOWORK=off \
  GO_BIN=/absolute/path/to/go1.27.3/bin/go \
  BIFROST_SOURCE_ROOT=/absolute/path/to/bifrost-checkout \
  BIFROST_COMMIT=fe7634a6c828927d05ffdd57c62be0aaab04193f \
  ./scripts/build-bifrost-ace-plugin.sh
```

The build script verifies the checkout revision before compiling and uses the
`bifrost_plugin` build tag so ordinary connector tests do not import the
external Bifrost module.
