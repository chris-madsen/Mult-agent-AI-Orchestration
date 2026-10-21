import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRetrievalQualityPolicy,
  evaluateRetrievalStrategy,
  type RetrievalHoldout,
  type RetrievalQualityPolicy,
  type RetrievalStrategyRun,
} from '../src/domain/retrieval-quality-evaluation.js';

const holdout: RetrievalHoldout = {
  schemaVersion: 1,
  status: 'frozen_holdout',
  cases: [
    { id: 'critical-first', query: 'find first behavior', relevantCandidateIds: ['a'], critical: true },
    { id: 'critical-third', query: 'find third behavior', relevantCandidateIds: ['b'], critical: true },
    { id: 'noncritical-miss', query: 'find missing behavior', relevantCandidateIds: ['c'] },
  ],
};

const holdoutSha = 'a'.repeat(64);

const run: RetrievalStrategyRun = {
  strategy: 'hybrid-v1',
  holdoutSha256: holdoutSha,
  observations: [
    {
      caseId: 'critical-first',
      retrievedCandidateIds: ['a', 'x', 'y'],
      payloadCharacters: 100,
      duplicateSourceHits: 0,
      expansionCalls: 1,
      nativeReadDuplicates: 0,
      latencyMs: 10,
    },
    {
      caseId: 'critical-third',
      retrievedCandidateIds: ['x', 'y', 'b'],
      payloadCharacters: 200,
      duplicateSourceHits: 1,
      expansionCalls: 2,
      nativeReadDuplicates: 1,
      latencyMs: 20,
    },
    {
      caseId: 'noncritical-miss',
      retrievedCandidateIds: ['x', 'y', 'z'],
      payloadCharacters: 300,
      duplicateSourceHits: 2,
      expansionCalls: 3,
      nativeReadDuplicates: 2,
      latencyMs: 30,
    },
  ],
};

test('retrieval evaluator scores ranked IDs and compactness counters from one matched holdout', () => {
  const evaluated = evaluateRetrievalStrategy(holdout, run);
  assert.equal(evaluated._tag, 'Ok');
  if (evaluated._tag === 'Err') throw new Error(evaluated.error.message);
  assert.equal(evaluated.value.holdoutStatus, 'frozen_holdout');
  assert.equal(evaluated.value.cases, 3);
  assert.equal(evaluated.value.recallAt1, 1 / 3);
  assert.equal(evaluated.value.recallAt3, 2 / 3);
  assert.equal(evaluated.value.recallAt5, 2 / 3);
  assert.equal(evaluated.value.criticalRecallAt5, 1);
  assert.equal(evaluated.value.mrr, (1 + (1 / 3)) / 3);
  assert.ok(evaluated.value.ndcgAt5 > 0 && evaluated.value.ndcgAt5 < 1);
  assert.equal(evaluated.value.payloadCharactersMean, 200);
  assert.equal(evaluated.value.duplicateSourceHitsMean, 1);
  assert.equal(evaluated.value.expansionCallsMean, 2);
  assert.equal(evaluated.value.nativeReadDuplicatesMean, 1);
  assert.equal(evaluated.value.latencyP95Ms, 30);
  assert.deepEqual(evaluated.value.missedCriticalCaseIds, []);
});

test('retrieval evaluator rejects incomplete runs and duplicate ranked candidate IDs', () => {
  const incomplete = evaluateRetrievalStrategy(holdout, {
    ...run,
    observations: run.observations.slice(0, -1),
  });
  assert.equal(incomplete._tag, 'Err');

  const duplicateRanked = evaluateRetrievalStrategy(holdout, {
    ...run,
    observations: run.observations.map((item, index) => index === 0
      ? { ...item, retrievedCandidateIds: ['a', 'a'] }
      : item),
  });
  assert.equal(duplicateRanked._tag, 'Err');
});

