import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRerankerRun,
  frozenRerankerModelCandidates,
  selectRerankerCandidate,
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

test('frozen reranker runs require repository and runtime evidence identities', () => {
  const frozenFixture: RerankerFixture = {
    ...fixture,
    status: 'frozen_reranker_holdout',
    repositories: [
      { id: 'ace', revision: '1'.repeat(40), sourceManifestSha256: 'b'.repeat(64) },
      { id: 'repo-b', revision: '2'.repeat(40), sourceManifestSha256: 'c'.repeat(64) },
    ],
    cases: fixture.cases.map((item, index) => {
      const documentCandidateIds = item.documents.map((_, documentIndex) => `${String(index * 3 + documentIndex + 1).padStart(64, '0')}`);
      return {
        ...item,
        repositoryId: index === 0 ? 'ace' : 'repo-b',
        documentCandidateIds,
        documentRefs: item.documents.map((_, documentIndex) => ({
          candidateId: documentCandidateIds[documentIndex] as string,
          repoPath: `src/${index}-${documentIndex}.ts`,
          sourceDigest: `${String(index * 3 + documentIndex + 1).padStart(64, '0')}`,
          startLine: 1,
          endLine: 1,
        })),
      };
    }),
  };
  const incomplete = evaluateRerankerRun(frozenFixture, {
    ...run,
  });
  assert.equal(incomplete._tag, 'Err');

  const complete = evaluateRerankerRun(frozenFixture, {
    ...run,
    sourceCommit: '3'.repeat(40),
    runnerVersion: 'contract-test/v1',
    providerIdentity: 'fastembed/cross-encoder|model=test',
    modelRevision: 'model-revision',
    artifactIdentity: 'artifact-sha256',
    licenseEvidence: 'license-review/test',
    startupMs: 12,
    rssBytes: 1024,
  });
  assert.equal(complete._tag, 'Ok');
});

test('reranker selection requires non-inferiority plus measurable quality or payload improvement', () => {
  const baseline = evaluateRerankerRun(fixture, run);
  assert.equal(baseline._tag, 'Ok');
  if (baseline._tag === 'Err') return;
  const rejected = selectRerankerCandidate(baseline.value, [{
    identity: 'model-regression',
    licenseEvidence: 'license/test',
    metrics: { ...baseline.value, mrr: baseline.value.mrr - 0.01 },
  }]);
  assert.equal(rejected.accepted, false);
  const accepted = selectRerankerCandidate(baseline.value, [{
    identity: 'model-better',
    licenseEvidence: 'license/test',
    metrics: { ...baseline.value, deliveredPayloadCharactersMean: baseline.value.deliveredPayloadCharactersMean - 1 },
  }]);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.selectedIdentity, 'model-better');
});

test('frozen model candidate list is explicit and unknown license evidence is rejected', () => {
  assert.deepEqual(frozenRerankerModelCandidates, [
    'Xenova/ms-marco-MiniLM-L-6-v2',
    'Xenova/ms-marco-MiniLM-L-12-v2',
    'jinaai/jina-reranker-v1-tiny-en',
    'jinaai/jina-reranker-v1-turbo-en',
    'BAAI/bge-reranker-base',
    'jinaai/jina-reranker-v2-base-multilingual',
  ]);
  const frozenFixture: RerankerFixture = {
    ...fixture,
    status: 'frozen_reranker_holdout',
    repositories: [
      { id: 'ace', revision: '1'.repeat(40), sourceManifestSha256: 'b'.repeat(64) },
      { id: 'repo-b', revision: '2'.repeat(40), sourceManifestSha256: 'c'.repeat(64) },
    ],
    cases: fixture.cases.map((item, index) => {
      const documentCandidateIds = item.documents.map((_, documentIndex) => `${String(index * 3 + documentIndex + 1).padStart(64, '0')}`);
      return {
        ...item,
        repositoryId: index === 0 ? 'ace' : 'repo-b',
        documentCandidateIds,
        documentRefs: item.documents.map((_, documentIndex) => ({
          candidateId: documentCandidateIds[documentIndex] as string,
          repoPath: `src/${index}-${documentIndex}.ts`,
          sourceDigest: `${String(index * 3 + documentIndex + 1).padStart(64, '0')}`,
          startLine: 1,
          endLine: 1,
        })),
      };
    }),
  };
  const invalid = evaluateRerankerRun(frozenFixture, {
    ...run,
    sourceCommit: '3'.repeat(40),
    runnerVersion: 'contract-test/v1',
    providerIdentity: 'fastembed/cross-encoder|model=test',
    modelRevision: 'model-revision',
    artifactIdentity: 'artifact-sha256',
    licenseEvidence: 'unknown',
    startupMs: 1,
    rssBytes: 1,
  });
  assert.equal(invalid._tag, 'Err');
});
