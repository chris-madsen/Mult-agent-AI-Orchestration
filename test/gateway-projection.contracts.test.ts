import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { makeGatewayProjectionService, type GatewayHostModelBudgetPort } from '../src/application/gateway-projection-service.js';
import type { AceTransformResult, ContextTransformService } from '../src/application/context-transform-service.js';
import { sha256Base64, validateGatewayProjectionRequest, type GatewayProjectionRequest } from '../src/domain/gateway-projection.js';
import { err, ok } from '../src/domain/result.js';
import { domainError } from '../src/domain/errors.js';

const body = { model: 'test-model', messages: [{ role: 'system', content: 'policy' }, { role: 'user', content: 'find handler' }], unknown: { keep: true } };
const bodyBase64 = Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
const digest = (seed: string): string => createHash('sha256').update(seed, 'utf8').digest('hex');
const attestation = {
  hostBuildDigest: digest('host'), sessionId: 'session-1', activeEngineId: 'ace_context_engine',
  effectiveCompressionControlsDigest: digest('controls'), durableActiveTranscriptRevision: 'row-7',
  durableActiveTranscriptDigest: digest('transcript'), hostCompactionEpoch: 3, attestorId: 'hermes-attestor',
  providerManagedHistoryCapability: 'visible' as const, hostTranscriptAttested: true, compactionEnabled: false,
};
const request = (overrides: Partial<GatewayProjectionRequest> = {}): GatewayProjectionRequest => ({
  schemaVersion: 'ace.gateway.v1', requestId: 'request-1', attemptGroupId: 'attempt-group-1', agentSessionId: 'session-1',
  workspaceId: 'workspace-1', dataClass: 'private', protocol: 'openai.chat.completions', provider: 'mock', model: 'test-model',
  bodyBase64, bodySha256: sha256Base64(bodyBase64), query: 'find handler', projectionMode: 'gateway', deadlineEpochMs: Date.now() + 30_000,
  attestation, ...overrides,
});
const transformed: AceTransformResult = {
  schemaVersion: 1, requestId: 'request-1', sessionId: 'session-1', turnId: 'attempt-group-1', workspaceId: 'workspace-1' as never,
  status: 'ready', contextText: 'verified handler context', evidence: [], selectedEvidenceIds: ['ev-1'], omittedEvidenceIds: [],
  estimatedTokens: 4, tokenCountMode: 'host_counter', providerIdentities: {}, receiptId: 'receipt-1', providerRequestId: 'provider-1', limitations: [],
};
const context: ContextTransformService = { transform: () => Effect.succeed(ok(transformed)) };
const verifiedHostBudget: GatewayHostModelBudgetPort = {
  resolve: (value) => ({ provider: value.provider, model: value.model, remainingInputTokens: 128 }),
};

test('gateway request validation binds exact original bytes and rejects malformed bounds', () => {
  assert.equal(validateGatewayProjectionRequest(request())._tag, 'Ok');
  assert.equal(validateGatewayProjectionRequest({ ...request(), bodySha256: digest('wrong') })._tag, 'Err');
  const binary = Buffer.from([0xff, 0x00, 0xfe, 0x80]);
  const binaryBase64 = binary.toString('base64');
  assert.equal(sha256Base64(binaryBase64), createHash('sha256').update(binary).digest('hex'));
  assert.equal(validateGatewayProjectionRequest({
    ...request(), bodyBase64: binaryBase64, bodySha256: sha256Base64(binaryBase64),
  })._tag, 'Ok');
  assert.equal(validateGatewayProjectionRequest({ ...request(), bodyBase64: 'AAAA'.repeat(1_400_000) })._tag, 'Err');
  assert.equal(validateGatewayProjectionRequest({ ...request(), attestation: { ...attestation, hostCompactionEpoch: -1 } })._tag, 'Err');
  assert.equal(validateGatewayProjectionRequest({ ...request(), requestedEvidenceIds: ['same', 'same'] })._tag, 'Err');
  for (const invalid of [
    { ...request(), unrecognized: true },
    { ...request(), dataClass: ['private'] },
    { ...request(), projectionMode: ['gateway'] },
    { ...request(), attestation: { ...attestation, unrecognized: true } },
    { ...request(), attestation: { ...attestation, providerManagedHistoryCapability: ['visible'] } },
  ]) {
    assert.equal(validateGatewayProjectionRequest(invalid)._tag, 'Err');
  }
});

