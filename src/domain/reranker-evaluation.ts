import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export interface RerankerFixtureCase {
  readonly id: string;
  readonly repositoryId?: string;
  readonly query: string;
  readonly documents: readonly string[];
  /**
   * Source-bound candidate identities are present only in external frozen
   * holdouts. Development fixtures remain string-only for compatibility.
   */
  readonly documentCandidateIds?: readonly string[];
  readonly documentRefs?: readonly {
    readonly candidateId: string;
    readonly repoPath: string;
    readonly sourceDigest: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly startColumn?: number;
    readonly endColumn?: number;
  }[];
  readonly relevantDocumentIndexes: readonly number[];
  readonly critical?: boolean;
}

export interface RerankerFixture {
  readonly schemaVersion: 1;
  readonly status: string;
  readonly repositories?: readonly {
    readonly id: string;
    readonly revision: string;
    readonly sourceManifestSha256: string;
  }[];
  readonly excludedRetrievalCandidateIds?: readonly string[];
  readonly cases: readonly RerankerFixtureCase[];
}

export interface RerankerObservation {
  readonly caseId: string;
  readonly rankedDocumentIndexes: readonly number[];
  readonly latencyMs: number;
  readonly deliveredPayloadCharacters?: number;
}

export interface RerankerEvaluationRun {
  readonly fixtureSha256: string;
  readonly observations: readonly RerankerObservation[];
  readonly role?: 'baseline' | 'candidate';
  readonly sourceCommit?: string;
  readonly runnerVersion?: string;
  readonly providerIdentity?: string;
  readonly modelRevision?: string;
  readonly artifactIdentity?: string;
  readonly licenseEvidence?: string;
  readonly modelId?: string;
  readonly startupMs?: number;
  readonly rssBytes?: number;
}

export interface RerankerEvaluationMetrics {
  readonly fixtureStatus: string;
  readonly cases: number;
  readonly recallAt1: number;
  readonly recallAt3: number;
  readonly criticalRecallAt3: number;
  readonly mrr: number;
  readonly ndcgAt5: number;
  readonly latencyP50Ms: number;
  readonly latencyP95Ms: number;
  readonly deliveredPayloadCharactersMean: number;
  readonly missedCriticalCaseIds: readonly string[];
}

export interface RerankerSelectionCandidate {
  readonly identity: string;
  readonly modelId?: string;
  readonly metrics: RerankerEvaluationMetrics;
  readonly licenseEvidence: string;
}

export interface RerankerSelectionVerdict {
  readonly selectedIdentity: string | null;
  readonly accepted: boolean;
  readonly rejectedIdentities: readonly string[];
  readonly reason: string;
}

const nonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const commit = (value: string): boolean => /^[a-f0-9]{40,64}$/iu.test(value);

export const frozenRerankerModelCandidates = [
  'Xenova/ms-marco-MiniLM-L-6-v2',
  'Xenova/ms-marco-MiniLM-L-12-v2',
  'jinaai/jina-reranker-v1-tiny-en',
  'jinaai/jina-reranker-v1-turbo-en',
  'BAAI/bge-reranker-base',
  'jinaai/jina-reranker-v2-base-multilingual',
] as const;

const knownLicenseEvidence = (value: string): boolean => {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized.length > 0
    && !['unknown', 'not_available', 'unverified', 'not_applicable'].includes(normalized);
};

const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
};
const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

const recallWithin = (
  ranked: readonly number[],
  relevant: ReadonlySet<number>,
  k: number,
): number => ranked.slice(0, k).some((index) => relevant.has(index)) ? 1 : 0;

const reciprocalRank = (
  ranked: readonly number[],
  relevant: ReadonlySet<number>,
): number => {
  const index = ranked.findIndex((item) => relevant.has(item));
  return index < 0 ? 0 : 1 / (index + 1);
};

const ndcgAt = (
  ranked: readonly number[],
  relevant: ReadonlySet<number>,
  k: number,
): number => {
  let dcg = 0;
  for (const [rank, index] of ranked.slice(0, k).entries()) {
    if (relevant.has(index)) dcg += 1 / Math.log2(rank + 2);
  }
  const idealCount = Math.min(k, relevant.size);
  let idcg = 0;
  for (let rank = 0; rank < idealCount; rank += 1) idcg += 1 / Math.log2(rank + 2);
  return idcg === 0 ? 0 : dcg / idcg;
};

