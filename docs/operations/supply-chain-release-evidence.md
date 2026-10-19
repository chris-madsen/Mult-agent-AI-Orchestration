# Supply-chain release evidence

The full ACE release preflight requires a retained `supply-chain-provenance` artifact. Do not create that label manually.

The gate binds four independent facts to the exact release commit:

1. current `package-lock.json` SHA-256;
2. CycloneDX or SPDX SBOM SHA-256;
3. a production-only npm audit executed as `npm audit --omit=dev --audit-level=high --json`;
4. image provenance plus a separately reviewed license record tied to the same commit/SBOM.

## Inputs

Prepare an SBOM from the exact release tree and retain it as an artifact. The gate accepts CycloneDX or SPDX with an explicit component/package list.

Image provenance JSON:

```json
{
  "schemaVersion": 1,
  "imageDigest": "sha256:<64 lowercase hex>",
  "sourceCommit": "<exact release git sha>",
  "sbomSha256": "<exact retained SBOM sha256>",
  "packageLockSha256": "<exact package-lock sha256>",
  "builder": "<actual builder/version>",
  "buildReference": "<CI/build attestation reference>",
  "signatureVerified": true
}
```

License review JSON:

```json
{
  "schemaVersion": 1,
  "status": "approved",
  "sourceCommit": "<exact release git sha>",
  "sbomSha256": "<exact retained SBOM sha256>",
  "reviewerReference": "<retained review/sign-off>",
  "unresolvedProhibitedLicenses": []
}
```

Do not set `signatureVerified` or `status: approved` without the corresponding retained evidence.

## Run

```bash
npm run release:supply-chain -- \
  artifacts/release/sbom.cdx.json \
  artifacts/release/image-provenance.json \
  artifacts/release/license-review.json \
  artifacts/release/npm-audit-production.json \
  artifacts/release/supply-chain.json
```

The command runs the production-only npm audit itself and stores its JSON. It returns PASS only when:

- high vulnerabilities = 0;
- critical vulnerabilities = 0;
- image digest is an immutable SHA-256 digest;
- image provenance commit/SBOM/package-lock match the actual current tree;
- image signature verification is explicitly recorded;
- license review is approved for the same commit/SBOM;
- no prohibited-license item remains unresolved.

Only then does the output contain:

```json
{ "evidence": "supply-chain-provenance" }
```

The gate does not build or sign an image. Codex/CI must perform the real build, produce provenance/signature evidence, generate the SBOM, and obtain the license review. This command validates and binds those artifacts; it never fabricates them.
