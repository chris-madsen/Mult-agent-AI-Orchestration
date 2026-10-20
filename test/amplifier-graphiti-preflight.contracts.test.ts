import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAmplifierGraphitiPreflight } from '../src/domain/amplifier-graphiti-preflight.js';

const readyInput = {
  faceUrlIsLoopback: true,
  faceTokenPresent: true,
  faceModelsReachable: true,
  faceModelAliasPresent: true,
  liveCatalogReachable: true,
  requestedModelPresent: true,
  graphitiCommandConfigured: true,
  graphitiSourceRefPinned: true,
  graphitiConfigPresent: true,
  graphitiConfigIsSecretFree: true,
  structuredOutputJsonObject: true,
  falkorDbIsLoopback: true,
  localEmbedderSupportedByPinnedMcp: true,
  localRerankerSupportedByPinnedMcp: true,
  syntheticOnlyPolicy: true,
  privateCloudApprovalComplete: true,
} as const;

test('Amplifier/Graphiti preflight does not claim production savings', () => {
  const result = evaluateAmplifierGraphitiPreflight(readyInput);
  assert.equal(result.status, 'ready');
  assert.equal(result.productionClaims.tokenSavings5x, false);
  assert.equal(result.productionClaims.graphitiLocalOnly, false);
});

test('missing local Graphiti capabilities remains not-ready', () => {
  const result = evaluateAmplifierGraphitiPreflight({
    ...readyInput,
    localEmbedderSupportedByPinnedMcp: false,
    localRerankerSupportedByPinnedMcp: false,
  });
  assert.equal(result.status, 'not_ready');
  assert.equal(result.checks.find(({ name }) => name === 'local-embedder')?.status, 'blocked');
  assert.equal(result.checks.find(({ name }) => name === 'local-reranker')?.status, 'blocked');
});

test('remote face is policy denied before provider claims', () => {
  const result = evaluateAmplifierGraphitiPreflight({ ...readyInput, faceUrlIsLoopback: false });
  assert.equal(result.status, 'policy_denied');
  assert.equal(result.checks.find(({ name }) => name === 'face-loopback')?.status, 'policy_denied');
});