const validateFixture = (fixture: RerankerFixture): Result<void, DomainError> => {
  if (fixture.schemaVersion !== 1 || fixture.status.trim().length === 0 || fixture.cases.length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'reranker_fixture', 'fixture schema/status/cases are invalid'));
  }
  const ids = new Set<string>();
  const repositoryIds = new Set<string>((fixture.repositories ?? []).map((item) => item.id));
  if (fixture.status === 'frozen_reranker_holdout'
    && (fixture.repositories === undefined || fixture.repositories.length < 2
      || fixture.repositories.some((item) => item.id.trim().length === 0
        || !commit(item.revision)
        || !sha256(item.sourceManifestSha256))
      || new Set(fixture.repositories.map((item) => item.id)).size !== fixture.repositories.length)) {
    return err(domainError('INVALID_BENCHMARK', 'reranker_fixture.repositories', 'frozen reranker holdout requires unique immutable repository identities'));
  }
  for (const item of fixture.cases) {
    const relevant = new Set(item.relevantDocumentIndexes);
    if (item.id.trim().length === 0 || item.query.trim().length === 0 || ids.has(item.id)
      || item.documents.length < 2 || item.documents.some((document) => document.trim().length === 0)
      || relevant.size === 0 || relevant.size !== item.relevantDocumentIndexes.length
      || item.relevantDocumentIndexes.some((index) =>
        !Number.isSafeInteger(index) || index < 0 || index >= item.documents.length)
      || (fixture.status === 'frozen_reranker_holdout'
        && (item.repositoryId === undefined || !repositoryIds.has(item.repositoryId)))) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'reranker_fixture',
        'cases require unique ids, non-empty query/documents and valid unique relevance labels',
      ));
    }
    if (item.documentCandidateIds !== undefined
      && (item.documentCandidateIds.length !== item.documents.length
        || new Set(item.documentCandidateIds).size !== item.documentCandidateIds.length
        || item.documentCandidateIds.some((candidateId) => !sha256(candidateId)))) {
      return err(domainError('INVALID_BENCHMARK', 'reranker_fixture.documents', 'document candidate ids must be unique SHA-256 identities'));
    }
    if (item.documentRefs !== undefined
      && (item.documentRefs.length !== item.documents.length
        || item.documentRefs.some((reference, index) => reference.candidateId !== item.documentCandidateIds?.[index]
          || reference.repoPath.trim().length === 0
          || !sha256(reference.sourceDigest)
          || !Number.isSafeInteger(reference.startLine)
          || !Number.isSafeInteger(reference.endLine)
          || reference.startLine < 1
          || reference.endLine < reference.startLine))) {
      return err(domainError('INVALID_BENCHMARK', 'reranker_fixture.documents', 'source references must match every document identity'));
    }
    if (fixture.status === 'frozen_reranker_holdout'
      && (item.documentCandidateIds === undefined || item.documentRefs === undefined)) {
      return err(domainError('INVALID_BENCHMARK', 'reranker_fixture.documents', 'frozen reranker documents require source-bound candidate references'));
    }
    if (fixture.excludedRetrievalCandidateIds !== undefined
      && item.documentCandidateIds?.some((candidateId) => fixture.excludedRetrievalCandidateIds?.includes(candidateId))) {
      return err(domainError('INVALID_BENCHMARK', 'reranker_fixture.documents', 'reranker holdout overlaps retrieval holdout candidates'));
    }
    ids.add(item.id);
  }
  if (fixture.status === 'frozen_reranker_holdout'
    && (fixture.repositories ?? []).some((repository) => !fixture.cases.some((item) => item.repositoryId === repository.id))) {
    return err(domainError('INVALID_BENCHMARK', 'reranker_fixture.repositories', 'every frozen reranker repository must contribute at least one case'));
  }
  if (!fixture.cases.some((item) => item.critical === true)) {
    return err(domainError('INVALID_BENCHMARK', 'reranker_fixture', 'fixture requires at least one critical case'));
  }
  return ok(undefined);
};