const policy: RetrievalQualityPolicy = {
  selectedStrategy: 'hybrid-v1',
  requiredHoldoutSha256: holdoutSha,
  requiredHoldoutStatus: 'frozen_holdout',
  minRecallAt1: 0.3,
  minRecallAt3: 0.6,
  minRecallAt5: 0.6,
  minCriticalRecallAt5: 1,
  minMrr: 0.4,
  minNdcgAt5: 0.4,
  maxPayloadCharactersMean: 250,
  maxDuplicateSourceHitsMean: 1,
  maxExpansionCallsMean: 2,
  maxNativeReadDuplicatesMean: 1,
  maxLatencyP95Ms: 35,
};

test('predeclared retrieval policy accepts only the selected strategy on the exact holdout', () => {
  const metrics = evaluateRetrievalStrategy(holdout, run);
  assert.equal(metrics._tag, 'Ok');
  if (metrics._tag === 'Err') throw new Error(metrics.error.message);

  const accepted = evaluateRetrievalQualityPolicy(metrics.value, holdoutSha, policy);
  assert.equal(accepted._tag, 'Ok');
  if (accepted._tag === 'Err') throw new Error(accepted.error.message);
  assert.equal(accepted.value.measurementAccepted, true);
  assert.deepEqual(accepted.value.failures, []);

  const wrongHoldout = evaluateRetrievalQualityPolicy(metrics.value, 'b'.repeat(64), policy);
  assert.equal(wrongHoldout._tag, 'Ok');
  if (wrongHoldout._tag === 'Ok') {
    assert.equal(wrongHoldout.value.measurementAccepted, false);
    assert.ok(wrongHoldout.value.failures.includes('holdout_identity_mismatch'));
  }
  const wrongStatus = evaluateRetrievalQualityPolicy(metrics.value, holdoutSha, {
    ...policy,
    requiredHoldoutStatus: 'production_holdout',
  });
  assert.equal(wrongStatus._tag, 'Ok');
  if (wrongStatus._tag === 'Ok') {
    assert.equal(wrongStatus.value.measurementAccepted, false);
    assert.ok(wrongStatus.value.failures.includes('holdout_status_mismatch'));
  }
});

test('quality, critical recall, compactness and latency regressions are separately visible', () => {
  const degraded = evaluateRetrievalStrategy(holdout, {
    ...run,
    observations: run.observations.map((item) => ({
      ...item,
      retrievedCandidateIds: ['x', 'y', 'z'],
      payloadCharacters: 1000,
      duplicateSourceHits: 4,
      expansionCalls: 5,
      nativeReadDuplicates: 3,
      latencyMs: 500,
    })),
  });
  assert.equal(degraded._tag, 'Ok');
  if (degraded._tag === 'Err') throw new Error(degraded.error.message);

  const verdict = evaluateRetrievalQualityPolicy(degraded.value, holdoutSha, policy);
  assert.equal(verdict._tag, 'Ok');
  if (verdict._tag === 'Err') throw new Error(verdict.error.message);
  assert.equal(verdict.value.measurementAccepted, false);
  for (const failure of [
    'recall_at_1_below_threshold',
    'recall_at_3_below_threshold',
    'recall_at_5_below_threshold',
    'critical_recall_at_5_below_threshold',
    'mrr_below_threshold',
    'ndcg_at_5_below_threshold',
    'payload_above_threshold',
    'duplicate_hits_above_threshold',
    'expansion_calls_above_threshold',
    'native_read_duplicates_above_threshold',
    'latency_p95_above_threshold',
  ]) assert.ok(verdict.value.failures.includes(failure), failure);
});


