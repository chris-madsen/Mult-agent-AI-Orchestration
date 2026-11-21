import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import type {
  PhysicalSendAttemptDecision as GeneratedPhysicalSendAttemptDecision,
  PhysicalSendAttemptRequest as GeneratedPhysicalSendAttemptRequest,
} from '../generated/ace-context/v3/types.gen.js';
import type { DomainError } from '../domain/errors.js';
import { authorizeOutbound, type DataClass, type SafePhysicalSendAuditDetails } from '../domain/policy.js';
import { containsLikelySecret } from '../domain/sensitive-text.js';
import { makeWorkspaceId } from '../domain/workspace.js';
import type { GatewayProjectionSecurity } from './gateway-security-contract.js';
import { isErr, type Result } from '../domain/result.js';
import {
  physicalSendAttemptAllowed,
  physicalSendAttemptBlocked,
  validatePhysicalSendAttemptRequest,
} from '../domain/gateway-attempt-authorization.js';
import { verifyProjectionReceipt } from './projection-receipt.js';

export interface GatewayAttemptAuthorizationService {
  readonly authorizePhysicalSend: (value: unknown) => Effect.Effect<Result<GeneratedPhysicalSendAttemptDecision, DomainError>>;
}

const sendBlock = (
  request: GeneratedPhysicalSendAttemptRequest,
  reasonCode: string,
  security: GatewayProjectionSecurity,
): Effect.Effect<Result<GeneratedPhysicalSendAttemptDecision, DomainError>> =>
  Effect.gen(function* () {
    const written = yield* security.audit.append({
      occurredAtMs: security.clock.nowMs(),
      correlationId: request.attemptId,
      component: 'gateway-physical-send',
      category: 'policy',
      policyVersion: security.policy.policyVersion,
      outcome: 'denied',
      reasonCode,
      physicalSend: attemptAuditDetails(request),
    });
    if (isErr(written)) return written;
    return physicalSendAttemptBlocked(request, reasonCode);
  });

const sendAllow = (
  request: GeneratedPhysicalSendAttemptRequest,
  security: GatewayProjectionSecurity,
): Effect.Effect<Result<GeneratedPhysicalSendAttemptDecision, DomainError>> =>
  Effect.gen(function* () {
    // The model provider validates subscription OAuth itself. ACE verifies
    // only this already-approved route, current policy and final request bytes;
    // credential-source introspection at every send is not an ACE capability.
    // Auditing must succeed before physical dispatch.
    const written = yield* security.audit.append({
      occurredAtMs: security.clock.nowMs(),
      correlationId: request.attemptId,
      component: 'gateway-physical-send',
      category: 'policy',
      policyVersion: security.policy.policyVersion,
      outcome: 'allowed',
      reasonCode: 'AUTHORIZED',
      physicalSend: attemptAuditDetails(request),
    });
    if (isErr(written)) return written;
    return physicalSendAttemptAllowed(request);
  });

const attemptAuditDetails = (
  request: GeneratedPhysicalSendAttemptRequest,
): SafePhysicalSendAuditDetails => ({
  attemptId: request.attemptId,
  requestId: request.requestId,
  workspaceId: request.workspaceId,
  provider: request.provider,
  model: request.model,
  method: request.method,
  destinationSha256: createHash('sha256').update(request.destination, 'utf8').digest('hex'),
  dataClasses: dataClassesFor(request.dataClass),
  bodySha256: request.bodySha256,
  preparedBodySha256: request.preparedBodySha256,
  projectionReceiptSha256: createHash('sha256').update(request.projectionReceipt, 'utf8').digest('hex'),
});

const dataClassesFor = (
  dataClass: GeneratedPhysicalSendAttemptRequest['dataClass'],
): readonly Exclude<DataClass, 'secret'>[] => {
  // The provider body carries both the agent's private conversation and ACE source context.
  const sourceClass: Exclude<DataClass, 'secret'> = dataClass === 'private' ? 'private_source' : dataClass;
  return sourceClass === 'private_source'
    ? [sourceClass, 'private_conversation']
    : [sourceClass, 'private_source', 'private_conversation'];
};

const makeSingleUseAttemptRegistry = (): ((attemptId: string, expiresAtMs: number, nowMs: number) => boolean) => {
  const consumed = new Map<string, number>();
  let operations = 0;
  return (attemptId, expiresAtMs, nowMs) => {
    operations += 1;
    if (operations % 64 === 0 || consumed.size >= 4096) {
      for (const [id, expiry] of consumed) if (expiry <= nowMs) consumed.delete(id);
    }
    if (consumed.has(attemptId) || consumed.size >= 4096) return false;
    consumed.set(attemptId, expiresAtMs);
    return true;
  };
};

