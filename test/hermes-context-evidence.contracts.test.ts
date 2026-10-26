import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  validateHermesContextEvidence,
  type HermesContextEvidence,
} from '../src/domain/hermes-context-evidence.js';
import { readHermesContextEvidenceJsonl } from '../src/adapters/hermes-context-evidence.js';

const digest = (char: string): string => char.repeat(64);

const valid = (): HermesContextEvidence => ({
  schemaVersion: 1,
  requestId: 'request-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  status: 'ready',
  receiptId: 'receipt-1',
  providerRequestId: 'retrieval-1',
  selectedEvidenceIds: ['evidence-1'],
  omittedEvidenceIds: [],
  bridgeDigest: digest('a'),
  pluginDigest: digest('b'),
  estimatedTokens: 123,
  sourceCommit: 'c'.repeat(40),
  sourceManifestSha256: digest('d'),
  limitations: [],
});

test('valid Hermes ContextEngine evidence is accepted', () => {
  const result = validateHermesContextEvidence(valid());
  assert.equal(result._tag, 'Ok');
});

test('missing receipt or runtime identity is rejected', () => {
  const value = valid();
  const result = validateHermesContextEvidence({
    ...value,
    receiptId: '',
    bridgeDigest: 'bad',
    pluginDigest: 'bad',
  });
  assert.equal(result._tag, 'Err');
});

test('duplicate selected/omitted evidence ids are rejected', () => {
  const result = validateHermesContextEvidence({
    ...valid(),
    selectedEvidenceIds: ['evidence-1'],
    omittedEvidenceIds: ['evidence-1'],
  });
  assert.equal(result._tag, 'Err');
});

test('credential-like fields are not accepted as evidence metadata', () => {
  const result = validateHermesContextEvidence({
    ...valid(),
    limitations: ['access_token=should-not-be-here'],
  });
  assert.equal(result._tag, 'Err');
});

test('JSONL parser validates each Hermes transformation receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hermes-context-evidence-'));
  const path = join(root, 'receipts.jsonl');
  await writeFile(path, `${JSON.stringify(valid())}\n`);
  const result = await readHermesContextEvidenceJsonl(path);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.receiptId, 'receipt-1');
});


test('ready transformation cannot claim provider correlation without providerRequestId', () => {
  const receipt = valid();
  const withoutTrace = { ...receipt, providerRequestId: undefined };
  assert.equal(validateHermesContextEvidence(withoutTrace)._tag, 'Err');
});

test('net-smaller request-only replacement is explicitly distinguished from provider token savings', () => {
  const replaced = validateHermesContextEvidence({
    ...valid(),
    deliveryMode: 'replacement',
    originalEstimatedTokens: 400,
    projectedEstimatedTokens: 260,
    estimatedAddedTokens: -140,
    replacedToolOutputs: 1,
  });
  assert.equal(replaced._tag, 'Ok');
  const noOp = validateHermesContextEvidence({
    ...valid(),
    status: 'not_beneficial',
    deliveryMode: 'no_op',
    originalEstimatedTokens: 400,
    projectedEstimatedTokens: 400,
    estimatedAddedTokens: 0,
    replacedToolOutputs: 0,
  });
  assert.equal(noOp._tag, 'Ok');
  for (const fake of [
    { deliveryMode: 'replacement', estimatedAddedTokens: 120, replacedToolOutputs: 1 },
    { deliveryMode: 'no_op', estimatedAddedTokens: -10, replacedToolOutputs: 0 },
    { deliveryMode: 'replacement', estimatedAddedTokens: -140, replacedToolOutputs: 0 },
  ]) {
    const value = {
      ...valid(), originalEstimatedTokens: 400, projectedEstimatedTokens: 260, ...fake,
    };
    assert.equal(validateHermesContextEvidence(value)._tag, 'Err');
  }
});
