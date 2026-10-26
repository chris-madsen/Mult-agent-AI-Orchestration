import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import type {
  RetrievalBenchmarkStage,
  RetrievalBenchmarkStageStatus,
} from './retrieval-benchmark.js';
import { retrievalBenchmarkStages } from './retrieval-benchmark.js';

export interface RetrievalHoldoutRepository {
  readonly id: string;
  /** Exact Git revision or equivalent immutable source revision. */
  readonly revision: string;
  /** Digest of the repository source manifest used to derive candidate labels. */
  readonly sourceManifestSha256: string;
}

export interface RetrievalHoldoutCase {
  readonly id: string;
  readonly query: string;
  readonly relevantCandidateIds: readonly string[];
  /** Required for release-grade multi-repository holdouts. */
  readonly repositoryId?: string;
  readonly critical?: boolean;
  readonly kind?: 'behavior_without_name'
  | 'exact_symbol_or_config'
  | 'rare_literal'
  | 'same_name_distractor'
  | 'multilingual'
  | 'working_context'
  | 'compactness'
  | 'partial_coverage';
  readonly focusedPath?: string;
}

export interface RetrievalHoldout {
  readonly schemaVersion: 1;
  readonly status: string;
  readonly repositories?: readonly RetrievalHoldoutRepository[];
  readonly cases: readonly RetrievalHoldoutCase[];
}

export interface RetrievalObservation {
  readonly caseId: string;
  /** Ranked, best first. IDs are scored against the frozen holdout labels. */
  readonly retrievedCandidateIds: readonly string[];
  /** Optional raw runtime IDs retained for trace correlation; never used for scoring. */
  readonly rawRetrievedCandidateIds?: readonly string[];
  readonly payloadCharacters: number;
  readonly duplicateSourceHits: number;
  /** Null means this run did not instrument the delivery/expansion path. */
  readonly expansionCalls: number | null;
  /** Null means native source-read duplication was not instrumented. */
  readonly nativeReadDuplicates: number | null;
  readonly latencyMs: number;
  /** Optional UTF-8 delivery telemetry; development runs may omit it. */
  readonly payloadBytes?: number;
  readonly initialEvidenceBytes?: number;
  readonly newContextBytes?: number;
  readonly reusedContextBytes?: number;
  readonly projectionBytesAvoided?: number;
  readonly duplicateContentBytes?: number;
  readonly uniqueContentBytes?: number;
  /** Backward-compatible alias for receipt-reused bytes. */
  readonly duplicateContextBytesAvoided?: number;
  /** Internal benchmark-only ranked snapshots; omitted by development runs. */
  readonly stageRanks?: RetrievalStageRanks;
  /** Runtime ids matching stageRanks, retained for trace correlation only. */
  readonly rawStageRanks?: RetrievalStageRanks;
  /** Frozen runs must state the outcome of every retrieval stage explicitly. */
  readonly stageStatuses?: Readonly<Record<RetrievalBenchmarkStage, RetrievalBenchmarkStageStatus>>;
  readonly stageLatencyMs?: Readonly<Record<string, number>>;
}

export interface RetrievalStageRanks {
  readonly dense: readonly string[];
  readonly sparse: readonly string[];
  readonly fused: readonly string[];
  readonly repoMap: readonly string[];
  readonly workingContext: readonly string[];
  readonly reranked: readonly string[];
  readonly delivered: readonly string[];
}

export interface RetrievalStrategyRun {
  readonly strategy: string;
  readonly holdoutSha256: string;
  readonly observations: readonly RetrievalObservation[];
  /** Evidence identity required for frozen multi-repository runs. */
  readonly sourceCommit?: string;
  readonly runnerVersion?: string;
  readonly providerIdentities?: Readonly<Record<string, string>>;
  readonly tracePaths?: readonly string[];
  readonly terminalTraceReceiptPaths?: readonly string[];
}

