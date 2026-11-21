import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { makeGatewayAttemptAuthorizationService } from '../src/application/gateway-attempt-authorization-service.js';
import { validateNativeResponsesStreamingRoutes } from '../src/application/gateway-security-contract.js';
import { makeResponsesProjectionService } from '../src/application/responses-projection-service.js';
import { verifyProjectionReceipt } from '../src/application/projection-receipt.js';
import { handleContextRpcHttp, createContextRpcServer } from '../src/transport/context-rpc-http.js';
import { makeContextTransformService, type ContextTransformService, type AceTransformResult } from '../src/application/context-transform-service.js';
import type { ResponsesProjectionRequest } from '../src/domain/responses-projection.js';
import { defaultLocalPolicy } from '../src/domain/policy.js';
import type { DataClass, ProjectDataPolicy, SafeAuditRecord } from '../src/domain/policy.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import type { WorkspaceRecord } from '../src/domain/workspace.js';
import type { ContextBundle } from '../src/domain/retrieval.js';
import { resolveExplicitSourceRequirements } from '../src/domain/source-coverage.js';
import { domainError } from '../src/domain/errors.js';
import { err, ok } from '../src/domain/result.js';
import type { GatewayProjectionSecurity } from '../src/application/gateway-security-contract.js';

const sourcePlan = resolveExplicitSourceRequirements({ required: ['code'] });
if (sourcePlan._tag === 'Err') throw new Error(sourcePlan.error.message);
const hash = (x: string): string => createHash('sha256').update(x).digest('hex');
const subscriptionResponsesUrl = 'https://chatgpt.com/backend-api/codex/responses';
const encodeBase64Utf8 = (value: string): string => {
  let binary = '';
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const decodeBase64Utf8 = (value: string): string => {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
};
const native = {
  model: 'openai/gpt-test', stream: true, store: false,
  reasoning: { effort: 'medium' },
  tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object' } }],
  input: [
    { role: 'user', content: [{ type: 'input_text', text: 'find entrypoint' }] },
    { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call-1', output: 'entrypoint here' },
  ],
};
const req = (override: Partial<ResponsesProjectionRequest> = {}, bodyValue: unknown = native): ResponsesProjectionRequest => {
  const bodyText = JSON.stringify(bodyValue);
  const bodyBase64 = encodeBase64Utf8(bodyText);
  return {
    schemaVersion: 'ace.context.v3', protocol: 'openai.responses',
    requestId: 'r1', attemptGroupId: 'g1', agentSessionId: 's1',
    workspaceId: 'ws1', dataClass: 'private', provider: 'openai', model: native.model,
    bodyBase64, bodySha256: hash(bodyText),
    query: 'entrypoint here', projectionMode: 'bifrost_hook', deadlineEpochMs: Date.now() + 30000,
    attestation: {
      hostBuildDigest: hash('host'), sessionId: 's1', activeEngineId: 'bifrost-visible-request-only',
      effectiveCompressionControlsDigest: hash('controls'),
      durableActiveTranscriptRevision: 'unattested', durableActiveTranscriptDigest: hash('input'),
      hostCompactionEpoch: 'unknown', attestorId: 'ace-bifrost',
      providerManagedHistoryCapability: 'unknown', hostTranscriptAttested: false, compactionEnabled: false,
    },
    ...override,
  };
};
const example: AceTransformResult = {
  schemaVersion: 1, requestId: 'r1', sessionId: 's1', turnId: 'g1',
  workspaceId: 'ws1' as never, status: 'ready',
  contextText: 'src/main.ts:20 confirmed', evidence: [],
  selectedEvidenceIds: ['ev1'], omittedEvidenceIds: [], estimatedTokens: 5,
  tokenCountMode: 'character_estimate', providerIdentities: {},
  receiptId: 'r', providerRequestId: 'p',
  limitations: ['character token estimate only'],
};
interface MakeOptions {
  readonly result?: Partial<AceTransformResult>;
  readonly deny?: boolean;
  readonly allowedProviders?: readonly string[];
  readonly allowedModelsByProvider?: Readonly<Record<string, readonly string[]>>;
  readonly allowedDataClasses?: readonly Exclude<DataClass, 'secret'>[];
  readonly allowedDestinations?: readonly string[];
  readonly allowedStreamingRoutes?: GatewayProjectionSecurity['allowedStreamingRoutes'];
  readonly context?: ContextTransformService;
  readonly audit?: GatewayProjectionSecurity['audit'];
}
const makeSecurity = (options: MakeOptions = {}): GatewayProjectionSecurity => {
  const workspace = makeWorkspaceId('ws1');
  if (workspace._tag === 'Err') throw Error(workspace.error.message);
  const policy: ProjectDataPolicy = {
    ...defaultLocalPolicy(workspace.value), cloudOptIn: options.deny !== true,
    allowedCloudProviders: ['other_external'],
    allowedCloudDataClassesByProvider: { other_external: options.allowedDataClasses ?? ['private_source'] },
  };
  return {
    policy,
    allowedProviders: options.allowedProviders ?? ['openai'],
    allowedModelsByProvider: options.allowedModelsByProvider ?? { openai: [native.model] },
    allowedDestinations: options.allowedDestinations ?? [subscriptionResponsesUrl],
    allowedStreamingRoutes: options.allowedStreamingRoutes ?? [],
    receiptSigningKey: 'test-projection-receipt-secret',
    clock: { nowMs: () => Date.now() },
    audit: options.audit ?? { append: () => Effect.succeed(ok(undefined)) },
  };
};
const make = (options: MakeOptions = {}) => {
  const context = options.context ?? { transform: () => Effect.succeed(ok({ ...example, ...(options.result ?? {}) })) };
  return makeResponsesProjectionService(context, makeSecurity(options));
};
test('native policy/Effect produces additive context without mutating function/reasoning/tool items', async () => {
  const response = await Effect.runPromise(make().projectResponses(req()));
  assert.equal(response._tag, 'Ok');if (response._tag === 'Err') return;
  assert.equal(response.value.kind, 'PREPARED');
  if (response.value.kind !== 'PREPARED') return;
  const decoded = JSON.parse(decodeBase64Utf8(response.value.bodyBase64)) as {
    input: unknown[]; tools: unknown; reasoning: unknown; stream: boolean; store: boolean;
  };
  assert.deepEqual(decoded.input.slice(1), native.input);
  assert.deepEqual(decoded.tools, native.tools);
  assert.deepEqual(decoded.reasoning, native.reasoning);
  assert.equal(decoded.stream, true);
  assert.equal(decoded.store, false);
  assert.equal(response.value.baseBodySha256, req().bodySha256);
  const receipt = verifyProjectionReceipt(response.value.projectionReceipt, 'test-projection-receipt-secret', Date.now());
  assert.equal(receipt._tag, 'Ok');
  if (receipt._tag === 'Ok') assert.equal(receipt.value.projectedBodySha256, response.value.projectedBodySha256);
});

test('AR02 Native Responses blocks a ready transform that includes unrequested RepoMap evidence', async () => {
  const context: ContextTransformService = {
    transform: () => Effect.succeed(ok({
      ...example,
      evidence: [{
        evidenceId: 'unverified-map' as never,
        source: 'structural',
        citation: 'repo-map:stale',
        content: 'SENSITIVE_STALE_MAP_TEXT',
        proofClass: 'derived',
        freshness: 'unknown',
      }],
    })),
  };
  const response = await Effect.runPromise(make({ context }).projectResponses(req()));
  assert.equal(response._tag, 'Ok');
  if (response._tag === 'Ok') {
    assert.equal(response.value.kind, 'BLOCK');
    if (response.value.kind === 'BLOCK') {
      assert.equal(response.value.reasonCode, 'UNREQUESTED_SOURCE_EVIDENCE');
    }
  }
});

test('physical-send authorization binds each attempt, consumes IDs once, and fails closed after restart', async () => {
  const requestId = 'ace-' + 'a'.repeat(32);
  const projectionRequest = req({ requestId, attemptGroupId: requestId }, { ...native, stream: false });
  const auditRecords: SafeAuditRecord[] = [];
  const security = makeSecurity({
    allowedDataClasses: ['private_source', 'private_conversation'],
    audit: { append: (record) => {
      auditRecords.push(record);
      return Effect.succeed(ok(undefined));
    } },
  });
  const context: ContextTransformService = {
    transform: () => Effect.succeed(ok({ ...example, requestId, turnId: requestId })),
  };
  const projection = await Effect.runPromise(makeResponsesProjectionService(context, security).projectResponses(projectionRequest));
  assert.equal(projection._tag, 'Ok');
  if (projection._tag === 'Err' || projection.value.kind !== 'PREPARED') return;
  const attempt = (
    attemptId: string,
    destination = subscriptionResponsesUrl,
    provider = 'openai',
    model = native.model,
  ) => ({
    schemaVersion: 'ace.context.v3', requestId, attemptGroupId: requestId,
    agentSessionId: 's1', workspaceId: 'ws1', dataClass: 'private',
    provider, model, attemptId, method: 'POST', destination,
    bodyBase64: projection.value.kind === 'PREPARED' ? projection.value.bodyBase64 : '',
    bodySha256: projection.value.kind === 'PREPARED' ? projection.value.projectedBodySha256 : '',
    preparedBodySha256: projection.value.kind === 'PREPARED' ? projection.value.projectedBodySha256 : '',
    projectionReceipt: projection.value.kind === 'PREPARED' ? projection.value.projectionReceipt : '',
    deadlineEpochMs: projectionRequest.deadlineEpochMs,
  });
  const authorization = makeGatewayAttemptAuthorizationService(security);
  const firstAttemptId = 'bf-attempt-' + 'b'.repeat(32);
  const first = await Effect.runPromise(authorization.authorizePhysicalSend(
    attempt(firstAttemptId),
  ));
  assert.equal(first._tag, 'Ok');
  if (first._tag === 'Err') return;
  assert.equal(first.value.kind, 'ALLOW');
  if (first.value.kind === 'ALLOW') {
    assert.equal(first.value.provider, 'openai');
    assert.equal(first.value.model, native.model);
    assert.equal(first.value.destination, subscriptionResponsesUrl);
    assert.equal(first.value.bodySha256, projection.value.projectedBodySha256);
  }
  const firstAudit = auditRecords.find((record) => record.correlationId === firstAttemptId);
  assert.equal(firstAudit?.outcome, 'allowed');
  assert.equal(firstAudit?.reasonCode, 'AUTHORIZED');
  assert.equal(firstAudit?.physicalSend?.workspaceId, 'ws1');
  assert.equal(firstAudit?.physicalSend?.bodySha256, projection.value.projectedBodySha256);
  assert.equal(firstAudit?.physicalSend?.preparedBodySha256, projection.value.projectedBodySha256);
  assert.equal(firstAudit?.physicalSend?.projectionReceiptSha256, hash(projection.value.projectionReceipt));
  assert.deepEqual(firstAudit?.physicalSend?.dataClasses, ['private_source', 'private_conversation']);
  // A failed audit write must not turn a policy-allowed attempt into a physical send.
  const auditFailureAuthorization = makeGatewayAttemptAuthorizationService({
    ...security,
    audit: { append: () => Effect.succeed(err(domainError('INVALID_INPUT', 'audit', 'simulated audit failure'))) },
  });
  const auditFailure = await Effect.runPromise(auditFailureAuthorization.authorizePhysicalSend(
    attempt('bf-attempt-' + 'a'.repeat(32)),
  ));
  assert.equal(auditFailure._tag, 'Err');
  assert.equal(firstAudit?.physicalSend?.destinationSha256, hash(subscriptionResponsesUrl));
  assert.equal(JSON.stringify(firstAudit).includes(subscriptionResponsesUrl), false);
  assert.equal(auditRecords.filter((record) => record.correlationId === firstAttemptId && record.outcome === 'allowed').length, 1);

  const sourceOnlySecurity: GatewayProjectionSecurity = {
    ...security,
    policy: {
      ...security.policy,
      allowedCloudDataClassesByProvider: { other_external: ['private_source'] },
    },
  };
  const sourceOnly = await Effect.runPromise(makeGatewayAttemptAuthorizationService(sourceOnlySecurity)
    .authorizePhysicalSend(attempt('bf-attempt-' + '4'.repeat(32))));
  assert.equal(sourceOnly._tag, 'Ok');
  if (sourceOnly._tag === 'Err') return;
  assert.equal(sourceOnly.value.kind, 'BLOCK');
  if (sourceOnly.value.kind === 'BLOCK') assert.equal(sourceOnly.value.reasonCode, 'DATA_CLASS_DENIED');

  const revisedPolicySecurity: GatewayProjectionSecurity = {
    ...security,
    policy: {
      ...security.policy,
      policyVersion: security.policy.policyVersion + 1,
    },
  };
  const stalePolicy = await Effect.runPromise(makeGatewayAttemptAuthorizationService(revisedPolicySecurity)
    .authorizePhysicalSend(attempt('bf-attempt-' + '6'.repeat(32))));
  assert.equal(stalePolicy._tag, 'Ok');
  if (stalePolicy._tag === 'Ok') {
    assert.equal(stalePolicy.value.kind, 'BLOCK');
    if (stalePolicy.value.kind === 'BLOCK') {
      assert.equal(stalePolicy.value.reasonCode, 'PROJECTION_POLICY_VERSION_MISMATCH');
    }
  }

  const restrictedModelSecurity: GatewayProjectionSecurity = {
    ...security,
    allowedModelsByProvider: { openai: ['openai/another-model'] },
  };
  const restrictedModel = await Effect.runPromise(makeGatewayAttemptAuthorizationService(restrictedModelSecurity)
    .authorizePhysicalSend(attempt('bf-attempt-' + '5'.repeat(32))));
  assert.equal(restrictedModel._tag, 'Ok');
  if (restrictedModel._tag === 'Err') return;
  assert.equal(restrictedModel.value.kind, 'BLOCK');
  if (restrictedModel.value.kind === 'BLOCK') assert.equal(restrictedModel.value.reasonCode, 'MODEL_NOT_ALLOWED');

  const replay = await Effect.runPromise(authorization.authorizePhysicalSend(
    attempt('bf-attempt-' + 'b'.repeat(32)),
  ));
  assert.equal(replay._tag, 'Ok');
  if (replay._tag === 'Ok') {
    assert.equal(replay.value.kind, 'BLOCK');
    if (replay.value.kind === 'BLOCK') assert.equal(replay.value.reasonCode, 'ATTEMPT_REPLAYED_OR_CAPACITY_EXHAUSTED');
  }

  const concurrentAuthorization = makeGatewayAttemptAuthorizationService(security);
  const concurrentAttempt = attempt('bf-attempt-' + 'e'.repeat(32));
  const concurrentResults = await Promise.all([
    Effect.runPromise(concurrentAuthorization.authorizePhysicalSend(concurrentAttempt)),
    Effect.runPromise(concurrentAuthorization.authorizePhysicalSend(concurrentAttempt)),
  ]);
  const concurrentKinds = concurrentResults.map((result) =>
    result._tag === 'Ok' ? result.value.kind : 'ERROR');
  assert.equal(concurrentKinds.filter((kind) => kind === 'ALLOW').length, 1);
  assert.equal(concurrentKinds.filter((kind) => kind === 'BLOCK').length, 1);
  const concurrentReasons = concurrentResults.map((result) =>
    result._tag === 'Ok' && result.value.kind === 'BLOCK' ? result.value.reasonCode : 'ERROR');
  assert.ok(concurrentKinds.includes('ALLOW'));
  assert.ok(concurrentReasons.includes('ATTEMPT_REPLAYED_OR_CAPACITY_EXHAUSTED'));

  const changedDestination = await Effect.runPromise(authorization.authorizePhysicalSend(
    attempt('bf-attempt-' + 'c'.repeat(32), 'https://unlisted.example/v1/responses'),
  ));
  assert.equal(changedDestination._tag, 'Ok');
  if (changedDestination._tag === 'Ok') {
    assert.equal(changedDestination.value.kind, 'BLOCK');
    if (changedDestination.value.kind === 'BLOCK') assert.equal(changedDestination.value.reasonCode, 'DESTINATION_NOT_ALLOWED');
  }
  // A valid subscription token is not permission to send to an API-key endpoint.
  // The only configured destination is the subscription Codex backend.
  const apiKeyEndpoint = await Effect.runPromise(authorization.authorizePhysicalSend(
    attempt('bf-attempt-' + 'd'.repeat(32), 'https://api.openai.com/v1/responses'),
  ));
  assert.equal(apiKeyEndpoint._tag, 'Ok');
  if (apiKeyEndpoint._tag === 'Ok' && apiKeyEndpoint.value.kind === 'BLOCK') {
    assert.equal(apiKeyEndpoint.value.reasonCode, 'DESTINATION_NOT_ALLOWED');
  }

  const spoofedSubscriptionHost = await Effect.runPromise(authorization.authorizePhysicalSend(
    attempt('bf-attempt-' + 'a'.repeat(32), 'https://untrusted.example/backend-api/codex/responses'),
  ));
  assert.equal(spoofedSubscriptionHost._tag, 'Err');

  const changedProviderModel = await Effect.runPromise(authorization.authorizePhysicalSend(
    attempt('bf-attempt-' + '9'.repeat(32), 'https://azure.example/v1/responses', 'azure', 'azure/different-model'),
  ));
  assert.equal(changedProviderModel._tag, 'Ok');
  if (changedProviderModel._tag === 'Ok' && changedProviderModel.value.kind === 'BLOCK') {
    assert.equal(changedProviderModel.value.reasonCode, 'ATTEMPT_BINDING_MISMATCH');
  }
  const fallbackAttemptId = 'bf-attempt-' + '9'.repeat(32);
  const fallbackAudit = auditRecords.find((record) => record.correlationId === fallbackAttemptId);
  assert.equal(fallbackAudit?.outcome, 'denied');
  assert.equal(fallbackAudit?.reasonCode, 'ATTEMPT_BINDING_MISMATCH');
  assert.equal(fallbackAudit?.physicalSend?.provider, 'azure');
  assert.equal(fallbackAudit?.physicalSend?.model, 'azure/different-model');

  const alternateAllowedDestinationSecurity: GatewayProjectionSecurity = {
    ...security,
    allowedDestinations: [subscriptionResponsesUrl, 'https://alternate.example/v1/responses'],
    policy: { ...security.policy, allowedCloudDataClassesByProvider: { other_external: [] } },
  };
  const changedDestinationDataClass = await Effect.runPromise(makeGatewayAttemptAuthorizationService(alternateAllowedDestinationSecurity)
    .authorizePhysicalSend(attempt('bf-attempt-' + '8'.repeat(32), 'https://alternate.example/v1/responses')));
  assert.equal(changedDestinationDataClass._tag, 'Ok');
  if (changedDestinationDataClass._tag === 'Ok' && changedDestinationDataClass.value.kind === 'BLOCK') {
    assert.equal(changedDestinationDataClass.value.reasonCode, 'DATA_CLASS_DENIED');
  }
  const alternateProtocol = await Effect.runPromise(authorization.authorizePhysicalSend(
    attempt('bf-attempt-' + '0'.repeat(32), 'https://api.openai.com/v1/chat/completions'),
  ));
  assert.equal(alternateProtocol._tag, 'Err');

  const mismatchedPreparedBody = attempt('bf-attempt-' + '1'.repeat(32));
  mismatchedPreparedBody.preparedBodySha256 = '0'.repeat(64);
  const mismatchedReceiptBinding = await Effect.runPromise(authorization.authorizePhysicalSend(mismatchedPreparedBody));
  assert.equal(mismatchedReceiptBinding._tag, 'Ok');
  if (mismatchedReceiptBinding._tag === 'Ok' && mismatchedReceiptBinding.value.kind === 'BLOCK') {
    assert.equal(mismatchedReceiptBinding.value.reasonCode, 'ATTEMPT_BINDING_MISMATCH');
  }

  const expiredAttempt = attempt('bf-attempt-' + '2'.repeat(32));
  expiredAttempt.deadlineEpochMs = Date.now() - 1;
  const expired = await Effect.runPromise(authorization.authorizePhysicalSend(expiredAttempt));
  assert.equal(expired._tag, 'Ok');
  if (expired._tag === 'Ok' && expired.value.kind === 'BLOCK') assert.equal(expired.value.reasonCode, 'DEADLINE_EXCEEDED');

  const alteredReceipt = attempt('bf-attempt-' + '3'.repeat(32));
  alteredReceipt.projectionReceipt += 'x';
  const invalidReceipt = await Effect.runPromise(authorization.authorizePhysicalSend(alteredReceipt));
  assert.equal(invalidReceipt._tag, 'Ok');
  if (invalidReceipt._tag === 'Ok' && invalidReceipt.value.kind === 'BLOCK') {
    assert.equal(invalidReceipt.value.reasonCode, 'PROJECTION_RECEIPT_INVALID');
  }

  const streamingRequest = req({ requestId, attemptGroupId: requestId }, native);
  const streamingProjection = await Effect.runPromise(
    makeResponsesProjectionService(context, security).projectResponses(streamingRequest),
  );
  assert.equal(streamingProjection._tag, 'Ok');
  if (streamingProjection._tag === 'Err' || streamingProjection.value.kind !== 'PREPARED') return;
  const streamingAttemptFor = (attemptId: string, destination = subscriptionResponsesUrl) => ({
    ...attempt(attemptId, destination),
    bodyBase64: streamingProjection.value.bodyBase64,
    bodySha256: streamingProjection.value.projectedBodySha256,
    preparedBodySha256: streamingProjection.value.projectedBodySha256,
    projectionReceipt: streamingProjection.value.projectionReceipt,
    deadlineEpochMs: streamingRequest.deadlineEpochMs,
  });
  const route = { provider: 'openai', model: native.model, destination: subscriptionResponsesUrl };
  assert.deepEqual(validateNativeResponsesStreamingRoutes([route]), [route]);
  assert.throws(
    () => validateNativeResponsesStreamingRoutes([
      { ...route, destination: 'https://untrusted.example/backend-api/codex/responses' },
    ]),
    /canonical credential-free HTTPS Responses URL/u,
  );
  const streamingAttemptId = 'bf-attempt-' + 'f'.repeat(32);
  const streaming = await Effect.runPromise(authorization.authorizePhysicalSend(streamingAttemptFor(streamingAttemptId)));
  assert.equal(streaming._tag, 'Ok');
  if (streaming._tag === 'Ok') {
    assert.equal(streaming.value.kind, 'BLOCK');
    if (streaming.value.kind === 'BLOCK') assert.equal(streaming.value.reasonCode, 'STREAMING_ROUTE_NOT_ALLOWED');
  }

  const streamingAuthorization = makeGatewayAttemptAuthorizationService({
    ...security, allowedStreamingRoutes: [route],
  });
  const enabledStream = await Effect.runPromise(streamingAuthorization.authorizePhysicalSend(
    streamingAttemptFor('bf-attempt-' + 'c'.repeat(32)),
  ));
  assert.equal(enabledStream._tag, 'Ok');
  if (enabledStream._tag === 'Err') return;
  assert.equal(enabledStream.value.kind, 'ALLOW');
  if (enabledStream.value.kind === 'ALLOW') {
    assert.equal(enabledStream.value.destination, subscriptionResponsesUrl);
  }

  const wrongStreamRoute = makeGatewayAttemptAuthorizationService({
    ...security,
    allowedStreamingRoutes: [{ ...route, destination: 'https://api.openai.com/v1/other' }],
  });
  const wrongStream = await Effect.runPromise(wrongStreamRoute.authorizePhysicalSend(
    streamingAttemptFor('bf-attempt-' + 'd'.repeat(32), subscriptionResponsesUrl),
  ));
  assert.equal(wrongStream._tag, 'Ok');
  if (wrongStream._tag === 'Ok' && wrongStream.value.kind === 'BLOCK') {
    assert.equal(wrongStream.value.reasonCode, 'STREAMING_ROUTE_NOT_ALLOWED');
  }

  const secretAttempt = attempt('bf-attempt-' + '7'.repeat(32));
  const secretBody = JSON.parse(decodeBase64Utf8(secretAttempt.bodyBase64)) as Record<string, unknown>;
  const secretInput = Array.isArray(secretBody.input) ? secretBody.input : [];
  secretBody.input = [...secretInput, { role: 'user', content: 'password: hunter2' }];
  const secretText = JSON.stringify(secretBody);
  secretAttempt.bodyBase64 = encodeBase64Utf8(secretText);
  secretAttempt.bodySha256 = hash(secretText);
  const secret = await Effect.runPromise(authorization.authorizePhysicalSend(secretAttempt));
  assert.equal(secret._tag, 'Ok');
  if (secret._tag === 'Ok' && secret.value.kind === 'BLOCK') assert.equal(secret.value.reasonCode, 'SECRET_DETECTED');

  const afterRestart = makeGatewayAttemptAuthorizationService({
    ...security, receiptSigningKey: 'new-process-ephemeral-key',
  });
  const staleReceipt = await Effect.runPromise(afterRestart.authorizePhysicalSend(
    attempt('bf-attempt-' + 'd'.repeat(32)),
  ));
  assert.equal(staleReceipt._tag, 'Ok');
  if (staleReceipt._tag === 'Ok') {
    assert.equal(staleReceipt.value.kind, 'BLOCK');
    if (staleReceipt.value.kind === 'BLOCK') assert.equal(staleReceipt.value.reasonCode, 'PROJECTION_RECEIPT_INVALID');
  }
});
test('no policy opt-in means BLOCK, not fallthrough', async () => {
  const response = await Effect.runPromise(make({ deny: true }).projectResponses(req()));
  assert.equal(response._tag, 'Ok');
  if (response._tag === 'Ok') assert.equal(response.value.kind, 'BLOCK');
});
test('identity mismatch or no retrieved evidence blocks transformation', async () => {
  for (const changed of [
    { requestId: 'wrong' }, { selectedEvidenceIds: [] }, { contextText: '' },
  ]) {
    const response = await Effect.runPromise(make({ result: changed }).projectResponses(req()));
    assert.equal(response._tag, 'Ok');
    if (response._tag === 'Ok') assert.equal(response.value.kind, 'BLOCK');
  }
});

test('verified empty context preserves native request byte-for-byte; incomplete remains blocked', async () => {
  const original = req();
  const empty = await Effect.runPromise(make({
    result: { contextText: '', selectedEvidenceIds: [], evidence: [], limitations: [] },
  }).projectResponses(original));
  assert.equal(empty._tag, 'Ok');
  if (empty._tag === 'Ok') {
    assert.equal(empty.value.kind, 'PREPARED');
    assert.equal(empty.value.reasonCode, 'VERIFIED_NO_CONTEXT_NEEDED');
    if (empty.value.kind === 'PREPARED') {
      assert.equal(empty.value.bodyBase64, original.bodyBase64);
      assert.equal(empty.value.projectedBodySha256, original.bodySha256);
      const receipt = verifyProjectionReceipt(empty.value.projectionReceipt, 'test-projection-receipt-secret', Date.now());
      assert.equal(receipt._tag, 'Ok', 'verified-empty still needs a signed physical-send binding');
      if (receipt._tag === 'Ok') {
        assert.equal(receipt.value.baseBodySha256, original.bodySha256);
        assert.equal(receipt.value.projectedBodySha256, original.bodySha256);
        assert.equal(receipt.value.evidenceIdsSha256, hash('[]'));
        assert.equal(receipt.value.contextTextSha256, hash(''));
      }
    }
  }
  for (const result of [
    { status: 'partial' as const, contextText: '', selectedEvidenceIds: [], limitations: [] },
    { contextText: '', selectedEvidenceIds: [], limitations: ['required code source is stale'] },
  ]) {
    const denied = await Effect.runPromise(make({ result }).projectResponses(original));
    assert.equal(denied._tag, 'Ok');
    if (denied._tag === 'Ok') assert.equal(denied.value.kind, 'BLOCK');
  }
});

test('incomplete source coverage and truncated context are distinct fail-closed Gateway reasons', async () => {
  const reasons = [
    ['REQUIRED_CODE_COVERAGE_INCOMPLETE', 'TRANSFORM_REQUIRED_CODE_COVERAGE_INCOMPLETE'],
    ['CONTEXT_BUDGET_TRUNCATED', 'TRANSFORM_CONTEXT_BUDGET_TRUNCATED'],
  ] as const;
  for (const [notReadyReason, expected] of reasons) {
    const response = await Effect.runPromise(make({
      result: {
        status: 'partial', notReadyReason,
        limitations: ['private/path/never-expose.ts: partial'],
      },
    }).projectResponses(req()));
    assert.equal(response._tag, 'Ok');
    if (response._tag !== 'Ok') continue;
    assert.equal(response.value.kind, 'BLOCK');
    assert.equal(response.value.reasonCode, expected);
    assert.equal(JSON.stringify(response.value).includes('private/path'), false);
  }
});

test('hidden provider state and active host compaction block before retrieval', async () => {
  let transforms = 0;
  const context: ContextTransformService = { transform: () => {
    transforms += 1;
    return Effect.succeed(ok(example));
  } };
  for (const attestation of [
    { ...req().attestation, providerManagedHistoryCapability: 'hidden' as const },
    { ...req().attestation, hostTranscriptAttested: true, providerManagedHistoryCapability: 'unknown' as const },
    { ...req().attestation, hostTranscriptAttested: true, compactionEnabled: true },
    { ...req().attestation, hostTranscriptAttested: true, hostCompactionEpoch: 'unknown' as const },
  ]) {
    const response = await Effect.runPromise(make({ context }).projectResponses(req({ attestation })));
    assert.equal(response._tag, 'Ok');
    if (response._tag === 'Ok') assert.equal(response.value.kind, 'BLOCK');
  }
  assert.equal(transforms, 0);
});

test('unattested but explicitly stateless native input may prepare context without fabricated provider history evidence', async () => {
  const response = await Effect.runPromise(make().projectResponses(req()));
  assert.equal(response._tag, 'Ok');
  if (response._tag === 'Ok') assert.equal(response.value.kind, 'PREPARED');
});

test('provider allowlist, cloud opt-in, and private-source policy deny before retrieval', async () => {
  let transforms = 0;
  const context: ContextTransformService = { transform: () => {
    transforms += 1;
    return Effect.succeed(ok(example));
  } };
  for (const service of [
    make({ context, allowedProviders: ['another-provider'] }),
    make({ context, allowedModelsByProvider: { openai: ['openai/another-model'] } }),
    make({ context, deny: true }),
    make({ context, allowedDataClasses: ['public'] }),
  ]) {
    const response = await Effect.runPromise(service.projectResponses(req()));
    assert.equal(response._tag, 'Ok');
    if (response._tag === 'Ok') assert.equal(response.value.kind, 'BLOCK');
  }
  assert.equal(transforms, 0);
});

test('secret material in the original request or selected evidence blocks projection', async () => {
  let transforms = 0;
  const context: ContextTransformService = { transform: () => {
    transforms += 1;
    return Effect.succeed(ok(example));
  } };
  const secretInput = {
    ...native,
    input: [{ role: 'user', content: 'deploy with api_key=abcd1234567890' }],
  };
  const originalSecret = await Effect.runPromise(make({ context }).projectResponses(
    req({ query: 'deploy with api_key=abcd1234567890' }, secretInput),
  ));
  assert.equal(originalSecret._tag, 'Ok');
  if (originalSecret._tag === 'Ok') assert.equal(originalSecret.value.kind, 'BLOCK');
  assert.equal(transforms, 0);

  const selectedSecret = await Effect.runPromise(make({
    result: { contextText: 'deployment api_key=abcd1234567890' },
  }).projectResponses(req()));
  assert.equal(selectedSecret._tag, 'Ok');
  if (selectedSecret._tag === 'Ok') assert.equal(selectedSecret.value.kind, 'BLOCK');
});

test('body/model/query mismatch and transform failure never become empty success', async () => {
  let transforms = 0;
  const context: ContextTransformService = { transform: () => {
    transforms += 1;
    return Effect.succeed(ok(example));
  } };
  for (const request of [req({ model: 'different-model' }), req({ query: 'unbound query' })]) {
    const response = await Effect.runPromise(make({ context }).projectResponses(request));
    assert.ok(response._tag === 'Err' || response.value.kind === 'BLOCK');
  }
  assert.equal(transforms, 0);

  const failing: ContextTransformService = {
    transform: () => Effect.succeed(err(domainError('NOT_READY', 'context', 'fixture unavailable'))),
  };
  const response = await Effect.runPromise(make({ context: failing }).projectResponses(req()));
  assert.equal(response._tag, 'Ok');
  if (response._tag === 'Ok') assert.equal(response.value.kind, 'BLOCK');
});

test('audit failure is explicit and blocks native projection', async () => {
  const audit: GatewayProjectionSecurity['audit'] = {
    append: () => Effect.succeed(err(domainError('AUDIT_FAILED', 'audit', 'fixture audit unavailable'))),
  };
  const response = await Effect.runPromise(make({ audit }).projectResponses(req()));
  assert.equal(response._tag, 'Err');
  if (response._tag === 'Err') assert.equal(response.error.code, 'AUDIT_FAILED');
});

test('native gateway HTTP endpoint requires auth and returns local preparation only', async () => {
  const service = make();
  const payload = JSON.stringify(req());
  const direct = await handleContextRpcHttp(service, 'POST', '/internal/ace-context/v3/project', payload);
  assert.equal(direct.statusCode, 200);
  assert.equal(direct.body.kind, 'PREPARED');
  const server = createContextRpcServer(service, { authToken: 'local-secret' });
  await new Promise<void>((done, reject) => { server.once('error', reject);server.listen(0, '127.0.0.1', done); });
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const url = 'http://127.0.0.1:' + addr.port + '/internal/ace-context/v3/project';
    const unauthenticated = await fetch(url, { method: 'POST', body: payload });
    assert.equal(unauthenticated.status, 401);
    const authorized = await fetch(url, {
      method: 'POST', headers: { Authorization: 'Bearer local-secret' }, body: payload,
    });
    assert.equal(authorized.status, 200);
    const decision = await authorized.json() as { kind: string };
    assert.equal(decision.kind, 'PREPARED');
  } finally {
    await new Promise<void>((done) => server.close(done));
  }
});

test('native projection forwards only visible input text to incremental receipt assembly', async () => {
  let seen: readonly string[] | undefined;
  const context: ContextTransformService = {
    transform: (args) => {
      seen = args.visibleNativeInputText;
      return Effect.succeed(ok(example));
    },
  };
  const response = await Effect.runPromise(make({ context }).projectResponses(req()));
  assert.equal(response._tag, 'Ok');
  if (response._tag === 'Ok') assert.equal(response.value.kind, 'PREPARED');
  assert.deepEqual(seen, ['find entrypoint', 'entrypoint here']);
});

test('completed empty retrieval and unavailable retrieval have different outcomes', async () => {
  const workspaceId = makeWorkspaceId('ws1');
  assert.equal(workspaceId._tag, 'Ok');
  if (workspaceId._tag === 'Err') return;
  const workspace: WorkspaceRecord = {
    workspaceId: workspaceId.value, rootPath: '/workspace',
    observationEpoch: 1, createdAtMs: 1,
  };
  const makeSearch = (complete: boolean, partialSources: string[] = [], proof = true) =>
    makeContextTransformService({
      ids: { newRequestId: () => 'search-generated-id' },
      store: { get: () => Effect.succeed(ok(workspace)) },
      context: { search: () => Effect.succeed(ok({
        requestId: 'search-empty' as ContextBundle['requestId'],
        query: 'summarize the task', evidence: [], warnings: [],
        partialSources, complete, sourcePlan: sourcePlan.value,
        ...(proof ? { sourceCoverage: [{
          source: 'code' as const, requirement: 'required' as const,
          status: complete ? 'satisfied' as const : 'unavailable' as const,
        }] } : {}),
      })) },
    });
  const body = { ...native, input: [{ role: 'user', content: 'summarize the task' }] };
  const request = req({ query: 'summarize the task' }, body);
  const success = await Effect.runPromise(make({ context: makeSearch(true) }).projectResponses(request));
  assert.equal(success._tag, 'Ok');
  if (success._tag === 'Ok') {
    assert.equal(success.value.kind, 'PREPARED');
    if (success.value.kind === 'PREPARED') assert.equal(success.value.bodyBase64, request.bodyBase64);
  }
  // A provider's complete:true flag is not itself a source-observation receipt.
  const unverified = await Effect.runPromise(make({
    context: makeSearch(true, [], false),
  }).projectResponses(request));
  assert.equal(unverified._tag, 'Ok');
  if (unverified._tag === 'Ok') assert.equal(unverified.value.kind, 'BLOCK');
  const unavailable = await Effect.runPromise(make({
    context: makeSearch(false, ['code']),
  }).projectResponses(request));
  assert.equal(unavailable._tag, 'Ok');
  if (unavailable._tag === 'Ok') assert.equal(unavailable.value.kind, 'BLOCK');
});

test('end-to-end native projection keeps Hermes input and sends only references for already-visible verified code', async () => {
  const code = 'export function locateEntry() {\n  return true;\n}';
  const workspaceId = makeWorkspaceId('ws1');
  if (workspaceId._tag === 'Err') throw Error('invalid workspace fixture');
  const workspace: WorkspaceRecord = {
    workspaceId: workspaceId.value,
    rootPath: '/workspace',
    observationEpoch: 1,
    createdAtMs: 1,
    lastObservation: {
      headRevision: 'a'.repeat(40), observationEpoch: 1,
      files: [], removedPaths: [], gitStatus: 'available',
    },
  };
  const providerResult: ContextBundle = {
    requestId: 'search-1' as ContextBundle['requestId'],
    query: code,
    evidence: [{
      evidenceId: 'evidence-code' as ContextBundle['evidence'][number]['evidenceId'],
      source: 'code', citation: 'src/entrypoint.ts:1-3', content: code,
      sourceDigest: 'b'.repeat(64) as never,
      proofClass: 'direct', freshness: 'current',
    }],
    warnings: [], partialSources: [], complete: true, sourcePlan: sourcePlan.value,
  };
  let searches = 0;
  const context = makeContextTransformService({
    ids: { newRequestId: () => 'search-generated-id' },
    store: { get: () => Effect.succeed(ok(workspace)) },
    context: { search: () => {
      searches += 1;
      return Effect.succeed(ok(providerResult));
    } },
  });
  const nativeWithCode = {
    ...native,
    input: [
      native.input[0],
      native.input[1],
      { type: 'function_call_output', call_id: 'call-1', output: code },
    ],
  };
  const prior = req({ query: code }, nativeWithCode);
  const decision = await Effect.runPromise(make({ context }).projectResponses(prior));
  assert.equal(decision._tag, 'Ok');
  if (decision._tag === 'Err') return;
  assert.equal(decision.value.kind, 'PREPARED', 'all-known evidence must not BLOCK normal Hermes progression');
  if (decision.value.kind !== 'PREPARED') return;
  const parsed = JSON.parse(Buffer.from(decision.value.bodyBase64, 'base64').toString('utf8')) as {
    input: { role?: string; content?: string }[];
    reasoning: unknown; tools: unknown; store: boolean;
  };
  assert.equal(parsed.input.length, nativeWithCode.input.length + 1);
  assert.deepEqual(parsed.input.slice(1), nativeWithCode.input);
  assert.match(parsed.input[0]?.content ?? '', /src\/entrypoint\.ts:1-3/u);
  assert.match(parsed.input[0]?.content ?? '', /known source body/u);
  assert.ok(!(parsed.input[0]?.content ?? '').includes(code),
    'developer evidence item must not repeat the already-visible code body');
  assert.deepEqual(parsed.reasoning, native.reasoning);
  assert.deepEqual(parsed.tools, native.tools);
  assert.equal(parsed.store, false);
  assert.equal(searches, 1, 'native visibility check must not trigger a second retrieval');

  const unseen = await Effect.runPromise(make({ context }).projectResponses(req()));
  assert.equal(unseen._tag, 'Ok');
  if (unseen._tag === 'Ok' && unseen.value.kind === 'PREPARED') {
    const unchanged = JSON.parse(Buffer.from(unseen.value.bodyBase64, 'base64').toString('utf8')) as {
      input: { content?: string }[];
    };
    assert.match(unchanged.input[0]?.content ?? '', /export function locateEntry/u,
      'unseen source evidence must still be delivered exactly');
    assert.equal(searches, 2);
  } else {
    assert.fail('normal unseen evidence must prepare successfully');
  }
});

