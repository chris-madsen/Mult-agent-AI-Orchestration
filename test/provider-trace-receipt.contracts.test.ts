import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateProviderTraceReceipt,
  validateSafeProviderTraceEvent,
} from '../src/domain/provider-trace-receipt.js';
import type { SourceCoverage } from '../src/domain/source-coverage.js';

const requestId = 'ace-request-123';

const coverage: readonly SourceCoverage[] = [
  { source: 'code', requirement: 'required', status: 'satisfied' },
  { source: 'structural', requirement: 'required', status: 'satisfied' },
  { source: 'documentation', requirement: 'required', status: 'satisfied' },
  { source: 'memory', requirement: 'required', status: 'satisfied' },
];

const event = (
  provider: 'embedding' | 'qdrant' | 'typescript_language_service' | 'vertex_rag' | 'graphiti' | 'source_verification',
  status: 'success' | 'failure' = 'success',
  id = requestId,
) => ({
  timestampMs: 100,
  provider,
  providerVersion: provider + '/test',
  operation: 'fixture_operation',
  status,
  durationMs: 1,
  requestId: id,
  ...(status === 'failure' ? { errorCode: 'EXTERNAL_UNAVAILABLE' } : {}),
});

test('trace receipt completes only when every required query-time branch is correlated and successful', () => {
  const result = evaluateProviderTraceReceipt(requestId, coverage, [
    event('embedding'),
    event('qdrant'),
    event('source_verification'),
    event('typescript_language_service'),
    event('vertex_rag'),
    event('graphiti'),
    event('embedding', 'success', 'another-request'),
  ]);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.receipt, 'provider-trace-complete');
  assert.equal(result.value.correlatedEventCount, 6);
  assert.deepEqual(result.value.requiredSources, ['code', 'structural', 'documentation', 'memory']);
  assert.deepEqual(result.value.failures, []);
});

test('wrong request IDs, failed providers and incomplete source coverage remain visible', () => {
  const result = evaluateProviderTraceReceipt(requestId, [
    { source: 'code', requirement: 'required', status: 'partial', reason: 'qdrant_timeout' },
    { source: 'structural', requirement: 'optional', status: 'unavailable', reason: 'not_needed' },
    { source: 'documentation', requirement: 'not_requested', status: 'not_requested' },
    { source: 'memory', requirement: 'required', status: 'satisfied' },
  ], [
    event('embedding'),
    event('qdrant', 'failure'),
    event('source_verification', 'success', 'another-request'),
    event('graphiti'),
  ]);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.receipt, 'provider-trace-incomplete');
  for (const failure of [
    'coverage_not_satisfied:code:partial',
    'missing_trace:code:source_verification',
    'failed_trace:code:qdrant',
  ]) assert.ok(result.value.failures.includes(failure), failure);
  assert.equal(result.value.failures.some((failure) => failure.includes('structural')), false);
  assert.equal(result.value.failures.some((failure) => failure.includes('documentation')), false);
});

test('safe trace validator rejects unexpected payload fields that could smuggle source/query/token data', () => {
  const valid = validateSafeProviderTraceEvent(event('qdrant'));
  assert.equal(valid._tag, 'Ok');

  const withQuery = validateSafeProviderTraceEvent({
    ...event('qdrant'),
    query: 'private source query',
  });
  assert.equal(withQuery._tag, 'Err');

  const credentialLikeMetadata = validateSafeProviderTraceEvent({
    ...event('vertex_rag'),
    providerVersion: 'authorization=Bearer-secret-value',
  });
  assert.equal(credentialLikeMetadata._tag, 'Err');
});

test('receipt rejects duplicate source-coverage entries and meaningless no-required-source inputs', () => {
  const duplicate = evaluateProviderTraceReceipt(requestId, [
    { source: 'code', requirement: 'required', status: 'satisfied' },
    { source: 'code', requirement: 'optional', status: 'satisfied' },
  ], [event('embedding'), event('qdrant'), event('source_verification')]);
  assert.equal(duplicate._tag, 'Err');

  const noRequired = evaluateProviderTraceReceipt(requestId, [
    { source: 'code', requirement: 'optional', status: 'satisfied' },
    { source: 'structural', requirement: 'not_requested', status: 'not_requested' },
  ], [event('embedding')]);
  assert.equal(noRequired._tag, 'Err');
});