export const makeGatewayAttemptAuthorizationService = (
  security: GatewayProjectionSecurity,
): GatewayAttemptAuthorizationService => {
  const claimAttempt = makeSingleUseAttemptRegistry();
  return {
    authorizePhysicalSend: (value) => Effect.gen(function* () {
      const valid = validatePhysicalSendAttemptRequest(value);
      if (valid._tag === 'Err') return valid;
      const request = valid.value;
      const now = security.clock.nowMs();
      if (request.deadlineEpochMs <= now) return yield* sendBlock(request, 'DEADLINE_EXCEEDED', security);

      const receipt = verifyProjectionReceipt(request.projectionReceipt, security.receiptSigningKey, now);
      if (receipt._tag === 'Err') return yield* sendBlock(request, 'PROJECTION_RECEIPT_INVALID', security);
      const claims = receipt.value;
      // A valid HMAC is not a perpetual policy permit. Reject receipts
      // minted before (or for a different version than) the policy currently
      // governing this physical send, even if its other bindings still match.
      if (claims.policyVersion !== security.policy.policyVersion) {
        return yield* sendBlock(request, 'PROJECTION_POLICY_VERSION_MISMATCH', security);
      }
      if (claims.requestId !== request.requestId
        || claims.attemptGroupId !== request.attemptGroupId
        || claims.agentSessionId !== request.agentSessionId
        || claims.workspaceId !== request.workspaceId
        || claims.dataClass !== (request.dataClass === 'private' ? 'private_source' : request.dataClass)
        || claims.provider !== request.provider.toLowerCase()
        || claims.model !== request.model
        || claims.projectedBodySha256 !== request.preparedBodySha256
        || claims.deadlineEpochMs !== request.deadlineEpochMs) {
        return yield* sendBlock(request, 'ATTEMPT_BINDING_MISMATCH', security);
      }
      if (!claimAttempt(request.attemptId, claims.deadlineEpochMs, now)) {
        return yield* sendBlock(request, 'ATTEMPT_REPLAYED_OR_CAPACITY_EXHAUSTED', security);
      }
      if (!security.allowedProviders.some((provider) => provider.toLowerCase() === request.provider.toLowerCase())) {
        return yield* sendBlock(request, 'PROVIDER_NOT_ALLOWED', security);
      }
      const modelProvider = request.provider.toLowerCase();
      const allowedModels = Object.prototype.hasOwnProperty.call(security.allowedModelsByProvider, modelProvider)
        ? security.allowedModelsByProvider[modelProvider] ?? []
        : [];
      if (!allowedModels.includes(request.model)) return yield* sendBlock(request, 'MODEL_NOT_ALLOWED', security);
      if (!security.allowedDestinations.includes(request.destination)) {
        return yield* sendBlock(request, 'DESTINATION_NOT_ALLOWED', security);
      }

      const bodyText = Buffer.from(request.bodyBase64, 'base64').toString('utf8');
      let body: unknown;
      try { body = JSON.parse(bodyText) as unknown; } catch {
        return yield* sendBlock(request, 'FINAL_BODY_INVALID', security);
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return yield* sendBlock(request, 'FINAL_BODY_NOT_CERTIFIED', security);
      }
      const finalBody = body as Record<string, unknown>;
      const streamValue = finalBody.stream;
      if (finalBody.model !== request.model || finalBody.store !== false
        || (streamValue !== undefined && typeof streamValue !== 'boolean')
        || ['previous_response_id', 'conversation', 'conversation_id', 'thread_id']
          .some((field) => finalBody[field] !== undefined)) {
        return yield* sendBlock(request, 'FINAL_BODY_NOT_CERTIFIED', security);
      }
      if (streamValue === true && !security.allowedStreamingRoutes.some((route) =>
        route.provider === request.provider.toLowerCase()
        && route.model === request.model
        && route.destination === request.destination)) {
        return yield* sendBlock(request, 'STREAMING_ROUTE_NOT_ALLOWED', security);
      }
      const secretDetected = containsLikelySecret(bodyText);
      const workspace = makeWorkspaceId(request.workspaceId);
      if (workspace._tag === 'Err') return workspace;
      const policyDecision = authorizeOutbound({
        workspaceId: workspace.value,
        operation: 'gateway_llm_physical_send',
        destination: 'other_external',
        dataClasses: dataClassesFor(request.dataClass),
        paths: [],
        secretDetected,
      }, security.policy);
      if (policyDecision._tag === 'Err') {
        return yield* sendBlock(request, 'POLICY_AUTHORIZATION_FAILED', security);
      }
      if (policyDecision.value.outcome === 'denied') {
        return yield* sendBlock(request, policyDecision.value.reasonCode, security);
      }
      return yield* sendAllow(request, security);
    }),
  };
};
