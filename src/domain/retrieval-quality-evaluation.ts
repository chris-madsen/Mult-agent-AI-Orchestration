import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export interface RetrievalHoldoutCase {
  readonly id: string;
  readonly query: string;
  readonly relevantCandidateIds: readonly string[];
  readonly critical?: boolean;
}

export interface RetrievalHoldout {
  readonly schemaVersion: 1;
  readonly status: string;
  readonly cases: readonly RetrievalHoldoutCase[];
}

export interface RetrievalObservation {
  readonly caseId: string;
  /** Ranked, best first. IDs are scored against the frozen holdout labels. */
  readonly retrievedCandidateIds: readonly string[];
  readonly payloadCharacters: number;
  readonly duplicateSourceHits: number;
  readonly expansionCalls: number;
  readonly nativeReadDuplicates: number;
  readonly latencyMs: number;
}

export interface RetrievalStrategyRun {
  readonly strategy: string;
  readonly holdoutSha256: string;
  readonly observations: readonly RetrievalObservation[];
}

export interface RetrievalQualityMetrics {
  readonly strategy: string;
  readonly cases: number;
  readonly recallAt1: number;
  readonly recallAt3: number;
  readonly recallAt5: number;
  readonly criticalRecallAt5: number;
  readonly mrr: number;
  readonly ndcgAt5: number;
  readonly payloadCharactersMean: number;
  readonly duplicateSourceHitsMean: number;
  readonly expansionCallsMean: number;
  readonly nativeReadDuplicatesMean: number;
  readonly latencyP95Ms: number;
  readonly missedCriticalCaseIds: readonly string[];
}

export interface RetrievalQualityPolicy {
  readonly selectedStrategy: string;
  readonly requiredHoldoutSha256: string;
  readonly minRecallAt1: number;
  readonly minRecallAt3: number;
  readonly minRecallAt5: number;
  readonly minCriticalRecallAt5: number;
  readonly minMrr: number;
  readonly minNdcgAt5: number;
  readonly maxPayloadCharactersMean?: number;
  readonly maxDuplicateSourceHitsMean?: number;
  readonly maxExpansionCallsMean?: number;
  readonly maxNativeReadDuplicatesMean?: number;
  readonly maxLatencyP95Ms?: number;
}

export interface RetrievalQualityVerdict {
  readonly selectedStrategy: string;
  readonly measurementAccepted: boolean;
  readonly failures: readonly string[];
  readonly metrics: RetrievalQualityMetrics;
}

const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const unit = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const nonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const p95 = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

const reciprocalRank = (retrieved: readonly string[], relevant: ReadonlySet<string>): number => {
  const index = retrieved.findIndex((id) => relevant.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
};

const recallWithin = (retrieved: readonly string[], relevant: ReadonlySet<string>, k: number): number =>
  retrieved.slice(0, k).some((id) => relevant.has(id)) ? 1 : 0;

const ndcgAt = (retrieved: readonly string[], relevant: ReadonlySet<string>, k: number): number => {
  let dcg = 0;
  for (const [index, id] of retrieved.slice(0, k).entries()) {
    if (relevant.has(id)) dcg += 1 / Math.log2(index + 2);
  }
  const idealCount = Math.min(k, relevant.size);
  let idcg = 0;
  for (let index = 0; index < idealCount; index += 1) idcg += 1 / Math.log2(index + 2);
  return idcg === 0 ? 0 : dcg / idcg;
};

const validateHoldout = (holdout: RetrievalHoldout): Result<void, DomainError> => {
  if (holdout.schemaVersion !== 1 || holdout.cases.length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'retrieval_holdout', 'retrieval holdout schema/cases are invalid'));
  }
  const ids = new Set<string>();
  for (const item of holdout.cases) {
    if (item.id.trim().length === 0 || item.query.trim().length === 0
      || item.relevantCandidateIds.length === 0 || item.relevantCandidateIds.some((id) => id.trim().length === 0)
      || new Set(item.relevantCandidateIds).size !== item.relevantCandidateIds.length
      || ids.has(item.id)) {
      return err(domainError('INVALID_BENCHMARK', 'retrieval_holdout', 'holdout cases require unique IDs, queries and non-empty unique labels'));
    }
    ids.add(item.id);
  }
  if (!holdout.cases.some((item) => item.critical === true)) {
    return err(domainError('INVALID_BENCHMARK', 'retrieval_holdout', 'holdout requires at least one critical case'));
  }
  return ok(undefined);
};