test('gateway rejects malformed UTF-8 rather than silently replacing original bytes', async () => {
  const invalidUtf8 = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
  const badBase64 = invalidUtf8.toString('base64');
  const response = await Effect.runPromise(makeGatewayProjectionService(context, verifiedHostBudget).project(request({
    bodyBase64: badBase64,
    bodySha256: sha256Base64(badBase64),
  })));
  assert.equal(response._tag, 'Err');
});

test('gateway applies request-local context and preserves unknown provider fields', async () => {
  const decision = await Effect.runPromise(makeGatewayProjectionService(context, verifiedHostBudget).project(request()));
  assert.equal(decision._tag, 'Ok');
  if (decision._tag === 'Err' || decision.value.kind !== 'APPLY') return;
  const projected = JSON.parse(Buffer.from(decision.value.bodyBase64, 'base64').toString('utf8')) as typeof body;
  assert.equal(projected.unknown.keep, true);
  assert.equal(projected.messages[0]?.content, 'policy');
  assert.match(String(projected.messages[1]?.content), /ACE verified context/u);
  assert.equal(decision.value.receipt.baseBodySha256, request().bodySha256);
  assert.equal(decision.value.receipt.decision, 'APPLY');
});

test('gateway blocks hidden provider state and active or unknown host compaction', async () => {
  const service = makeGatewayProjectionService(context, verifiedHostBudget);
  for (const override of [
    { attestation: { ...attestation, providerManagedHistoryCapability: 'unknown' as const } },
    { attestation: { ...attestation, compactionEnabled: true } },
    { attestation: { ...attestation, hostCompactionEpoch: 'unknown' as const } },
  ]) {
    const decision = await Effect.runPromise(service.project(request(override)));
    assert.equal(decision._tag, 'Ok');
    if (decision._tag === 'Ok') assert.equal(decision.value.kind, 'BLOCK');
  }
});

test('gateway never treats context failure as unchanged success', async () => {
  const failing: ContextTransformService = { transform: () => Effect.succeed(err(domainError('NOT_READY', 'context', 'provider unavailable'))) };
  const decision = await Effect.runPromise(makeGatewayProjectionService(failing, verifiedHostBudget).project(request()));
  assert.equal(decision._tag, 'Ok');
  if (decision._tag === 'Ok') {
    assert.equal(decision.value.kind, 'BLOCK');
    assert.equal(decision.value.receipt.reasonCode, 'NOT_READY');
  }
});

test('gateway never invents a model token budget from deadline time', async () => {
  let called = false;
  const collecting: ContextTransformService = { transform: () => {
    called = true;
    return Effect.succeed(ok(transformed));
  } };
  const missing = await Effect.runPromise(makeGatewayProjectionService(collecting).project(request()));
  assert.equal(missing._tag, 'Ok');
  if (missing._tag === 'Ok') {
    assert.equal(missing.value.kind, 'BLOCK');
    assert.equal(missing.value.receipt.reasonCode, 'MODEL_TOKEN_BUDGET_UNVERIFIED');
  }
  assert.equal(called, false);

  for (const supplied of [
    { provider: 'other', model: 'test-model', remainingInputTokens: 128 },
    { provider: 'mock', model: 'other-model', remainingInputTokens: 128 },
    { provider: 'mock', model: 'test-model', remainingInputTokens: 0 },
    { provider: 'mock', model: 'test-model', remainingInputTokens: Number.NaN },
    { provider: 'mock', model: 'test-model', remainingInputTokens: 1.5 },
  ]) {
    const decision = await Effect.runPromise(makeGatewayProjectionService(collecting, {
      resolve: () => supplied,
    }).project(request()));
    assert.equal(decision._tag, 'Ok');
    if (decision._tag === 'Ok') assert.equal(decision.value.receipt.reasonCode, 'MODEL_TOKEN_BUDGET_UNVERIFIED');
  }
  assert.equal(called, false);
});

