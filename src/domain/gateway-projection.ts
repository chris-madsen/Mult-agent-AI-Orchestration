import { createHash } from 'node:crypto';
import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type ProjectionMode = 'native' | 'gateway' | 'assist-only' | 'observe-only' | 'off';
export type GatewayDecisionKind = 'APPLY' | 'UNCHANGED_AUTHORIZED' | 'DEGRADED_AUTHORIZED' | 'BLOCK';
export type ProviderManagedHistoryCapability = 'visible' | 'hidden' | 'unknown';

export interface HostCompactionAttestation {
  readonly hostBuildDigest: string;
  readonly sessionId: string;
  readonly parentSessionId?: string;
  readonly activeEngineId: string;
  readonly effectiveCompressionControlsDigest: string;
  readonly durableActiveTranscriptRevision: string;
  readonly durableActiveTranscriptDigest: string;
  readonly hostCompactionEpoch: number | 'unknown';
  readonly attestorId: string;
  readonly providerManagedHistoryCapability: ProviderManagedHistoryCapability;
  readonly hostTranscriptAttested: boolean;
  readonly compactionEnabled: boolean;
}

export interface GatewayProjectionRequest {
  readonly schemaVersion: 'ace.gateway.v1';
  readonly requestId: string;
  readonly attemptGroupId: string;
  readonly agentSessionId: string;
  readonly workspaceId: string;
  readonly dataClass: 'private' | 'project_document' | 'public';
  readonly protocol: 'openai.chat.completions';
  readonly provider: string;
  readonly model: string;
  readonly bodyBase64: string;
  readonly bodySha256: string;
  readonly query: string;
  readonly projectionMode: ProjectionMode;
  readonly deadlineEpochMs: number;
  readonly attestation: HostCompactionAttestation;
  readonly nativeProjectionActive?: boolean;
  readonly requestedEvidenceIds?: readonly string[];
}

export interface GatewayProjectionReceipt {
  readonly schemaVersion: 'ace.gateway.v1';
  readonly requestId: string;
  readonly attemptGroupId: string;
  readonly attemptIndex: number;
  readonly projectionId?: string;
  readonly receiptId: string;
  readonly decision: GatewayDecisionKind;
  readonly reasonCode?: string;
  readonly baseBodySha256: string;
  readonly projectedBodySha256?: string;
  readonly hostCompactionEpoch: number | 'unknown';
  readonly activeEngineId: string;
  readonly permittedWireRewrites: readonly string[];
}

export type GatewayProjectionDecision =
  | { readonly kind: 'APPLY'; readonly bodyBase64: string; readonly receipt: GatewayProjectionReceipt }
  | { readonly kind: 'UNCHANGED_AUTHORIZED'; readonly receipt: GatewayProjectionReceipt }
  | { readonly kind: 'DEGRADED_AUTHORIZED'; readonly bodyBase64?: string; readonly receipt: GatewayProjectionReceipt }
  | { readonly kind: 'BLOCK'; readonly receipt: GatewayProjectionReceipt };

const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const safeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const maxBodyBytes = 4 * 1024 * 1024;
const maxBase64Length = 4 * Math.ceil(maxBodyBytes / 3);

export const sha256Base64 = (bodyBase64: string): string =>
  createHash('sha256').update(Buffer.from(bodyBase64, 'base64')).digest('hex');

export const validateHostCompactionAttestation = (
  value: unknown,
): Result<HostCompactionAttestation, DomainError> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err(domainError('INVALID_ATTESTATION', 'attestation', 'host attestation must be an object'));
  }
  const input = value as Record<string, unknown>;
  const requiredStrings = [
    'hostBuildDigest', 'sessionId', 'activeEngineId', 'effectiveCompressionControlsDigest',
    'durableActiveTranscriptRevision', 'durableActiveTranscriptDigest', 'attestorId',
  ];
  if (requiredStrings.some((key) => !nonEmpty(input[key]))) {
    return err(domainError('INVALID_ATTESTATION', 'attestation.identity', 'host attestation identity is incomplete'));
  }
  if (!digest(input.hostBuildDigest)
    || !digest(input.effectiveCompressionControlsDigest)
    || !digest(input.durableActiveTranscriptDigest)) {
    return err(domainError('INVALID_ATTESTATION', 'attestation.digest', 'host attestation digests must be SHA-256'));
  }
  if ((!safeInteger(input.hostCompactionEpoch) || (input.hostCompactionEpoch as number) < 0) && input.hostCompactionEpoch !== 'unknown') {
    return err(domainError('INVALID_ATTESTATION', 'attestation.hostCompactionEpoch', 'compaction epoch must be an integer or unknown'));
  }
  if (input.parentSessionId !== undefined && !nonEmpty(input.parentSessionId)) {
    return err(domainError('INVALID_ATTESTATION', 'attestation.parentSessionId', 'parent session must be a non-empty string'));
  }
  if (typeof input.hostTranscriptAttested !== 'boolean' || typeof input.compactionEnabled !== 'boolean') {
    return err(domainError('INVALID_ATTESTATION', 'attestation.flags', 'host attestation flags are required'));
  }
  if (!['visible', 'hidden', 'unknown'].includes(String(input.providerManagedHistoryCapability))) {
    return err(domainError('INVALID_ATTESTATION', 'attestation.providerManagedHistoryCapability', 'provider history capability is invalid'));
  }
  return ok(input as unknown as HostCompactionAttestation);
};