export const evaluateRerankerRun = (
  fixture: RerankerFixture,
  run: RerankerEvaluationRun,
): Result<RerankerEvaluationMetrics, DomainError> => {
  const checked = validateFixture(fixture);
  if (checked._tag === 'Err') return checked;
  if (!/^[a-f0-9]{64}$/u.test(run.fixtureSha256)) {
    return err(domainError('INVALID_BENCHMARK', 'reranker_run', 'fixture SHA-256 is required'));
  }
  if (fixture.status === 'frozen_reranker_holdout'
    && (!run.sourceCommit || !commit(run.sourceCommit)
      || run.runnerVersion?.trim().length === 0
      || run.providerIdentity?.trim().length === 0
      || (run.role !== 'baseline' && (run.modelRevision?.trim().length === 0
        || run.artifactIdentity?.trim().length === 0
        || run.licenseEvidence === undefined || !knownLicenseEvidence(run.licenseEvidence)
        || run.startupMs === undefined || !nonNegative(run.startupMs)
        || run.rssBytes === undefined || !Number.isSafeInteger(run.rssBytes) || run.rssBytes < 0)))) {
    return err(domainError(
      'INVALID_BENCHMARK',
      'reranker_run.identity',
      'frozen reranker runs require source, runner, model, artifact, license, startup and RSS evidence',
    ));
  }
  const observedIds = run.observations.map((item) => item.caseId);
  const expectedIds = fixture.cases.map((item) => item.id).sort();
  if (new Set(observedIds).size !== observedIds.length
    || observedIds.length !== expectedIds.length
    || !expectedIds.every((id) => observedIds.includes(id))) {
    return err(domainError(
      'INVALID_BENCHMARK',
      'reranker_run',
      'run must contain exactly one observation for every fixture case',
    ));
  }

  const scored = [];
  for (const item of fixture.cases) {
    const observed = run.observations.find((entry) => entry.caseId === item.id) as RerankerObservation;
    if (!nonNegative(observed.latencyMs)
      || (observed.deliveredPayloadCharacters !== undefined && !Number.isSafeInteger(observed.deliveredPayloadCharacters))
      || (observed.deliveredPayloadCharacters !== undefined && observed.deliveredPayloadCharacters < 0)
      || observed.rankedDocumentIndexes.length !== item.documents.length
      || new Set(observed.rankedDocumentIndexes).size !== observed.rankedDocumentIndexes.length
      || observed.rankedDocumentIndexes.some((index) =>
        !Number.isSafeInteger(index) || index < 0 || index >= item.documents.length)) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'reranker_run',
        'ranked indexes must be a complete permutation and latency must be non-negative',
      ));
    }
    const relevant = new Set(item.relevantDocumentIndexes);
    scored.push({
      item,
      observed,
      r1: recallWithin(observed.rankedDocumentIndexes, relevant, 1),
      r3: recallWithin(observed.rankedDocumentIndexes, relevant, 3),
      rr: reciprocalRank(observed.rankedDocumentIndexes, relevant),
      ndcg5: ndcgAt(observed.rankedDocumentIndexes, relevant, 5),
    });
  }

  const critical = scored.filter((item) => item.item.critical === true);
  return ok({
    fixtureStatus: fixture.status,
    cases: scored.length,
    recallAt1: mean(scored.map((item) => item.r1)),
    recallAt3: mean(scored.map((item) => item.r3)),
    criticalRecallAt3: mean(critical.map((item) => item.r3)),
    mrr: mean(scored.map((item) => item.rr)),
    ndcgAt5: mean(scored.map((item) => item.ndcg5)),
    latencyP50Ms: percentile(scored.map((item) => item.observed.latencyMs), 0.5),
    latencyP95Ms: percentile(scored.map((item) => item.observed.latencyMs), 0.95),
    deliveredPayloadCharactersMean: mean(scored.map((item) => item.observed.deliveredPayloadCharacters ?? 0)),
    missedCriticalCaseIds: critical
      .filter((item) => item.r3 === 0)
      .map((item) => item.item.id),
  });
};

/**
 * A reranker cannot be approved by startup success alone. It must preserve
 * frozen-holdout quality and improve quality or delivered payload relative to
 * the configured hybrid-without-reranker reference.
 */
export const selectRerankerCandidate = (
  baseline: RerankerEvaluationMetrics,
  candidates: readonly RerankerSelectionCandidate[],
): RerankerSelectionVerdict => {
  const eligible = candidates.filter((candidate) => candidate.metrics.fixtureStatus === baseline.fixtureStatus
    && candidate.metrics.cases === baseline.cases
    && candidate.metrics.criticalRecallAt3 >= baseline.criticalRecallAt3
    && candidate.metrics.mrr >= baseline.mrr
    && candidate.metrics.ndcgAt5 >= baseline.ndcgAt5
    && knownLicenseEvidence(candidate.licenseEvidence)
    && (candidate.metrics.criticalRecallAt3 > baseline.criticalRecallAt3
      || candidate.metrics.mrr > baseline.mrr
      || candidate.metrics.ndcgAt5 > baseline.ndcgAt5
      || candidate.metrics.deliveredPayloadCharactersMean < baseline.deliveredPayloadCharactersMean));
  const ranked = [...eligible].sort((left, right) =>
    right.metrics.criticalRecallAt3 - left.metrics.criticalRecallAt3
      || right.metrics.mrr - left.metrics.mrr
      || right.metrics.ndcgAt5 - left.metrics.ndcgAt5
      || left.metrics.deliveredPayloadCharactersMean - right.metrics.deliveredPayloadCharactersMean
      || left.metrics.latencyP95Ms - right.metrics.latencyP95Ms
      || left.identity.localeCompare(right.identity));
  return {
    selectedIdentity: ranked[0]?.identity ?? null,
    accepted: ranked.length > 0,
    rejectedIdentities: candidates.filter((candidate) => !eligible.includes(candidate)).map((candidate) => candidate.identity),
    reason: ranked.length > 0
      ? 'candidate preserves frozen quality and improves quality or delivered payload'
      : 'no candidate demonstrated an improvement without frozen quality regression',
  };
};
