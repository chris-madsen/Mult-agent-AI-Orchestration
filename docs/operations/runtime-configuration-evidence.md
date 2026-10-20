# ACE runtime configuration release evidence

This evidence binds a release claim to the **actual safe runtime flags** used by ACE on the exact Git commit. It records no tokens, certificates, raw workspace paths, queries, source bytes or private dialogue.

## Capture

Run in the same environment that will launch ACE.

Code-only host example:

```bash
npm run evidence:runtime-config -- \
  code-only host \
  code-only-release-capture \
  artifacts/release/runtime-config.json
```

Code-only k3s example (run inside the configured ACE pod/container environment):

```bash
npm run evidence:runtime-config -- \
  code-only k3s \
  code-only-k3s-release-capture \
  artifacts/release/runtime-config.json
```

Full unified release:

```bash
npm run evidence:runtime-config -- \
  full-unified k3s \
  unified-release-capture \
  artifacts/release/runtime-config.json
```

For a hard gate:

```bash
ACE_REQUIRE_RUNTIME_CONFIG_ACCEPTED=true npm run evidence:runtime-config -- ...
```

## Code-only acceptance

The capture is accepted only when:

- real Qdrant code retrieval is enabled;
- pinned embedding is required;
- local lexical fallback is disabled;
- documentation/Vertex is disabled;
- cloud docs opt-in is disabled;
- Graphiti/memory is disabled;
- there are no external cloud data permissions;
- for k3s, the host helper and all three mTLS file settings are present.

## Full-unified acceptance

The capture is accepted only when:

- deployment profile is k3s;
- real Qdrant code retrieval is enabled;
- pinned embedding is required;
- local lexical fallback is disabled;
- Vertex documentation and explicit cloud-doc opt-in are enabled;
- Graphiti memory is enabled and remains local-only;
- worktree access uses the authenticated host helper with mTLS;
- the only cloud permission is `vertex -> project_document`;
- private source/private conversation cloud egress is absent.

The capture reports the current runtime embedding provider and the current direct semantic provider. Release preflight cross-checks those identities against the production-approved embedding and semantic selection artifacts. A provider can therefore not be “approved on paper” while a different provider is actually configured.

## Claim boundary

`runtime-config-accepted` proves only that the safe configuration flags and declared provider identities match the requested release scope for this commit. It does not prove provider availability, retrieval quality, k3s containment, Harbor value or owner approval.