export interface RetrievalQualityMetrics {
  readonly strategy: string;
  readonly holdoutStatus: string;
  readonly cases: number;
  readonly repositoryCount: number;
  readonly recallAt1: number;
  readonly recallAt3: number;
  readonly recallAt5: number;
  readonly criticalRecallAt5: number;
  readonly mrr: number;
  readonly ndcgAt5: number;
  readonly payloadCharactersMean: number;
  readonly duplicateSourceHitsMean: number;
  readonly expansionCallsMean: number | null;
  readonly nativeReadDuplicatesMean: number | null;
  readonly latencyP95Ms: number;
  readonly payloadBytesMean?: number;
  readonly initialEvidenceBytesMean?: number;
  readonly newContextBytesMean?: number;
  readonly reusedContextBytesMean?: number;
  readonly projectionBytesAvoidedMean?: number;
  readonly duplicateContentBytesMean?: number;
  readonly uniqueContentBytesMean?: number;
  readonly duplicateContextBytesAvoidedMean?: number;
  readonly missedCriticalCaseIds: readonly string[];
}

export interface RetrievalQualityPolicy {
  readonly selectedStrategy: string;
  readonly requiredHoldoutSha256: string;
  readonly requiredHoldoutStatus: string;
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
  /** Release policy can require true multi-repository coverage without affecting dev fixtures. */
  readonly minRepositoryCount?: number;
  /** Candidate quality must not regress against a same-holdout reference run. */
  readonly nonInferiority?: {
    readonly baselineStrategy: string;
    readonly maxCriticalRecallAt5Regression?: number;
    readonly maxMrrRegression?: number;
    readonly maxNdcgAt5Regression?: number;
  };
}

export interface RetrievalQualityVerdict {
  readonly selectedStrategy: string;
  readonly measurementAccepted: boolean;
  readonly failures: readonly string[];
  readonly metrics: RetrievalQualityMetrics;
}

export interface RetrievalStrategySelection {
  readonly selectedStrategy: string;
  readonly qualityGatePassed: boolean;
  readonly fallbackToDense: boolean;
  readonly rejectedStrategies: readonly string[];
}

const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const unit = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const nonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const validStageStatus = (value: RetrievalBenchmarkStageStatus): boolean =>
  value === 'executed' || value === 'not_applicable' || value === 'unavailable';
const commitIdentity = (value: string | undefined): boolean => value === undefined || /^[a-f0-9]{40,64}$/iu.test(value);
const providerIdentityMap = (value: Readonly<Record<string, string>> | undefined): boolean => value !== undefined
  && Object.keys(value).length > 0
  && Object.entries(value).every(([key, identity]) => key.trim().length > 0 && identity.trim().length > 0);
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const optionalMean = (values: readonly (number | undefined)[]): number | undefined => {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length === 0 ? undefined : mean(present);
};
const requiredMean = (values: readonly (number | null)[]): number | null =>
  values.every((value): value is number => value !== null) ? mean(values) : null;
const nullableCounter = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
const p95 = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

