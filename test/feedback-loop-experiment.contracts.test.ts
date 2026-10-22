import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reconcileFeedbackTrials,
  validateFeedbackTaskManifest,
  validateFeedbackReport,
  type FeedbackTaskManifest,
  type FeedbackTrialObservation,
} from '../src/domain/feedback-loop-experiment.js';

const revision = 'a'.repeat(40);
const digest = (character: string): string => character.repeat(64);

const manifest: FeedbackTaskManifest = {
  schemaVersion: 1,
  selection: 'smoke',
  dataset: { id: 'scale-ai/swe-atlas-qna', revision, rawSha256: digest('b') },
  tasks: [{ id: 'task-1', sourceRevision: revision, sourceDigest: digest('c'), taskDigest: digest('d') }],
  holdout: [],
};

const observation = (
  arm: FeedbackTrialObservation['arm'],
  overrides: Partial<FeedbackTrialObservation> = {},
): FeedbackTrialObservation => ({
  arm,
  taskId: 'task-1',
  trialId: `${arm}-trial-1`,
  sourceRevision: revision,
  sourceDigest: digest('c'),
  taskDigest: digest('d'),
  quality: 'pass',
  usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, costUsd: 0.01 },
  durationMs: 100,
  ...(arm === 'native' ? { nativeFileReads: 2 } : {}),
  observedAceCalls: arm === 'native' ? 0 : 1,
  observedAceRequestIds: arm === 'native' ? [] : ['request-1'],
  providerTraceRequestIds: arm === 'native' ? [] : ['request-1'],
  rawArtifactHashes: [{ path: `${arm}/result.json`, sha256: digest('e') }],
  ...overrides,
});

const reconcile = (native = observation('native'), ace = observation('ace_optional')) =>
  reconcileFeedbackTrials({ taskManifest: manifest, native: [native], ace: [ace] });

test('feedback loop reports correlated paired usage without counting cached input twice', () => {
  const result = reconcile(undefined, observation('ace_optional', {
    usage: { inputTokens: 40, cachedInputTokens: 10, outputTokens: 10, costUsd: 0.005 },
  }));
  assert.equal(result._tag, 'Ok');
  assert.equal(result.value.status, 'PASS');
  assert.equal(result.value.qualityGate, 'pass');
  assert.equal(result.value.nativeTotalTokens, 120);
  assert.equal(result.value.aceTotalTokens, 50);
  assert.equal(result.value.aceCachedInputTokens, 10);
  assert.equal(result.value.tokenRatio, 2.4);
});

test('optional ACE with no calls is ACE_NOT_USED and cannot claim token savings', () => {
  const result = reconcile(undefined, observation('ace_optional', {
    observedAceCalls: 0,
    observedAceRequestIds: [],
    providerTraceRequestIds: [],
  }));
  assert.equal(result._tag, 'Ok');
  assert.equal(result.value.status, 'ACE_NOT_USED');
  assert.equal(result.value.aceNotUsed, true);
  assert.equal(result.value.tokenRatio, null);
  assert.equal(result.value.rows[0]?.aceCorrelation, 'ACE_NOT_USED');
});

test('native arm with an ACE call is invalid instead of being treated as a clean baseline', () => {
  const result = reconcile(observation('native', {
    observedAceCalls: 1,
    observedAceRequestIds: ['native-request'],
    providerTraceRequestIds: ['native-request'],
  }));
  assert.equal(result._tag, 'Err');
  assert.match(result.error.message, /native arm/u);
});

test('observed ACE calls without provider correlation remain UNKNOWN', () => {
  const result = reconcile(undefined, observation('ace_optional', { providerTraceRequestIds: [] }));
  assert.equal(result._tag, 'Ok');
  assert.equal(result.value.status, 'UNKNOWN');
  assert.equal(result.value.tokenRatio, null);
  assert.equal(result.value.rows[0]?.aceCorrelation, 'UNKNOWN');
});

test('native pass and ACE fail is a per-task quality regression', () => {
  const result = reconcile(undefined, observation('ace_optional', { quality: 'fail' }));
  assert.equal(result._tag, 'Ok');
  assert.equal(result.value.status, 'QUALITY_REGRESSION');
  assert.deepEqual(result.value.qualityRegressionTaskIds, ['task-1']);
  assert.equal(result.value.tokenRatio, null);
});

