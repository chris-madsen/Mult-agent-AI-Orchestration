import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateEmbeddingSelection,
  type EmbeddingComparisonReport,
  type EmbeddingSelectionPolicy,
} from '../src/domain/embedding-selection.js';

const datasetSha = 'a'.repeat(64);
const artifactSha = 'b'.repeat(64);

const candidate = (provider: string) => ({
  provider,
  model: 'sentence-transformers/example-model',
  revision: 'c'.repeat(40),
  status: 'success' as const,
  dimensions: 384,
  dataset_sha256: datasetSha,
  preprocessing: 'raw_text_v1',
  recall_at_1: 0.8,
  recall_at_3: 0.95,
  recall_at_5: 1,
  mrr: 0.88,
  ndcg_at_5: 0.91,
  query_ms_p95: 25,
  model_load_ms: 1200,
  max_rss_bytes: 500_000_000,
  index_candidates_per_second: 150,
  artifact: {
    model_id: 'example/artifact',
    revision: 'd'.repeat(40),
    tree_sha256: artifactSha,
  },
  runtime: { python: '3.13.11', engine: 'fixture/1.0' },
});

const report: EmbeddingComparisonReport = {
  status: 'comparison-complete',
  evidence_stage: 'frozen_holdout',
  production_approved: false,
  dataset: 'benchmarks/retrieval/frozen-holdout.json',
  dataset_sha256: datasetSha,
  candidates: [candidate('fastembed/onnx'), candidate('sentence-transformers/pytorch')],
};

const policy: EmbeddingSelectionPolicy = {
  selectedProvider: 'fastembed/onnx',
  requiredDatasetSha256: datasetSha,
  thresholds: {
    minRecallAt1: 0.75,
    minRecallAt3: 0.9,
    minRecallAt5: 0.95,
    minMrr: 0.8,
    minNdcgAt5: 0.85,
    maxQueryP95Ms: 50,
    maxModelLoadMs: 3000,
    maxRssBytes: 800_000_000,
  },
  licenses: {
    'fastembed/onnx': {
      spdxId: 'TEST-LICENSE',
      evidence: 'verified fixture evidence',
      verified: true,
    },
  },
  ownerApproval: { status: 'pending' },
};

test('measured holdout can pass while production approval remains explicitly pending', () => {
  const result = evaluateEmbeddingSelection(report, policy);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.measurementAccepted, true);
  assert.equal(result.value.productionApproved, false);
  assert.equal(result.value.status, 'MEASUREMENT_PASS_APPROVAL_PENDING');
  assert.deepEqual(result.value.failures, ['owner_approval_missing']);
});

test('owner approval promotes only the exact measured provider after every evidence gate passes', () => {
  const result = evaluateEmbeddingSelection(report, {
    ...policy,
    ownerApproval: { status: 'approved', provider: 'fastembed/onnx', note: 'fixture approval' },
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.productionApproved, true);
  assert.equal(result.value.status, 'PRODUCTION_APPROVED');

  const wrongProvider = evaluateEmbeddingSelection(report, {
    ...policy,
    ownerApproval: { status: 'approved', provider: 'sentence-transformers/pytorch' },
  });
  assert.equal(wrongProvider._tag, 'Ok');
  if (wrongProvider._tag === 'Ok') assert.equal(wrongProvider.value.productionApproved, false);
});

test('development fixture, unverified license or self-approved comparison cannot pass measurement gate', () => {
  const development = evaluateEmbeddingSelection({ ...report, evidence_stage: 'development_spike' }, policy);
  assert.equal(development._tag, 'Ok');
  if (development._tag === 'Ok') {
    assert.equal(development.value.measurementAccepted, false);
    assert.ok(development.value.failures.includes('not_frozen_holdout'));
  }

  const unverifiedLicense = evaluateEmbeddingSelection(report, {
    ...policy,
    licenses: {
      'fastembed/onnx': { spdxId: 'UNKNOWN', evidence: 'not checked', verified: false },
    },
  });
  assert.equal(unverifiedLicense._tag, 'Ok');
  if (unverifiedLicense._tag === 'Ok') assert.ok(unverifiedLicense.value.failures.includes('license_not_verified'));

  const selfApproved = evaluateEmbeddingSelection({ ...report, production_approved: true }, policy);
  assert.equal(selfApproved._tag, 'Ok');
  if (selfApproved._tag === 'Ok') assert.ok(selfApproved.value.failures.includes('comparison_must_not_self_approve'));
});

test('quality or performance regression is reported as measurement failure, not hidden by owner approval', () => {
  const degraded: EmbeddingComparisonReport = {
    ...report,
    candidates: [
      { ...candidate('fastembed/onnx'), recall_at_3: 0.5, query_ms_p95: 500 },
      candidate('sentence-transformers/pytorch'),
    ],
  };
  const result = evaluateEmbeddingSelection(degraded, {
    ...policy,
    ownerApproval: { status: 'approved', provider: 'fastembed/onnx' },
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.productionApproved, false);
  assert.equal(result.value.status, 'MEASUREMENT_FAIL');
  assert.ok(result.value.failures.includes('recall_at_3_below_threshold'));
  assert.ok(result.value.failures.includes('query_p95_above_threshold'));
});