const stageRankFor = (ranks: RetrievalStageRanks, stage: RetrievalBenchmarkStage): readonly string[] => {
  if (stage === 'working_context') return ranks.workingContext;
  if (stage === 'repo_map') return ranks.repoMap;
  return ranks[stage];
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
  const repositories = holdout.repositories ?? [];
  const repositoryIds = new Set<string>();
  for (const repository of repositories) {
    if (repository.id.trim().length === 0
      || repositoryIds.has(repository.id)
      || !/^[a-f0-9]{40,64}$/iu.test(repository.revision)
      || !sha256(repository.sourceManifestSha256)) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'retrieval_holdout.repositories',
        'repository identities must be unique and bind exact revision + source manifest SHA-256',
      ));
    }
    repositoryIds.add(repository.id);
  }
  if (holdout.status === 'frozen_multi_repository_holdout' && repositories.length < 2) {
    return err(domainError(
      'INVALID_BENCHMARK',
      'retrieval_holdout.repositories',
      'frozen multi-repository holdout requires at least two bound repositories',
    ));
  }
  const ids = new Set<string>();
  for (const item of holdout.cases) {
    if (item.id.trim().length === 0 || item.query.trim().length === 0
      || item.relevantCandidateIds.length === 0 || item.relevantCandidateIds.some((id) => id.trim().length === 0)
      || new Set(item.relevantCandidateIds).size !== item.relevantCandidateIds.length
      || ids.has(item.id)) {
      return err(domainError('INVALID_BENCHMARK', 'retrieval_holdout', 'holdout cases require unique IDs, queries and non-empty unique labels'));
    }
    if (item.repositoryId !== undefined && !repositoryIds.has(item.repositoryId)) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'retrieval_holdout.repository_id',
        'case repository_id must reference a repository bound by the holdout',
      ));
    }
    if (holdout.status === 'frozen_multi_repository_holdout' && item.repositoryId === undefined) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'retrieval_holdout.repository_id',
        'every case in a frozen multi-repository holdout must identify its repository',
      ));
    }
    ids.add(item.id);
  }
  if (holdout.status === 'frozen_multi_repository_holdout') {
    const usedRepositories = new Set(holdout.cases.map((item) => item.repositoryId));
    if (repositories.some((repository) => !usedRepositories.has(repository.id))) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'retrieval_holdout.repositories',
        'every bound repository must contribute at least one holdout case',
      ));
    }
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
  if (holdout.status === 'frozen_multi_repository_holdout'
    && (!commitIdentity(run.sourceCommit)
      || run.sourceCommit === undefined
      || run.runnerVersion?.trim().length === 0
      || !providerIdentityMap(run.providerIdentities))) {
    return err(domainError(
      'INVALID_BENCHMARK',
      'retrieval_run.identity',
      'frozen multi-repository runs require source commit, runner version and provider identities',
    ));
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
    const integerCounters = [
      observation.payloadCharacters,
      observation.duplicateSourceHits,
      observation.payloadBytes,
      observation.initialEvidenceBytes,
      observation.newContextBytes,
      observation.reusedContextBytes,
      observation.projectionBytesAvoided,
      observation.duplicateContentBytes,
      observation.uniqueContentBytes,
      observation.duplicateContextBytesAvoided,
    ].filter((value): value is number => value !== undefined);
    if (new Set(observation.retrievedCandidateIds).size !== observation.retrievedCandidateIds.length
      || !nullableCounter(observation.expansionCalls)
      || !nullableCounter(observation.nativeReadDuplicates)
      || !integerCounters.every((value) => Number.isSafeInteger(value) && value >= 0)
      || !nonNegative(observation.latencyMs)
      || (observation.stageLatencyMs !== undefined
        && !Object.values(observation.stageLatencyMs).every(nonNegative))) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'retrieval_run',
        'ranked IDs must be unique, count fields must be non-negative safe integers, and latency must be non-negative',
      ));
    }
    if (holdout.status === 'frozen_multi_repository_holdout') {
      const stageRanks = observation.stageRanks;
      const stageStatuses = observation.stageStatuses;
      if (stageRanks === undefined || stageStatuses === undefined
        || retrievalBenchmarkStages.some((stage) => {
          const status = stageStatuses[stage];
          const ids = stageRankFor(stageRanks, stage);
          if (status === undefined || !validStageStatus(status)
            || new Set(ids).size !== ids.length
            || ids.some((id) => id.trim().length === 0)) return true;
          return status === 'executed' ? ids.length === 0 : ids.length > 0;
        })) {
        return err(domainError(
          'INVALID_BENCHMARK',
          'retrieval_run.stage_ranks',
          'frozen multi-repository runs require explicit status and unique ranks for every retrieval stage',
        ));
      }
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
  const byteMetrics: Partial<Record<
  'payloadBytesMean'
  | 'initialEvidenceBytesMean'
  | 'newContextBytesMean'
  | 'reusedContextBytesMean'
  | 'projectionBytesAvoidedMean'
  | 'duplicateContentBytesMean'
  | 'uniqueContentBytesMean'
  | 'duplicateContextBytesAvoidedMean',
  number
  >> = {};
  const addOptionalMean = (
    key: keyof typeof byteMetrics,
    values: readonly (number | undefined)[],
  ): void => {
    const value = optionalMean(values);
    if (value !== undefined) byteMetrics[key] = value;
  };
  addOptionalMean('payloadBytesMean', scores.map((item) => item.observed.payloadBytes));
  addOptionalMean('initialEvidenceBytesMean', scores.map((item) => item.observed.initialEvidenceBytes));
  addOptionalMean('newContextBytesMean', scores.map((item) => item.observed.newContextBytes));
  addOptionalMean('reusedContextBytesMean', scores.map((item) => item.observed.reusedContextBytes));
  addOptionalMean('projectionBytesAvoidedMean', scores.map((item) => item.observed.projectionBytesAvoided));
  addOptionalMean('duplicateContentBytesMean', scores.map((item) => item.observed.duplicateContentBytes));
  addOptionalMean('uniqueContentBytesMean', scores.map((item) => item.observed.uniqueContentBytes));
  addOptionalMean('duplicateContextBytesAvoidedMean', scores.map((item) => item.observed.duplicateContextBytesAvoided));
  return ok({
    strategy: run.strategy,
    holdoutStatus: holdout.status,
    cases: scores.length,
    repositoryCount: holdout.repositories?.length
      ?? new Set(holdout.cases.flatMap((item) => item.repositoryId === undefined ? [] : [item.repositoryId])).size,
    recallAt1: mean(scores.map((item) => item.r1)),
    recallAt3: mean(scores.map((item) => item.r3)),
    recallAt5: mean(scores.map((item) => item.r5)),
    criticalRecallAt5: mean(critical.map((item) => item.r5)),
    mrr: mean(scores.map((item) => item.rr)),
    ndcgAt5: mean(scores.map((item) => item.ndcg5)),
    payloadCharactersMean: mean(scores.map((item) => item.observed.payloadCharacters)),
    duplicateSourceHitsMean: mean(scores.map((item) => item.observed.duplicateSourceHits)),
    expansionCallsMean: requiredMean(scores.map((item) => item.observed.expansionCalls)),
    nativeReadDuplicatesMean: requiredMean(scores.map((item) => item.observed.nativeReadDuplicates)),
    latencyP95Ms: p95(scores.map((item) => item.observed.latencyMs)),
    ...byteMetrics,
    missedCriticalCaseIds: critical.filter((item) => item.r5 === 0).map((item) => item.item.id),
  });
};