test('failed trial evidence is retained and missing usage remains UNKNOWN', () => {
  const result = reconcile(observation('native', { quality: 'fail', usage: {} }));
  assert.equal(result._tag, 'Ok');
  assert.equal(result.value.status, 'UNKNOWN');
  assert.equal(result.value.rows[0]?.nativeQuality, 'fail');
  assert.equal(result.value.rows[0]?.nativeTotalTokens, null);
});

test('invalid zero token counters are rejected instead of becoming a measured zero', () => {
  const result = reconcile(observation('native', { usage: { inputTokens: 0, outputTokens: 20 } }));
  assert.equal(result._tag, 'Err');
  assert.match(result.error.message, /token counters/u);
});

test('missing raw artifact hash is rejected', () => {
  const result = reconcile(observation('native', { rawArtifactHashes: [] }));
  assert.equal(result._tag, 'Err');
  assert.match(result.error.message, /raw artifact hash/u);
});

test('source/task digest mismatch blocks the paired result', () => {
  const result = reconcile(undefined, observation('ace_optional', { sourceDigest: digest('f') }));
  assert.equal(result._tag, 'Err');
  assert.equal(result.error.code, 'DIGEST_MISMATCH');
});

test('duplicate trial and request IDs are invalid', () => {
  const duplicateTrial = reconcile(observation('native', { trialId: 'same' }), observation('ace_optional', { trialId: 'same' }));
  assert.equal(duplicateTrial._tag, 'Err');
  const duplicateRequest = reconcile(undefined, observation('ace_optional', {
    observedAceRequestIds: ['request-1', 'request-1'],
    observedAceCalls: 2,
  }));
  assert.equal(duplicateRequest._tag, 'Err');
});


test('multiple ACE calls are counted as calls, not as one correlated task', () => {
  const result = reconcile(undefined, observation('ace_optional', {
    observedAceCalls: 3,
    observedAceRequestIds: ['request-1', 'request-2', 'request-3'],
    providerTraceRequestIds: ['request-1', 'request-2', 'request-3'],
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.status, 'PASS');
  assert.equal(result.value.aceObservedCalls, 3);
  assert.equal(result.value.aceCorrelatedCalls, 3);
});

test('partially correlated requests are counted individually but not marked complete', () => {
  const result = reconcile(undefined, observation('ace_optional', {
    observedAceCalls: 3,
    observedAceRequestIds: ['request-1', 'request-2', 'request-3'],
    providerTraceRequestIds: ['request-1', 'request-3'],
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.status, 'UNKNOWN');
  assert.equal(result.value.aceObservedCalls, 3);
  assert.equal(result.value.aceCorrelatedCalls, 2);
  assert.equal(result.value.tokenRatio, null);
});

test('quality regression never presents token savings even in the per-task row', () => {
  const result = reconcile(undefined, observation('ace_optional', {
    quality: 'fail',
    usage: { inputTokens: 20, cachedInputTokens: 0, outputTokens: 10 },
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.status, 'QUALITY_REGRESSION');
  assert.equal(result.value.rows[0]?.tokenRatio, null);
  assert.equal(result.value.tokenRatio, null);
});

test('main task manifest requires ten frozen tasks and ten untouched holdout tasks', () => {
  const result = validateFeedbackTaskManifest({
    ...manifest,
    selection: 'main',
  });
  assert.equal(result._tag, 'Err');
  assert.match(result.error.message, /exactly 10/u);
});

test('holdout mutation and duplicate IDs are rejected before trials are reconciled', () => {
  const result = validateFeedbackTaskManifest({
    ...manifest,
    holdout: [manifest.tasks[0]!],
  });
  assert.equal(result._tag, 'Err');
  assert.match(result.error.message, /unique/u);
});

test('feedback report validator rejects malformed rows and zero economic counters', () => {
  const reconciled = reconcile();
  assert.equal(reconciled._tag, 'Ok');
  assert.equal(validateFeedbackReport(reconciled.value)._tag, 'Ok');
  assert.equal(validateFeedbackReport({ ...reconciled.value, rows: [] })._tag, 'Err');
  assert.equal(validateFeedbackReport({ ...reconciled.value, nativeTotalTokens: 0 })._tag, 'Err');
  assert.equal(validateFeedbackReport({ ...reconciled.value, qualityRegressionTaskIds: [7] })._tag, 'Err');
});
