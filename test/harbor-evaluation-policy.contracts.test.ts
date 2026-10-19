import assert from 'node:assert/strict';
import test from 'node:test';
import { assessHarborAcceptance, type HarborAcceptanceEvidence } from '../src/domain/harbor-evaluation-policy.js';

const complete: HarborAcceptanceEvidence = {
  paired: true,
  qualityNonInferior: true,
  actualAceCallObserved: true,
  codeEvidenceObserved: true,
  providerOperationsObserved: true,
  forcedToolUse: false,
  providerRequestCorrelationVerified: true,
  completeCostTelemetry: true,
};

test('DBC-12 forced ACE invocation cannot become production acceptance even at 5x', () => {
  assert.equal(assessHarborAcceptance({ ...complete, forcedToolUse: true }), 'diagnostic-only');
});

test('DBC-12 uncorrelated provider operations and unknown infrastructure costs remain diagnostic', () => {
  assert.equal(assessHarborAcceptance({ ...complete, providerRequestCorrelationVerified: false }), 'diagnostic-only');
  assert.equal(assessHarborAcceptance({ ...complete, completeCostTelemetry: false }), 'diagnostic-only');
});

test('DBC-12 missing real ACE calls or quality parity rejects benchmark', () => {
  assert.equal(assessHarborAcceptance({ ...complete, actualAceCallObserved: false }), 'rejected');
  assert.equal(assessHarborAcceptance({ ...complete, providerOperationsObserved: false }), 'rejected');
  assert.equal(assessHarborAcceptance({ ...complete, qualityNonInferior: false }), 'rejected');
});

test('DBC-12 production evidence requires every independent acceptance precondition', () => {
  assert.equal(assessHarborAcceptance(complete), 'measured-not-necessarily-5x');
});