test('Gateway trusts only host-counter mode and checked budget evidence', async () => {
  for (const invalidResult of [
    { ...transformed, tokenCountMode: 'character_estimate' as const },
    { ...transformed, estimatedTokens: 129 },
    { ...transformed, estimatedTokens: -1 },
  ]) {
    const unverified: ContextTransformService = { transform: () => Effect.succeed(ok(invalidResult)) };
    const response = await Effect.runPromise(makeGatewayProjectionService(unverified, verifiedHostBudget).project(request()));
    assert.equal(response._tag, 'Ok');
    if (response._tag === 'Ok') {
      assert.equal(response.value.kind, 'BLOCK');
      assert.equal(response.value.receipt.reasonCode, 'MODEL_TOKEN_COUNT_UNVERIFIED');
    }
  }
});

test('gateway uses the host-approved budget rather than time to deadline', async () => {
  let forwardedBudget: number | undefined;
  const verifying: ContextTransformService = { transform: (input) => {
    forwardedBudget = input.budgetTokens;
    return Effect.succeed(ok(transformed));
  } };
  const decision = await Effect.runPromise(makeGatewayProjectionService(verifying, verifiedHostBudget).project(request()));
  assert.equal(decision._tag, 'Ok');
  assert.equal(forwardedBudget, 128);
  if (decision._tag === 'Ok') assert.equal(decision.value.kind, 'APPLY');
});

test('non-gateway modes are explicit and do not claim ACE projection', async () => {
  const decision = await Effect.runPromise(makeGatewayProjectionService(context, verifiedHostBudget).project(request({ projectionMode: 'assist-only' })));
  assert.equal(decision._tag, 'Ok');
  if (decision._tag === 'Ok') assert.equal(decision.value.kind, 'UNCHANGED_AUTHORIZED');
});

test('gateway blocks simultaneous native projection ownership', async () => {
  const decision = await Effect.runPromise(makeGatewayProjectionService(context, verifiedHostBudget).project(request({ nativeProjectionActive: true })));
  assert.equal(decision._tag, 'Ok');
  if (decision._tag === 'Ok') {
    assert.equal(decision.value.kind, 'BLOCK');
    assert.equal(decision.value.receipt.reasonCode, 'DUAL_PROJECTION_OWNER');
  }
});

test('gateway rejects mismatched host session and unverified transform results', async () => {
  const gateway = makeGatewayProjectionService(context, verifiedHostBudget);
  const wrongSession = await Effect.runPromise(gateway.project(request({
    attestation: { ...attestation, sessionId: 'other-session' },
  })));
  assert.equal(wrongSession._tag, 'Ok');
  if (wrongSession._tag === 'Ok') {
    assert.equal(wrongSession.value.kind, 'BLOCK');
    assert.equal(wrongSession.value.receipt.reasonCode, 'HOST_SESSION_MISMATCH');
  }
  for (const result of [
    { ...transformed, sessionId: 'different-session' },
    { ...transformed, status: 'partial' as const },
    { ...transformed, selectedEvidenceIds: [] },
  ]) {
    const invalidContext: ContextTransformService = { transform: () => Effect.succeed(ok(result)) };
    const response = await Effect.runPromise(makeGatewayProjectionService(invalidContext, verifiedHostBudget).project(request()));
    assert.equal(response._tag, 'Ok');
    if (response._tag === 'Ok') {
      assert.equal(response.value.kind, 'BLOCK');
      assert.notEqual(response.value.receipt.reasonCode, undefined);
    }
  }
});