export const evaluateRetrievalQualityPolicy = (
  metrics: RetrievalQualityMetrics,
  holdoutSha256: string,
  policy: RetrievalQualityPolicy,
  baseline?: RetrievalQualityMetrics,
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
    || !quality.every(unit) || policy.selectedStrategy.trim().length === 0
    || policy.requiredHoldoutStatus.trim().length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'retrieval_policy', 'retrieval quality policy is invalid'));
  }
  const optional = [
    policy.maxPayloadCharactersMean,
    policy.maxDuplicateSourceHitsMean,
    policy.maxExpansionCallsMean,
    policy.maxNativeReadDuplicatesMean,
    policy.maxLatencyP95Ms,
  ].filter((value): value is number => value !== undefined);
  if (!optional.every(nonNegative)
    || (policy.minRepositoryCount !== undefined
      && (!Number.isSafeInteger(policy.minRepositoryCount) || policy.minRepositoryCount < 1))
    || (policy.nonInferiority !== undefined
      && (policy.nonInferiority.baselineStrategy.trim().length === 0
        || ![
          policy.nonInferiority.maxCriticalRecallAt5Regression,
          policy.nonInferiority.maxMrrRegression,
          policy.nonInferiority.maxNdcgAt5Regression,
        ].filter((value): value is number => value !== undefined).every(nonNegative)))) {
    return err(domainError('INVALID_BENCHMARK', 'retrieval_policy', 'retrieval optional limits must be non-negative and repository count must be a positive integer'));
  }
  const failures: string[] = [];
  if (metrics.strategy !== policy.selectedStrategy) failures.push('strategy_mismatch');
  if (holdoutSha256 !== policy.requiredHoldoutSha256) failures.push('holdout_identity_mismatch');
  if (metrics.holdoutStatus !== policy.requiredHoldoutStatus) failures.push('holdout_status_mismatch');
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
  if (policy.maxExpansionCallsMean !== undefined) {
    if (metrics.expansionCallsMean === null) failures.push('expansion_calls_unknown');
    else if (metrics.expansionCallsMean > policy.maxExpansionCallsMean) failures.push('expansion_calls_above_threshold');
  }
  if (policy.maxNativeReadDuplicatesMean !== undefined) {
    if (metrics.nativeReadDuplicatesMean === null) failures.push('native_read_duplicates_unknown');
    else if (metrics.nativeReadDuplicatesMean > policy.maxNativeReadDuplicatesMean) failures.push('native_read_duplicates_above_threshold');
  }
  if (policy.maxLatencyP95Ms !== undefined
    && metrics.latencyP95Ms > policy.maxLatencyP95Ms) failures.push('latency_p95_above_threshold');
  if (policy.minRepositoryCount !== undefined
    && metrics.repositoryCount < policy.minRepositoryCount) failures.push('repository_count_below_threshold');
  if (policy.nonInferiority !== undefined) {
    if (baseline === undefined) {
      failures.push('baseline_missing');
    } else {
      if (baseline.strategy !== policy.nonInferiority.baselineStrategy) failures.push('baseline_strategy_mismatch');
      if (baseline.holdoutStatus !== metrics.holdoutStatus
        || baseline.cases !== metrics.cases
        || baseline.repositoryCount !== metrics.repositoryCount) {
        failures.push('baseline_holdout_mismatch');
      }
      const criticalTolerance = policy.nonInferiority.maxCriticalRecallAt5Regression ?? 0;
      const mrrTolerance = policy.nonInferiority.maxMrrRegression ?? 0;
      const ndcgTolerance = policy.nonInferiority.maxNdcgAt5Regression ?? 0;
      if (metrics.criticalRecallAt5 < baseline.criticalRecallAt5 - criticalTolerance) {
        failures.push('critical_recall_at_5_below_baseline');
      }
      if (metrics.mrr < baseline.mrr - mrrTolerance) failures.push('mrr_below_baseline');
      if (metrics.ndcgAt5 < baseline.ndcgAt5 - ndcgTolerance) failures.push('ndcg_at_5_below_baseline');
    }
  }
  return ok({
    selectedStrategy: policy.selectedStrategy,
    measurementAccepted: failures.length === 0,
    failures,
    metrics,
  });
};