export const validateGatewayProjectionRequest = (
  value: unknown,
): Result<GatewayProjectionRequest, DomainError> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err(domainError('INVALID_INPUT', 'gateway_request', 'gateway request must be an object'));
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 'ace.gateway.v1') return err(domainError('INVALID_INPUT', 'schemaVersion', 'unsupported gateway schema version'));
  for (const field of ['requestId', 'attemptGroupId', 'agentSessionId', 'workspaceId', 'provider', 'model', 'bodyBase64', 'bodySha256', 'query'] as const) {
    if (!nonEmpty(input[field])) return err(domainError('INVALID_INPUT', field, `${field} must be non-empty`));
  }
  if (!['private', 'project_document', 'public'].includes(String(input.dataClass))) return err(domainError('INVALID_INPUT', 'dataClass', 'unsupported data class'));
  if (input.protocol !== 'openai.chat.completions') return err(domainError('UNSUPPORTED_PROTOCOL', 'protocol', 'only OpenAI Chat Completions is currently supported'));
  if (!['native', 'gateway', 'assist-only', 'observe-only', 'off'].includes(String(input.projectionMode))) return err(domainError('INVALID_INPUT', 'projectionMode', 'invalid projection mode'));
  if (input.nativeProjectionActive !== undefined && typeof input.nativeProjectionActive !== 'boolean') return err(domainError('INVALID_INPUT', 'nativeProjectionActive', 'nativeProjectionActive must be boolean'));
  if (!safeInteger(input.deadlineEpochMs) || input.deadlineEpochMs <= 0) return err(domainError('INVALID_INPUT', 'deadlineEpochMs', 'deadline must be a positive safe integer'));
  const bodyBase64 = input.bodyBase64 as string;
  if (bodyBase64.length > maxBase64Length) return err(domainError('INVALID_INPUT', 'bodyBase64', 'encoded body exceeds the 4 MiB gateway bound'));
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(bodyBase64)) return err(domainError('INVALID_INPUT', 'bodyBase64', 'body must use canonical base64'));
  const bodyBytes = Buffer.from(bodyBase64, 'base64');
  if (bodyBytes.length > maxBodyBytes) return err(domainError('INVALID_INPUT', 'bodyBase64', 'body exceeds the 4 MiB gateway bound'));
  if (bodyBytes.toString('base64') !== bodyBase64) return err(domainError('INVALID_INPUT', 'bodyBase64', 'body base64 is not canonical'));
  if (!digest(input.bodySha256) || sha256Base64(bodyBase64) !== input.bodySha256) return err(domainError('DIGEST_MISMATCH', 'bodySha256', 'body digest does not match the supplied bytes'));
  if (input.requestedEvidenceIds !== undefined && (!Array.isArray(input.requestedEvidenceIds)
    || !input.requestedEvidenceIds.every(nonEmpty)
    || new Set(input.requestedEvidenceIds).size !== input.requestedEvidenceIds.length)) {
    return err(domainError('INVALID_INPUT', 'requestedEvidenceIds', 'evidence IDs must be unique non-empty strings'));
  }
  const attestation = validateHostCompactionAttestation(input.attestation);
  if (attestation._tag === 'Err') return attestation;
  return ok({
    schemaVersion: 'ace.gateway.v1',
    requestId: input.requestId as string,
    attemptGroupId: input.attemptGroupId as string,
    agentSessionId: input.agentSessionId as string,
    workspaceId: input.workspaceId as string,
    dataClass: input.dataClass as GatewayProjectionRequest['dataClass'],
    protocol: 'openai.chat.completions',
    provider: input.provider as string,
    model: input.model as string,
    bodyBase64: input.bodyBase64 as string,
    bodySha256: input.bodySha256 as string,
    query: input.query as string,
    projectionMode: input.projectionMode as ProjectionMode,
    deadlineEpochMs: input.deadlineEpochMs,
    attestation: attestation.value,
    ...(input.nativeProjectionActive === true ? { nativeProjectionActive: true } : {}),
    ...(Array.isArray(input.requestedEvidenceIds) && input.requestedEvidenceIds.every(nonEmpty)
      ? { requestedEvidenceIds: input.requestedEvidenceIds as string[] }
      : {}),
  });
};
