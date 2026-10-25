import { createHash, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  type GatewayProjectionDecision,
  type GatewayProjectionRequest,
  type GatewayProjectionReceipt,
  validateGatewayProjectionRequest,
} from '../domain/gateway-projection.js';
import type { AceTransformResult, ContextTransformService } from './context-transform-service.js';

export interface GatewayProjectionService {
  readonly project: (value: unknown) => Effect.Effect<Result<GatewayProjectionDecision, DomainError>>;
}

const bodySha256 = (value: string): string => createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex');
const receiptFor = (request: GatewayProjectionRequest, decision: GatewayProjectionReceipt['decision'], extra: Partial<GatewayProjectionReceipt> = {}): GatewayProjectionReceipt => ({
  schemaVersion: 'ace.gateway.v1',
  requestId: request.requestId,
  attemptGroupId: request.attemptGroupId,
  attemptIndex: 0,
  receiptId: `gateway-receipt-${request.requestId}`,
  decision,
  baseBodySha256: request.bodySha256,
  hostCompactionEpoch: request.attestation.hostCompactionEpoch,
  activeEngineId: request.attestation.activeEngineId,
  permittedWireRewrites: [],
  ...extra,
});

const block = (request: GatewayProjectionRequest, reasonCode: string): Result<GatewayProjectionDecision, DomainError> =>
  ok({ kind: 'BLOCK', receipt: receiptFor(request, 'BLOCK', { reasonCode }) });

const parseBody = (request: GatewayProjectionRequest): Result<Record<string, unknown>, DomainError> => {
  try {
    const value = JSON.parse(Buffer.from(request.bodyBase64, 'base64').toString('utf8')) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return err(domainError('INVALID_INPUT', 'body', 'provider body must be a JSON object'));
    return ok(value as Record<string, unknown>);
  } catch {
    return err(domainError('INVALID_INPUT', 'body', 'provider body is not valid UTF-8 JSON'));
  }
};

const appendContext = (body: Record<string, unknown>, context: AceTransformResult): Result<string, DomainError> => {
  if (!Array.isArray(body.messages)) return err(domainError('PROTECTED_GROUP_INVALID', 'body.messages', 'OpenAI Chat request must contain messages'));
  const messages = body.messages as unknown[];
  if (messages.some((message) => typeof message !== 'object' || message === null || Array.isArray(message))) {
    return err(domainError('PROTECTED_GROUP_INVALID', 'body.messages', 'messages must remain objects'));
  }
  const contextMessage = { role: 'system', content: `[ACE verified context]\n${context.contextText}\n[/ACE verified context]` };
  const firstNonSystem = messages.findIndex((message) => (message as Record<string, unknown>).role !== 'system');
  const insertAt = firstNonSystem < 0 ? messages.length : firstNonSystem;
  const projected = { ...body, messages: [...messages.slice(0, insertAt), contextMessage, ...messages.slice(insertAt)] };
  return ok(Buffer.from(JSON.stringify(projected), 'utf8').toString('base64'));
};

const transformRequestFor = (request: GatewayProjectionRequest): Parameters<ContextTransformService['transform']>[0] => ({
  schemaVersion: 1,
  requestId: request.requestId,
  sessionId: request.agentSessionId,
  turnId: request.attemptGroupId,
  workspaceId: request.workspaceId,
  query: request.query,
  budgetTokens: Math.max(1, Math.floor((request.deadlineEpochMs - Date.now()) / 10)),
  sourceObligations: { required: ['code'] },
});

export const makeGatewayProjectionService = (context: ContextTransformService): GatewayProjectionService => ({
  project: (value) => Effect.gen(function* () {
    const decoded = validateGatewayProjectionRequest(value);
    if (decoded._tag === 'Err') return decoded;
    const request = decoded.value;
    if (request.projectionMode !== 'gateway') {
      return ok({ kind: 'UNCHANGED_AUTHORIZED', receipt: receiptFor(request, 'UNCHANGED_AUTHORIZED') });
    }
    if (request.nativeProjectionActive === true) return block(request, 'DUAL_PROJECTION_OWNER');
    if (request.deadlineEpochMs <= Date.now()) return block(request, 'DEADLINE_EXCEEDED');
    if (!request.attestation.hostTranscriptAttested) return block(request, 'HOST_CONTEXT_UNATTESTED');
    if (request.attestation.compactionEnabled || request.attestation.hostCompactionEpoch === 'unknown') return block(request, 'HOST_COMPACTION_ACTIVE');
    if (request.attestation.providerManagedHistoryCapability !== 'visible') return block(request, 'PROVIDER_MANAGED_STATE_UNKNOWN');
    const body = parseBody(request);
    if (body._tag === 'Err') return body;
    const transformed = yield* context.transform(transformRequestFor(request));
    if (transformed._tag === 'Err') return block(request, transformed.error.code);
    const projected = appendContext(body.value, transformed.value);
    if (projected._tag === 'Err') return block(request, projected.error.code);
    const projectedBodySha256 = bodySha256(projected.value);
    return ok({
      kind: 'APPLY',
      bodyBase64: projected.value,
      receipt: receiptFor(request, 'APPLY', {
        projectionId: `gateway-projection-${randomUUID()}`,
        projectedBodySha256,
        permittedWireRewrites: ['append_verified_context_system_message'],
      }),
    });
  }),
});
