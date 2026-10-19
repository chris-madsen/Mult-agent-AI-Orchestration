import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateSupplyChainEvidence,
  type ImageProvenanceRecord,
  type LicenseReviewRecord,
} from '../src/domain/supply-chain-evidence.js';

const commit = 'a'.repeat(40);
const packageLockSha256 = 'b'.repeat(64);
const sbomSha256 = 'c'.repeat(64);

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  components: [{ type: 'library', name: 'effect', version: '3.0.0' }],
};

const audit = {
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 0,
      critical: 0,
      total: 0,
    },
  },
};

const provenance: ImageProvenanceRecord = {
  schemaVersion: 1,
  imageDigest: 'sha256:' + 'd'.repeat(64),
  sourceCommit: commit,
  sbomSha256,
  packageLockSha256,
  builder: 'buildkit/v1',
  buildReference: 'ci://build/123',
  signatureVerified: true,
};

const licenseReview: LicenseReviewRecord = {
  schemaVersion: 1,
  status: 'approved',
  sourceCommit: commit,
  sbomSha256,
  reviewerReference: 'license-review/2026-10-20',
  unresolvedProhibitedLicenses: [],
};

test('supply-chain evidence passes only when audit, SBOM, image provenance and license review are bound together', () => {
  const result = evaluateSupplyChainEvidence({
    currentCommit: commit,
    packageLockSha256,
    sbomSha256,
    sbom,
    productionAudit: audit,
    auditCommand: 'npm audit --omit=dev --json',
    imageProvenance: provenance,
    licenseReview,
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'PASS');
  assert.equal(result.value.evidence, 'supply-chain-provenance');
  assert.deepEqual(result.value.failures, []);
});

test('high vulnerabilities, unsigned image and unresolved licenses independently block provenance evidence', () => {
  const result = evaluateSupplyChainEvidence({
    currentCommit: commit,
    packageLockSha256,
    sbomSha256,
    sbom,
    productionAudit: {
      metadata: { vulnerabilities: { high: 2, critical: 1 } },
    },
    auditCommand: 'npm audit --omit=dev --json',
    imageProvenance: { ...provenance, signatureVerified: false },
    licenseReview: {
      ...licenseReview,
      status: 'pending',
      unresolvedProhibitedLicenses: ['GPL-3.0-only'],
    },
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'FAIL');
  assert.equal(result.value.evidence, undefined);
  for (const failure of [
    'production_audit_high_vulnerabilities',
    'production_audit_critical_vulnerabilities',
    'image_signature_not_verified',
    'license_review_not_approved',
    'prohibited_licenses_unresolved',
  ]) assert.ok(result.value.failures.includes(failure), failure);
});

test('wrong commit/SBOM/lock identities cannot be hidden by a verified signature', () => {
  const result = evaluateSupplyChainEvidence({
    currentCommit: commit,
    packageLockSha256,
    sbomSha256,
    sbom,
    productionAudit: audit,
    auditCommand: 'npm audit --omit=dev --json',
    imageProvenance: {
      ...provenance,
      sourceCommit: 'e'.repeat(40),
      sbomSha256: 'f'.repeat(64),
      packageLockSha256: '1'.repeat(64),
    },
    licenseReview: {
      ...licenseReview,
      sourceCommit: 'e'.repeat(40),
      sbomSha256: 'f'.repeat(64),
    },
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  for (const failure of [
    'image_wrong_commit',
    'image_sbom_mismatch',
    'image_package_lock_mismatch',
    'license_review_wrong_commit',
    'license_review_sbom_mismatch',
  ]) assert.ok(result.value.failures.includes(failure), failure);
});

test('supply-chain gate rejects a generic audit command or malformed SBOM instead of guessing scope', () => {
  const wrongCommand = evaluateSupplyChainEvidence({
    currentCommit: commit,
    packageLockSha256,
    sbomSha256,
    sbom,
    productionAudit: audit,
    auditCommand: 'npm audit --json',
    imageProvenance: provenance,
    licenseReview,
  });
  assert.equal(wrongCommand._tag, 'Err');

  const malformedSbom = evaluateSupplyChainEvidence({
    currentCommit: commit,
    packageLockSha256,
    sbomSha256,
    sbom: { components: [] },
    productionAudit: audit,
    auditCommand: 'npm audit --omit=dev --json',
    imageProvenance: provenance,
    licenseReview,
  });
  assert.equal(malformedSbom._tag, 'Err');
});
