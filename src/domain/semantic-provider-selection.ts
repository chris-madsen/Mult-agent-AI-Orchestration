import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type SemanticCaseStatus = 'pass' | 'fail' | 'error';

export interface SemanticProviderCaseResult {
  readonly caseId: string;
  readonly status: SemanticCaseStatus;
  readonly observation?: string;
}

export interface SemanticProviderReport {
  readonly provider: string;
  readonly providerVersion: string;
  readonly fixtureSha256: string;
  readonly oracleSha256: string;
  readonly caseResults: readonly SemanticProviderCaseResult[];
  readonly coldStartMs: number;
  readonly warmQueryP95Ms: number;
  readonly maxRssBytes?: number;
  readonly runtime: Readonly<Record<string, string>>;
}

export interface SemanticLicenseEvidence {
  readonly spdxId: string;
  readonly evidence: string;
  readonly verified: boolean;
}

export interface SemanticSelectionPolicy {
  readonly selectedProvider: string;
  readonly requiredFixtureSha256: string;
  readonly requiredOracleSha256: string;
  readonly requiredCaseIds: readonly string[];
  readonly maxColdStartMs?: number;
  readonly maxWarmQueryP95Ms?: number;
  readonly maxRssBytes?: number;
  readonly licenses: Readonly<Record<string, SemanticLicenseEvidence>>;
  readonly ownerApproval: {
    readonly status: 'pending' | 'approved' | 'rejected';
    readonly provider?: string;
    readonly note?: string;
  };
}

export interface SemanticSelectionVerdict {
  readonly selectedProvider: string;
  readonly matchedComparison: boolean;
  readonly measurementAccepted: boolean;
  readonly productionApproved: boolean;
  readonly status:
  | 'COMPARISON_INVALID'
  | 'MEASUREMENT_FAIL'
  | 'MEASUREMENT_PASS_APPROVAL_PENDING'
  | 'PRODUCTION_APPROVED'
  | 'REJECTED';
  readonly failures: readonly string[];
}

const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const nonEmpty = (value: string): boolean => value.trim().length > 0;
const positiveOrZero = (value: number): boolean => Number.isFinite(value) && value >= 0;

const normalizedCases = (report: SemanticProviderReport): readonly string[] =>
  report.caseResults.map((item) => item.caseId).sort();

const sameArray = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const evaluateSemanticProviderSelection = (
  reports: readonly SemanticProviderReport[],
  policy: SemanticSelectionPolicy,
): Result<SemanticSelectionVerdict, DomainError> => {
  if (reports.length < 2) {
    return err(domainError('INVALID_BENCHMARK', 'semantic_reports', 'semantic selection requires at least two provider reports'));
  }
  if (!nonEmpty(policy.selectedProvider)
    || !sha256(policy.requiredFixtureSha256)
    || !sha256(policy.requiredOracleSha256)
    || policy.requiredCaseIds.length === 0
    || new Set(policy.requiredCaseIds).size !== policy.requiredCaseIds.length) {
    return err(domainError('INVALID_BENCHMARK', 'semantic_policy', 'semantic selection policy identity/cases are invalid'));
  }

  const failures: string[] = [];
  const providerNames = new Set<string>();
  const requiredCases = [...policy.requiredCaseIds].sort();
  const firstCaseSet = normalizedCases(reports[0] as SemanticProviderReport);
  for (const report of reports) {
    if (!nonEmpty(report.provider) || providerNames.has(report.provider)) {
      return err(domainError('INVALID_BENCHMARK', 'semantic_reports', 'provider IDs must be non-empty and unique'));
    }
    providerNames.add(report.provider);
    if (!nonEmpty(report.providerVersion) || !sha256(report.fixtureSha256) || !sha256(report.oracleSha256)) {
      return err(domainError('INVALID_BENCHMARK', 'semantic_reports', 'provider report identity is incomplete'));
    }
    if (!positiveOrZero(report.coldStartMs) || !positiveOrZero(report.warmQueryP95Ms)
      || (report.maxRssBytes !== undefined && !positiveOrZero(report.maxRssBytes))) {
      return err(domainError('INVALID_BENCHMARK', 'semantic_reports', 'provider performance counters must be non-negative finite numbers'));
    }
    if (Object.keys(report.runtime).length === 0
      || Object.entries(report.runtime).some(([key, value]) => !nonEmpty(key) || !nonEmpty(value))) {
      return err(domainError('INVALID_BENCHMARK', 'semantic_reports', 'provider runtime identity is required'));
    }
    const ids = report.caseResults.map((item) => item.caseId);
    if (ids.some((id) => !nonEmpty(id)) || new Set(ids).size !== ids.length) {
      return err(domainError('INVALID_BENCHMARK', 'semantic_reports', 'semantic case IDs must be unique and non-empty'));
    }
  }

  const matchedComparison = reports.every((report) =>
    report.fixtureSha256 === policy.requiredFixtureSha256
    && report.oracleSha256 === policy.requiredOracleSha256
    && sameArray(normalizedCases(report), firstCaseSet)
    && sameArray(normalizedCases(report), requiredCases));

  if (!matchedComparison) failures.push('comparison_not_matched');

  const selected = reports.find((report) => report.provider === policy.selectedProvider);
  if (selected === undefined) {
    return err(domainError('INVALID_BENCHMARK', 'selected_provider', 'selected semantic provider is absent from reports'));
  }
  for (const caseId of requiredCases) {
    const result = selected.caseResults.find((item) => item.caseId === caseId);
    if (result?.status !== 'pass') failures.push(`case_failed:${caseId}`);
  }
  if (policy.maxColdStartMs !== undefined && selected.coldStartMs > policy.maxColdStartMs) {
    failures.push('cold_start_above_threshold');
  }
  if (policy.maxWarmQueryP95Ms !== undefined && selected.warmQueryP95Ms > policy.maxWarmQueryP95Ms) {
    failures.push('warm_query_p95_above_threshold');
  }
  if (policy.maxRssBytes !== undefined
    && (selected.maxRssBytes === undefined || selected.maxRssBytes > policy.maxRssBytes)) {
    failures.push('rss_above_threshold');
  }
  const license = policy.licenses[policy.selectedProvider];
  if (license === undefined || !license.verified || !nonEmpty(license.spdxId) || !nonEmpty(license.evidence)) {
    failures.push('license_not_verified');
  }

  const measurementFailures = failures.filter((failure) => failure !== 'owner_approval_missing');
  const measurementAccepted = matchedComparison && measurementFailures.length === 0;
  if (policy.ownerApproval.status === 'rejected') {
    return ok({
      selectedProvider: policy.selectedProvider,
      matchedComparison,
      measurementAccepted,
      productionApproved: false,
      status: 'REJECTED',
      failures: [...new Set([...failures, 'owner_rejected'])],
    });
  }
  const ownerApproved = policy.ownerApproval.status === 'approved'
    && policy.ownerApproval.provider === policy.selectedProvider;
  if (!ownerApproved) failures.push('owner_approval_missing');
  const productionApproved = measurementAccepted && ownerApproved;

  return ok({
    selectedProvider: policy.selectedProvider,
    matchedComparison,
    measurementAccepted,
    productionApproved,
    status: !matchedComparison
      ? 'COMPARISON_INVALID'
      : productionApproved
        ? 'PRODUCTION_APPROVED'
        : measurementAccepted
          ? 'MEASUREMENT_PASS_APPROVAL_PENDING'
          : 'MEASUREMENT_FAIL',
    failures: [...new Set(failures)],
  });
};
