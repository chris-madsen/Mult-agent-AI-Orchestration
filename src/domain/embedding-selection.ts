import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type EmbeddingEvidenceStage = 'development_spike' | 'frozen_holdout';
export type EmbeddingOwnerApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface EmbeddingComparisonCandidate {
  readonly provider: string;
  readonly model: string;
  readonly revision: string;
  readonly status: 'success' | 'failed';
  readonly dimensions?: number;
  readonly dataset_sha256?: string;
  readonly preprocessing?: string;
  readonly recall_at_1?: number;
  readonly recall_at_3?: number;
  readonly recall_at_5?: number;
  readonly mrr?: number;
  readonly ndcg_at_5?: number;
  readonly query_ms_p95?: number;
  readonly model_load_ms?: number;
  readonly max_rss_bytes?: number | null;
  readonly index_candidates_per_second?: number | null;
  readonly artifact?: {
    readonly model_id?: string;
    readonly revision?: string;
    readonly tree_sha256?: string;
  };
  readonly runtime?: Readonly<Record<string, unknown>>;
}

export interface EmbeddingComparisonReport {
  readonly status: string;
  readonly evidence_stage: EmbeddingEvidenceStage;
  readonly production_approved: boolean;
  readonly dataset: string;
  readonly dataset_sha256: string;
  readonly candidates: readonly EmbeddingComparisonCandidate[];
}

export interface EmbeddingSelectionThresholds {
  readonly minRecallAt1: number;
  readonly minRecallAt3: number;
  readonly minRecallAt5: number;
  readonly minMrr: number;
  readonly minNdcgAt5: number;
  readonly maxQueryP95Ms?: number;
  readonly maxModelLoadMs?: number;
  readonly maxRssBytes?: number;
}

export interface EmbeddingLicenseEvidence {
  readonly spdxId: string;
  readonly evidence: string;
  readonly verified: boolean;
}

export interface EmbeddingOwnerApproval {
  readonly status: EmbeddingOwnerApprovalStatus;
  readonly provider?: string;
  readonly note?: string;
}

export interface EmbeddingSelectionPolicy {
  readonly selectedProvider: string;
  readonly requiredDatasetSha256: string;
  readonly thresholds: EmbeddingSelectionThresholds;
  readonly licenses: Readonly<Record<string, EmbeddingLicenseEvidence>>;
  readonly ownerApproval: EmbeddingOwnerApproval;
}

export interface EmbeddingSelectionVerdict {
  readonly selectedProvider: string;
  readonly selectedProviderIdentity: string;
  readonly measurementAccepted: boolean;
  readonly productionApproved: boolean;
  readonly status: 'MEASUREMENT_PASS_APPROVAL_PENDING' | 'MEASUREMENT_FAIL' | 'PRODUCTION_APPROVED' | 'REJECTED';
  readonly failures: readonly string[];
}

const stableRuntime = (runtime: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(runtime).sort(([left], [right]) => left.localeCompare(right)));

export const embeddingProviderIdentity = (candidate: EmbeddingComparisonCandidate): string => JSON.stringify({
  provider: candidate.provider,
  model: candidate.model,
  revision: candidate.revision,
  dimensions: candidate.dimensions,
  preprocessing: candidate.preprocessing,
  artifact: candidate.artifact ?? null,
  runtime: candidate.runtime === undefined ? null : stableRuntime(candidate.runtime),
});

const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const gitRevision = (value: string): boolean => /^[a-f0-9]{40,64}$/u.test(value);
const nonEmpty = (value: string): boolean => value.trim().length > 0;
const unit = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const positive = (value: number): boolean => Number.isFinite(value) && value > 0;

const validateThresholds = (thresholds: EmbeddingSelectionThresholds): Result<void, DomainError> => {
  const quality = [
    thresholds.minRecallAt1,
    thresholds.minRecallAt3,
    thresholds.minRecallAt5,
    thresholds.minMrr,
    thresholds.minNdcgAt5,
  ];
  if (!quality.every(unit)) {
    return err(domainError('INVALID_BENCHMARK', 'embedding_thresholds', 'quality thresholds must be finite values between 0 and 1'));
  }
  const optionalLimits = [thresholds.maxQueryP95Ms, thresholds.maxModelLoadMs, thresholds.maxRssBytes]
    .filter((value): value is number => value !== undefined);
  if (!optionalLimits.every(positive)) {
    return err(domainError('INVALID_BENCHMARK', 'embedding_thresholds', 'optional performance limits must be positive finite values'));
  }
  return ok(undefined);
};