export const evaluateRetrievalStrategy = (
  holdout: RetrievalHoldout,
  run: RetrievalStrategyRun,
): Result<RetrievalQualityMetrics, DomainError> => {
  const checked = validateHoldout(holdout);
  if (checked._tag === 'Err') return checked;
  if (!sha256(run.holdoutSha256) || run.strategy.trim().length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'retrieval_run', 'strategy and holdout SHA-256 are required'));
  }
  const observationIds = run.observations.map((item) => item.caseId);
  if (new Set(observationIds).size !== observationIds.length) {
    return err(domainError('INVALID_BENCHMARK', 'retrieval_run', 'run observations must have unique case IDs'));
  }
  const expectedIds = holdout.cases.map((item) => item.id).sort();
  if (observationIds.length !== expectedIds.length
    || !expectedIds.every((id) => observationIds.includes(id))) {
    return err(domainError('INVALID_BENCHMARK', 'retrieval_run', 'run must contain exactly one observation for every holdout case'));
  }
  for (const observation of run.observations) {
    if (new Set(observation.retrievedCandidateIds).size !== observation.retrievedCandidateIds.length
      || ![observation.payloadCharacters, observation.duplicateSourceHits, observation.expansionCalls,
        observation.nativeReadDuplicates, observation.latencyMs].every(nonNegative)) {
      return err(domainError('INVALID_BENCHMARK', 'retrieval_run', 'ranked IDs must be unique and counters non-negative'));
    }
  }

  const scores = holdout.cases.map((item) => {
    const observed = run.observations.find((entry) => entry.caseId === item.id) as RetrievalObservation;
    const relevant = new Set(item.relevantCandidateIds);
    return {
      item,
      observed,
      r1: recallWithin(observed.retrievedCandidateIds, relevant, 1),
      r3: recallWithin(observed.retrievedCandidateIds, relevant, 3),
      r5: recallWithin(observed.retrievedCandidateIds, relevant, 5),
      rr: reciprocalRank(observed.retrievedCandidateIds, relevant),
      ndcg5: ndcgAt(observed.retrievedCandidateIds, relevant, 5),
    };
  });
  const critical = scores.filter((item) => item.item.critical === true);
  return ok({
    strategy: run.strategy,
    cases: scores.length,
    recallAt1: mean(scores.map((item) => item.r1)),
    recallAt3: mean(scores.map((item) => item.r3)),
    recallAt5: mean(scores.map((item) => item.r5)),
    criticalRecallAt5: mean(critical.map((item) => item.r5)),
    mrr: mean(scores.map((item) => item.rr)),
    ndcgAt5: mean(scores.map((item) => item.ndcg5)),
    payloadCharactersMean: mean(scores.map((item) => item.observed.payloadCharacters)),
    duplicateSourceHitsMean: mean(scores.map((item) => item.observed.duplicateSourceHits)),
    expansionCallsMean: mean(scores.map((item) => item.observed.expansionCalls)),
    nativeReadDuplicatesMean: mean(scores.map((item) => item.observed.nativeReadDuplicates)),
    latencyP95Ms: p95(scores.map((item) => item.observed.latencyMs)),
    missedCriticalCaseIds: critical.filter((item) => item.r5 === 0).map((item) => item.item.id),
  });
};

export const evaluateRetrievalQualityPolicy = (
  metrics: RetrievalQualityMetrics,
  holdoutSha256: string,
  policy: RetrievalQualityPolicy,
): Result<RetrievalQualityVerdict, DomainError> => {
  const quality = [
    policy.minRecallAt1,
    policy.minRecallAt3,
    policy.minRecallAt5,
    policy.minCriticalRecallAt5,
    policy.minMrr,
    policy.minNdcgAt5,
  ];
  if (!sha256(policy.requiredHoldoutSha256) || !sha256(holdoutSha256)
    || !quality.every(unit) || policy.selectedStrategy.trim().length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'retrieval_policy', 'retrieval quality policy is invalid'));
  }
  const optional = [
    policy.maxPayloadCharactersMean,
    policy.maxDuplicateSourceHitsMean,
    policy.maxExpansionCallsMean,
    policy.maxNativeReadDuplicatesMean,
    policy.maxLatencyP95Ms,
  ].filter((value): value is number => value !== undefined);
  if (!optional.every(nonNegative)) {
    return err(domainError('INVALID_BENCHMARK', 'retrieval_policy', 'retrieval optional limits must be non-negative finite numbers'));
  }
  const failures: string[] = [];
  if (metrics.strategy !== policy.selectedStrategy) failures.push('strategy_mismatch');
  if (holdoutSha256 !== policy.requiredHoldoutSha256) failures.push('holdout_identity_mismatch');
  if (metrics.recallAt1 < policy.minRecallAt1) failures.push('recall_at_1_below_threshold');
  if (metrics.recallAt3 < policy.minRecallAt3) failures.push('recall_at_3_below_threshold');
  if (metrics.recallAt5 < policy.minRecallAt5) failures.push('recall_at_5_below_threshold');
  if (metrics.criticalRecallAt5 < policy.minCriticalRecallAt5) failures.push('critical_recall_at_5_below_threshold');
  if (metrics.mrr < policy.minMrr) failures.push('mrr_below_threshold');
  if (metrics.ndcgAt5 < policy.minNdcgAt5) failures.push('ndcg_at_5_below_threshold');
  if (policy.maxPayloadCharactersMean !== undefined
    && metrics.payloadCharactersMean > policy.maxPayloadCharactersMean) failures.push('payload_above_threshold');
  if (policy.maxDuplicateSourceHitsMean !== undefined
    && metrics.duplicateSourceHitsMean > policy.maxDuplicateSourceHitsMean) failures.push('duplicate_hits_above_threshold');
  if (policy.maxExpansionCallsMean !== undefined
    && metrics.expansionCallsMean > policy.maxExpansionCallsMean) failures.push('expansion_calls_above_threshold');
  if (policy.maxNativeReadDuplicatesMean !== undefined
    && metrics.nativeReadDuplicatesMean > policy.maxNativeReadDuplicatesMean) failures.push('native_read_duplicates_above_threshold');
  if (policy.maxLatencyP95Ms !== undefined
    && metrics.latencyP95Ms > policy.maxLatencyP95Ms) failures.push('latency_p95_above_threshold');
  return ok({
    selectedStrategy: policy.selectedStrategy,
    measurementAccepted: failures.length === 0,
    failures,
    metrics,
  });
};
