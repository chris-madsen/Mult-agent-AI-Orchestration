import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export interface ImageProvenanceRecord {
  readonly schemaVersion: 1;
  readonly imageDigest: string;
  readonly sourceCommit: string;
  readonly sbomSha256: string;
  readonly packageLockSha256: string;
  readonly builder: string;
  readonly buildReference: string;
  readonly signatureVerified: boolean;
}

export interface LicenseReviewRecord {
  readonly schemaVersion: 1;
  readonly status: 'approved' | 'rejected' | 'pending';
  readonly sourceCommit: string;
  readonly sbomSha256: string;
  readonly reviewerReference: string;
  readonly unresolvedProhibitedLicenses: readonly string[];
}

export interface SupplyChainEvidenceInput {
  readonly currentCommit: string;
  readonly packageLockSha256: string;
  readonly sbomSha256: string;
  readonly sbom: unknown;
  readonly productionAudit: unknown;
  readonly auditCommand: string;
  readonly imageProvenance: ImageProvenanceRecord;
  readonly licenseReview: LicenseReviewRecord;
}

export interface SupplyChainEvidenceVerdict {
  readonly status: 'PASS' | 'FAIL';
  readonly evidence?: 'supply-chain-provenance';
  readonly failures: readonly string[];
  readonly imageDigest: string;
  readonly sourceCommit: string;
  readonly packageLockSha256: string;
  readonly sbomSha256: string;
}

const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const commitSha = (value: string): boolean => /^[a-f0-9]{40,64}$/u.test(value);
const nonEmpty = (value: string): boolean => value.trim().length > 0;
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const validSbom = (value: unknown): boolean => {
  const root = record(value);
  if (root === undefined) return false;
  if (root.bomFormat === 'CycloneDX') {
    return typeof root.specVersion === 'string'
      && root.specVersion.length > 0
      && Array.isArray(root.components);
  }
  if (typeof root.spdxVersion === 'string' && root.spdxVersion.startsWith('SPDX-')) {
    return Array.isArray(root.packages);
  }
  return false;
};

const auditVulnerabilities = (
  value: unknown,
): Result<{ readonly high: number; readonly critical: number }, DomainError> => {
  const root = record(value);
  const metadata = record(root?.metadata);
  const vulnerabilities = record(metadata?.vulnerabilities);
  const high = vulnerabilities?.high;
  const critical = vulnerabilities?.critical;
  if (typeof high !== 'number' || !Number.isSafeInteger(high) || high < 0
    || typeof critical !== 'number' || !Number.isSafeInteger(critical) || critical < 0) {
    return err(domainError('INVALID_BENCHMARK', 'npm_audit', 'npm audit JSON must contain non-negative metadata.vulnerabilities high/critical counters'));
  }
  return ok({ high, critical });
};

export const evaluateSupplyChainEvidence = (
  input: SupplyChainEvidenceInput,
): Result<SupplyChainEvidenceVerdict, DomainError> => {
  if (!commitSha(input.currentCommit)
    || !sha256(input.packageLockSha256)
    || !sha256(input.sbomSha256)) {
    return err(domainError('INVALID_BENCHMARK', 'supply_chain_identity', 'commit/package-lock/SBOM identities are invalid'));
  }
  if (!validSbom(input.sbom)) {
    return err(domainError('INVALID_BENCHMARK', 'sbom', 'SBOM must be CycloneDX or SPDX with an explicit component/package list'));
  }
  if (input.auditCommand.trim() !== 'npm audit --omit=dev --json') {
    return err(domainError('INVALID_BENCHMARK', 'npm_audit', 'production audit command must be exactly npm audit --omit=dev --json'));
  }
  const audit = auditVulnerabilities(input.productionAudit);
  if (audit._tag === 'Err') return audit;

  const failures: string[] = [];
  if (audit.value.high !== 0) failures.push('production_audit_high_vulnerabilities');
  if (audit.value.critical !== 0) failures.push('production_audit_critical_vulnerabilities');

  const provenance = input.imageProvenance;
  if (provenance.schemaVersion !== 1
    || !/^sha256:[a-f0-9]{64}$/u.test(provenance.imageDigest)
    || !commitSha(provenance.sourceCommit)
    || !sha256(provenance.sbomSha256)
    || !sha256(provenance.packageLockSha256)
    || !nonEmpty(provenance.builder)
    || !nonEmpty(provenance.buildReference)) {
    return err(domainError('INVALID_BENCHMARK', 'image_provenance', 'image provenance identity is invalid'));
  }
  if (provenance.sourceCommit !== input.currentCommit) failures.push('image_wrong_commit');
  if (provenance.sbomSha256 !== input.sbomSha256) failures.push('image_sbom_mismatch');
  if (provenance.packageLockSha256 !== input.packageLockSha256) failures.push('image_package_lock_mismatch');
  if (!provenance.signatureVerified) failures.push('image_signature_not_verified');

  const licenses = input.licenseReview;
  if (licenses.schemaVersion !== 1
    || !commitSha(licenses.sourceCommit)
    || !sha256(licenses.sbomSha256)
    || !nonEmpty(licenses.reviewerReference)
    || !Array.isArray(licenses.unresolvedProhibitedLicenses)
    || licenses.unresolvedProhibitedLicenses.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
    return err(domainError('INVALID_BENCHMARK', 'license_review', 'license review record is invalid'));
  }
  if (licenses.status !== 'approved') failures.push('license_review_not_approved');
  if (licenses.sourceCommit !== input.currentCommit) failures.push('license_review_wrong_commit');
  if (licenses.sbomSha256 !== input.sbomSha256) failures.push('license_review_sbom_mismatch');
  if (licenses.unresolvedProhibitedLicenses.length > 0) failures.push('prohibited_licenses_unresolved');

  return ok({
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    ...(failures.length === 0 ? { evidence: 'supply-chain-provenance' as const } : {}),
    failures: [...new Set(failures)],
    imageDigest: provenance.imageDigest,
    sourceCommit: input.currentCommit,
    packageLockSha256: input.packageLockSha256,
    sbomSha256: input.sbomSha256,
  });
};