const numericMetric = (
  candidate: EmbeddingComparisonCandidate,
  key: keyof Pick<EmbeddingComparisonCandidate, 'recall_at_1' | 'recall_at_3' | 'recall_at_5' | 'mrr' | 'ndcg_at_5' | 'query_ms_p95' | 'model_load_ms'>,
): number | undefined => {
  const value = candidate[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

export const evaluateEmbeddingSelection = (
  report: EmbeddingComparisonReport,
  policy: EmbeddingSelectionPolicy,
): Result<EmbeddingSelectionVerdict, DomainError> => {
  if (!nonEmpty(policy.selectedProvider)) {
    return err(domainError('INVALID_BENCHMARK', 'selected_provider', 'selected embedding provider is required'));
  }
  if (!sha256(policy.requiredDatasetSha256) || !sha256(report.dataset_sha256)) {
    return err(domainError('INVALID_BENCHMARK', 'dataset_sha256', 'embedding selection requires lowercase SHA-256 dataset identity'));
  }
  const thresholds = validateThresholds(policy.thresholds);
  if (thresholds._tag === 'Err') return thresholds;
  if (!Array.isArray(report.candidates) || report.candidates.length < 2) {
    return err(domainError('INVALID_BENCHMARK', 'candidates', 'embedding selection requires at least two measured candidates'));
  }

  const candidate = report.candidates.find((item) => item.provider === policy.selectedProvider);
  if (candidate === undefined) {
    return err(domainError('INVALID_BENCHMARK', 'selected_provider', 'selected provider is absent from comparison report'));
  }
  if (!nonEmpty(candidate.model) || !gitRevision(candidate.revision)) {
    return err(domainError('INVALID_BENCHMARK', 'candidate_identity', 'selected provider requires model and pinned revision'));
  }

  const failures: string[] = [];
  if (report.status !== 'comparison-complete') failures.push('comparison_incomplete');
  if (report.evidence_stage !== 'frozen_holdout') failures.push('not_frozen_holdout');
  if (report.production_approved !== false) failures.push('comparison_must_not_self_approve');
  if (report.dataset_sha256 !== policy.requiredDatasetSha256) failures.push('dataset_identity_mismatch');
  if (candidate.status !== 'success') failures.push('selected_provider_failed');
  if (candidate.dataset_sha256 !== report.dataset_sha256) failures.push('candidate_dataset_identity_mismatch');
  if (!Number.isSafeInteger(candidate.dimensions) || (candidate.dimensions ?? 0) < 1) failures.push('invalid_dimensions');
  if (!nonEmpty(candidate.preprocessing ?? '')) failures.push('preprocessing_missing');
  if (!gitRevision(candidate.artifact?.revision ?? '')) failures.push('artifact_revision_unpinned');
  if (!sha256(candidate.artifact?.tree_sha256 ?? '')) failures.push('artifact_digest_missing');
  if (candidate.runtime === undefined || Object.keys(candidate.runtime).length === 0) failures.push('runtime_identity_missing');

  const r1 = numericMetric(candidate, 'recall_at_1');
  const r3 = numericMetric(candidate, 'recall_at_3');
  const r5 = numericMetric(candidate, 'recall_at_5');
  const mrr = numericMetric(candidate, 'mrr');
  const ndcg5 = numericMetric(candidate, 'ndcg_at_5');
  const p95 = numericMetric(candidate, 'query_ms_p95');
  const load = numericMetric(candidate, 'model_load_ms');
  if (r1 === undefined || !unit(r1) || r1 < policy.thresholds.minRecallAt1) failures.push('recall_at_1_below_threshold');
  if (r3 === undefined || !unit(r3) || r3 < policy.thresholds.minRecallAt3) failures.push('recall_at_3_below_threshold');
  if (r5 === undefined || !unit(r5) || r5 < policy.thresholds.minRecallAt5) failures.push('recall_at_5_below_threshold');
  if (mrr === undefined || !unit(mrr) || mrr < policy.thresholds.minMrr) failures.push('mrr_below_threshold');
  if (ndcg5 === undefined || !unit(ndcg5) || ndcg5 < policy.thresholds.minNdcgAt5) failures.push('ndcg_at_5_below_threshold');
  if (policy.thresholds.maxQueryP95Ms !== undefined
    && (p95 === undefined || p95 > policy.thresholds.maxQueryP95Ms)) failures.push('query_p95_above_threshold');
  if (policy.thresholds.maxModelLoadMs !== undefined
    && (load === undefined || load > policy.thresholds.maxModelLoadMs)) failures.push('model_load_above_threshold');
  if (policy.thresholds.maxRssBytes !== undefined
    && (typeof candidate.max_rss_bytes !== 'number'
      || !Number.isFinite(candidate.max_rss_bytes)
      || candidate.max_rss_bytes > policy.thresholds.maxRssBytes)) failures.push('rss_above_threshold');

  const license = policy.licenses[policy.selectedProvider];
  if (license === undefined || !license.verified || !nonEmpty(license.spdxId) || !nonEmpty(license.evidence)) {
    failures.push('license_not_verified');
  }

  const measurementAccepted = failures.length === 0;
  if (policy.ownerApproval.status === 'rejected') {
    return ok({
      selectedProvider: policy.selectedProvider,
      selectedProviderIdentity: embeddingProviderIdentity(candidate),
      measurementAccepted,
      productionApproved: false,
      status: 'REJECTED',
      failures: [...failures, 'owner_rejected'],
    });
  }
  const ownerApproved = policy.ownerApproval.status === 'approved'
    && policy.ownerApproval.provider === policy.selectedProvider;
  const productionApproved = measurementAccepted && ownerApproved;
  if (!ownerApproved) failures.push('owner_approval_missing');

  return ok({
    selectedProvider: policy.selectedProvider,
    selectedProviderIdentity: embeddingProviderIdentity(candidate),
    measurementAccepted,
    productionApproved,
    status: productionApproved
      ? 'PRODUCTION_APPROVED'
      : measurementAccepted
        ? 'MEASUREMENT_PASS_APPROVAL_PENDING'
        : 'MEASUREMENT_FAIL',
    failures: [...new Set(failures)],
  });
};
