import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export interface RerankerFixtureCase {
  readonly id: string;
  readonly query: string;
  readonly documents: readonly string[];
  readonly relevantDocumentIndexes: readonly number[];
  readonly critical?: boolean;
}

export interface RerankerFixture {
  readonly schemaVersion: 1;
  readonly status: string;
  readonly cases: readonly RerankerFixtureCase[];
}

export interface RerankerObservation {
  readonly caseId: string;
  readonly rankedDocumentIndexes: readonly number[];
  readonly latencyMs: number;
}

export interface RerankerEvaluationRun {
  readonly fixtureSha256: string;
  readonly observations: readonly RerankerObservation[];
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
  readonly missedCriticalCaseIds: readonly string[];
}

const nonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
};

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
  for (const item of fixture.cases) {
    const relevant = new Set(item.relevantDocumentIndexes);
    if (item.id.trim().length === 0 || item.query.trim().length === 0 || ids.has(item.id)
      || item.documents.length < 2 || item.documents.some((document) => document.trim().length === 0)
      || relevant.size === 0 || relevant.size !== item.relevantDocumentIndexes.length
      || item.relevantDocumentIndexes.some((index) =>
        !Number.isSafeInteger(index) || index < 0 || index >= item.documents.length)) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'reranker_fixture',
        'cases require unique ids, non-empty query/documents and valid unique relevance labels',
      ));
    }
    ids.add(item.id);
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

  const mean = (values: readonly number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
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
    missedCriticalCaseIds: critical
      .filter((item) => item.r3 === 0)
      .map((item) => item.item.id),
  });
};
