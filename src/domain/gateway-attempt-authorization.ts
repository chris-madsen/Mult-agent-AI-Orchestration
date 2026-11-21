import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import { sha256Base64 } from './gateway-request-binding.js';
import type {
  PhysicalSendAttemptDecision as GeneratedPhysicalSendAttemptDecision,
  PhysicalSendAttemptRequest as GeneratedPhysicalSendAttemptRequest,
} from '../generated/ace-context/v3/types.gen.js';

export type PhysicalSendAttemptRequest = Readonly<GeneratedPhysicalSendAttemptRequest>;
export type PhysicalSendAttemptDecision = Readonly<GeneratedPhysicalSendAttemptDecision>;

const fields = new Set([
  'schemaVersion', 'requestId', 'attemptGroupId', 'agentSessionId', 'workspaceId', 'dataClass',
  'provider', 'model', 'attemptId', 'method', 'destination', 'bodyBase64', 'bodySha256', 'preparedBodySha256',
  'projectionReceipt', 'deadlineEpochMs',
]);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const rejected = (field: string, reason: string): Result<never, DomainError> =>
  err(domainError('INVALID_INPUT', field, reason));

// Native Responses provider targets have two maintained wire paths:
// OpenAI-compatible /v1/responses and the official ChatGPT subscription Codex
// backend. Credential checks remain the provider's responsibility; ACE's
// separately configured exact destination allowlist decides admissibility.
export const isNativeResponsesDestinationPath = (parsed: URL): boolean =>
  parsed.pathname.replace(/\/+$/u, '').endsWith('/v1/responses')
  || (parsed.origin === 'https://chatgpt.com'
    && parsed.pathname === '/backend-api/codex/responses');

export const validatePhysicalSendAttemptRequest = (
  value: unknown,
): Result<PhysicalSendAttemptRequest, DomainError> => {
  if (!object(value)) return rejected('request', 'physical-send authorization must be an object');
  const unknown = Object.keys(value).find((key) => !fields.has(key));
  if (unknown !== undefined) return rejected(unknown, 'unrecognized v2 attempt field');
  if (value.schemaVersion !== 'ace.context.v3') return rejected('schemaVersion', 'unsupported ACE context RPC version');
  for (const key of [
    'requestId', 'attemptGroupId', 'agentSessionId', 'workspaceId', 'provider', 'model',
    'attemptId', 'method', 'destination', 'bodyBase64', 'bodySha256', 'projectionReceipt',
    'preparedBodySha256',
  ]) {
    if (!nonempty(value[key])) return rejected(key, 'required physical-send binding is missing');
  }
  if (!/^ace-[a-f0-9]{32}$/u.test(value.requestId as string)) return rejected('requestId', 'invalid ACE request identity');
  if (!/^bf-attempt-[a-f0-9]{32}$/u.test(value.attemptId as string)) return rejected('attemptId', 'invalid physical attempt identity');
  if (value.attemptGroupId !== value.requestId) return rejected('attemptGroupId', 'native Responses attempt group differs from the ACE request identity');
  if (value.method !== 'POST') return rejected('method', 'native Responses provider sends must use POST');
  if (value.dataClass !== 'private' && value.dataClass !== 'project_document' && value.dataClass !== 'public') {
    return rejected('dataClass', 'invalid source-data classification');
  }
  if (!Number.isSafeInteger(value.deadlineEpochMs) || (value.deadlineEpochMs as number) <= 0) {
    return rejected('deadlineEpochMs', 'invalid attempt deadline');
  }
  if (!/^[a-f0-9]{64}$/u.test(value.bodySha256 as string)) return rejected('bodySha256', 'invalid body digest');
  if (!/^[a-f0-9]{64}$/u.test(value.preparedBodySha256 as string)) {
    return rejected('preparedBodySha256', 'invalid prepared-body digest');
  }
  const bodyBase64 = value.bodyBase64 as string;
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(bodyBase64)) return rejected('bodyBase64', 'invalid body encoding');
  const body = Buffer.from(bodyBase64, 'base64');
  if (body.length > 4 * 1024 * 1024 || body.toString('base64') !== bodyBase64) {
    return rejected('bodyBase64', 'body exceeds the Gateway limit or is not canonical Base64');
  }
  if (sha256Base64(bodyBase64) !== value.bodySha256) return rejected('bodySha256', 'final body does not match its digest');
  const destination = value.destination as string;
  let parsed: URL;
  try { parsed = new URL(destination); } catch { return rejected('destination', 'provider destination is invalid'); }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== ''
    || parsed.search !== '' || parsed.hash !== '' || parsed.pathname === '') {
    return rejected('destination', 'only credential-free HTTPS destination paths are supported');
  }
  if (!isNativeResponsesDestinationPath(parsed)) {
    return rejected('destination', 'only native Responses or ChatGPT Codex subscription endpoints are supported');
  }
  if (!/^https:\/\//u.test(destination) || parsed.toString().replace(/\/$/u, '') !== destination.replace(/\/$/u, '')) {
    return rejected('destination', 'provider destination must use canonical URL spelling');
  }
  if ((value.projectionReceipt as string).length > 16 * 1024) return rejected('projectionReceipt', 'projection receipt exceeds its bound');
  return ok(value as unknown as PhysicalSendAttemptRequest);
};

export const physicalSendAttemptBlocked = (
  request: PhysicalSendAttemptRequest,
  reasonCode: string,
): Result<PhysicalSendAttemptDecision, DomainError> => ok({
  kind: 'BLOCK', attemptId: request.attemptId, bodySha256: request.bodySha256, reasonCode,
});

export const physicalSendAttemptAllowed = (
  request: PhysicalSendAttemptRequest,
): Result<PhysicalSendAttemptDecision, DomainError> => ok({
  kind: 'ALLOW', attemptId: request.attemptId, bodySha256: request.bodySha256,
  provider: request.provider, model: request.model, destination: request.destination,
  reasonCode: 'AUTHORIZED',
});