/**
 * Selects only among candidates that are non-inferior to the same-holdout
 * dense reference. Compactness and latency are tie-breakers, never a way to
 * compensate for a quality regression.
 */
export const selectRetrievalStrategy = (
  metrics: readonly RetrievalQualityMetrics[],
  baselineStrategy = 'dense',
): Result<RetrievalStrategySelection, DomainError> => {
  const baseline = metrics.find((item) => item.strategy === baselineStrategy);
  if (baseline === undefined) {
    return err(domainError('INVALID_BENCHMARK', 'retrieval_selection', 'dense-only reference metrics are required'));
  }
  const compatible = metrics.filter((item) => item.holdoutStatus === baseline.holdoutStatus
    && item.cases === baseline.cases
    && item.repositoryCount === baseline.repositoryCount);
  const eligible = compatible.filter((item) => item.criticalRecallAt5 >= baseline.criticalRecallAt5
    && item.mrr >= baseline.mrr
    && item.ndcgAt5 >= baseline.ndcgAt5);
  const ranked = [...eligible].sort((left, right) =>
    right.criticalRecallAt5 - left.criticalRecallAt5
      || right.mrr - left.mrr
      || right.ndcgAt5 - left.ndcgAt5
      || (left.payloadBytesMean ?? left.payloadCharactersMean) - (right.payloadBytesMean ?? right.payloadCharactersMean)
      || left.latencyP95Ms - right.latencyP95Ms
      || left.strategy.localeCompare(right.strategy));
  const selected = ranked[0] ?? baseline;
  return ok({
    selectedStrategy: selected.strategy,
    qualityGatePassed: ranked.length > 0,
    fallbackToDense: ranked.length === 0 || selected.strategy === baselineStrategy,
    rejectedStrategies: metrics
      .filter((item) => item.strategy !== selected.strategy && !eligible.includes(item))
      .map((item) => item.strategy),
  });
};
