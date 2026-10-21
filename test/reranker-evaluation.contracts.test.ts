import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRerankerRun,
  type RerankerFixture,
  type RerankerEvaluationRun,
} from '../src/domain/reranker-evaluation.js';

const fixture: RerankerFixture = {
  schemaVersion: 1,
  status: 'frozen_holdout',
  cases: [
    {
      id: 'critical-first',
      query: 'find relevant',
      documents: ['relevant', 'other', 'other two'],
      relevantDocumentIndexes: [0],
      critical: true,
    },
    {
      id: 'critical-third',
      query: 'find another',
      documents: ['x', 'y', 'relevant'],
      relevantDocumentIndexes: [2],
      critical: true,
    },
    {
      id: 'noncritical-miss',
      query: 'miss',
      documents: ['a', 'b', 'c'],
      relevantDocumentIndexes: [1],
    },
  ],
};

const run: RerankerEvaluationRun = {
  fixtureSha256: 'a'.repeat(64),
  observations: [
    { caseId: 'critical-first', rankedDocumentIndexes: [0, 1, 2], latencyMs: 10 },
    { caseId: 'critical-third', rankedDocumentIndexes: [0, 1, 2], latencyMs: 20 },
    { caseId: 'noncritical-miss', rankedDocumentIndexes: [2, 0, 1], latencyMs: 30 },
  ],
};

test('reranker evaluator computes quality and latency without selecting a model', () => {
  const result = evaluateRerankerRun(fixture, run);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.cases, 3);
  assert.equal(result.value.recallAt1, 1 / 3);
  assert.equal(result.value.recallAt3, 1);
  assert.equal(result.value.criticalRecallAt3, 1);
  assert.equal(result.value.mrr, (1 + 1 / 3 + 1 / 3) / 3);
  assert.equal(result.value.latencyP50Ms, 20);
  assert.equal(result.value.latencyP95Ms, 30);
  assert.deepEqual(result.value.missedCriticalCaseIds, []);
});

test('reranker evaluator rejects partial rankings and invalid relevance labels', () => {
  const partial = evaluateRerankerRun(fixture, {
    ...run,
    observations: run.observations.map((item, index) =>
      index === 0 ? { ...item, rankedDocumentIndexes: [0, 1] } : item),
  });
  assert.equal(partial._tag, 'Err');

  const invalidFixture: RerankerFixture = {
    ...fixture,
    cases: [{
      id: 'bad',
      query: 'bad',
      documents: ['a', 'b'],
      relevantDocumentIndexes: [2],
      critical: true,
    }],
  };
  assert.equal(evaluateRerankerRun(invalidFixture, {
    fixtureSha256: 'a'.repeat(64),
    observations: [{ caseId: 'bad', rankedDocumentIndexes: [0, 1], latencyMs: 1 }],
  })._tag, 'Err');
});