test('release-grade multi-repository holdout binds exact repositories and case ownership', () => {
  const multi: RetrievalHoldout = {
    schemaVersion: 1,
    status: 'frozen_multi_repository_holdout',
    repositories: [
      { id: 'repo-a', revision: '1'.repeat(40), sourceManifestSha256: 'a'.repeat(64) },
      { id: 'repo-b', revision: '2'.repeat(40), sourceManifestSha256: 'b'.repeat(64) },
    ],
    cases: [
      {
        id: 'repo-a-case',
        repositoryId: 'repo-a',
        query: 'find behavior in repo a',
        relevantCandidateIds: ['a'],
        critical: true,
      },
      {
        id: 'repo-b-case',
        repositoryId: 'repo-b',
        query: 'find behavior in repo b',
        relevantCandidateIds: ['b'],
        critical: true,
      },
    ],
  };
  const multiRun: RetrievalStrategyRun = {
    strategy: 'hybrid_rrf',
    holdoutSha256: 'c'.repeat(64),
    observations: [
      {
        caseId: 'repo-a-case',
        retrievedCandidateIds: ['a'],
        payloadCharacters: 100,
        duplicateSourceHits: 0,
        expansionCalls: 0,
        nativeReadDuplicates: 0,
        latencyMs: 10,
      },
      {
        caseId: 'repo-b-case',
        retrievedCandidateIds: ['b'],
        payloadCharacters: 100,
        duplicateSourceHits: 0,
        expansionCalls: 0,
        nativeReadDuplicates: 0,
        latencyMs: 12,
      },
    ],
  };
  const metrics = evaluateRetrievalStrategy(multi, multiRun);
  assert.equal(metrics._tag, 'Ok');
  if (metrics._tag === 'Err') throw new Error(metrics.error.message);
  assert.equal(metrics.value.repositoryCount, 2);

  const multiPolicy: RetrievalQualityPolicy = {
    selectedStrategy: 'hybrid_rrf',
    requiredHoldoutSha256: 'c'.repeat(64),
    requiredHoldoutStatus: 'frozen_multi_repository_holdout',
    minRecallAt1: 1,
    minRecallAt3: 1,
    minRecallAt5: 1,
    minCriticalRecallAt5: 1,
    minMrr: 1,
    minNdcgAt5: 1,
    minRepositoryCount: 2,
  };
  const accepted = evaluateRetrievalQualityPolicy(metrics.value, 'c'.repeat(64), multiPolicy);
  assert.equal(accepted._tag, 'Ok');
  if (accepted._tag === 'Ok') assert.equal(accepted.value.measurementAccepted, true);

  const tooManyRequired = evaluateRetrievalQualityPolicy(metrics.value, 'c'.repeat(64), {
    ...multiPolicy,
    minRepositoryCount: 3,
  });
  assert.equal(tooManyRequired._tag, 'Ok');
  if (tooManyRequired._tag === 'Ok') {
    assert.equal(tooManyRequired.value.measurementAccepted, false);
    assert.ok(tooManyRequired.value.failures.includes('repository_count_below_threshold'));
  }
});

test('multi-repository holdout rejects fake coverage and unbound cases', () => {
  const oneRepo: RetrievalHoldout = {
    schemaVersion: 1,
    status: 'frozen_multi_repository_holdout',
    repositories: [
      { id: 'repo-a', revision: '1'.repeat(40), sourceManifestSha256: 'a'.repeat(64) },
    ],
    cases: [
      {
        id: 'only-case',
        repositoryId: 'repo-a',
        query: 'find behavior',
        relevantCandidateIds: ['a'],
        critical: true,
      },
    ],
  };
  const runForOne: RetrievalStrategyRun = {
    strategy: 'hybrid_rrf',
    holdoutSha256: 'd'.repeat(64),
    observations: [{
      caseId: 'only-case',
      retrievedCandidateIds: ['a'],
      payloadCharacters: 1,
      duplicateSourceHits: 0,
      expansionCalls: 0,
      nativeReadDuplicates: 0,
      latencyMs: 1,
    }],
  };
  assert.equal(evaluateRetrievalStrategy(oneRepo, runForOne)._tag, 'Err');

  const unbound: RetrievalHoldout = {
    ...oneRepo,
    repositories: [
      { id: 'repo-a', revision: '1'.repeat(40), sourceManifestSha256: 'a'.repeat(64) },
      { id: 'repo-b', revision: '2'.repeat(40), sourceManifestSha256: 'b'.repeat(64) },
    ],
    cases: [{ ...oneRepo.cases[0]!, repositoryId: undefined }],
  };
  assert.equal(evaluateRetrievalStrategy(unbound, runForOne)._tag, 'Err');
});
