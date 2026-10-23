import { createInterface } from 'node:readline';
import { Effect } from 'effect';
import {
  makeContextTransformService,
  type AceTransformRequest,
  type AceTransformResult,
} from '../application/context-transform-service.js';
import { domainError, type DomainError } from '../domain/errors.js';
import { isErr, type Result } from '../domain/result.js';

export interface ContextBridgeService {
  readonly transform: (
    request: AceTransformRequest,
  ) => Effect.Effect<Result<AceTransformResult, DomainError>>;
}

export type ContextBridgeResponse =
  | { readonly type: 'transform_result'; readonly requestId: string; readonly ok: true; readonly result: AceTransformResult }
  | { readonly type: 'transform_error'; readonly requestId: string | null; readonly ok: false; readonly error: DomainError };

type JsonObject = Readonly<Record<string, unknown>>;

const object = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;

const invalid = (path: string, message: string): ContextBridgeResponse => ({
  type: 'transform_error',
  requestId: null,
  ok: false,
  error: domainError('INVALID_INPUT', path, message),
});

const decodeRequest = (value: unknown): Result<AceTransformRequest, DomainError> => {
  const input = object(value);
  if (input === undefined) return { _tag: 'Err', error: domainError('INVALID_INPUT', 'request', 'bridge request must be an object') };
  if (input.type !== 'transform') return { _tag: 'Err', error: domainError('INVALID_INPUT', 'type', 'bridge message type must be transform') };
  if (input.schemaVersion !== 1) return { _tag: 'Err', error: domainError('INVALID_INPUT', 'schemaVersion', 'unsupported bridge schema version') };
  const stringFields = ['requestId', 'sessionId', 'workspaceId', 'query'] as const;
  for (const field of stringFields) {
    if (typeof input[field] !== 'string' || input[field].trim().length === 0) {
      return { _tag: 'Err', error: domainError('INVALID_INPUT', field, `${field} must be a non-empty string`) };
    }
  }
  if (typeof input.budgetTokens !== 'number' || !Number.isSafeInteger(input.budgetTokens) || input.budgetTokens <= 0) {
    return { _tag: 'Err', error: domainError('INVALID_INPUT', 'budgetTokens', 'budgetTokens must be a positive safe integer') };
  }
  const workingContext = object(input.workingContext);
  return {
    _tag: 'Ok',
    value: {
      schemaVersion: 1,
      requestId: input.requestId as string,
      sessionId: input.sessionId as string,
      workspaceId: input.workspaceId as string,
      query: input.query as string,
      budgetTokens: input.budgetTokens,
      ...(typeof input.intent === 'string' ? { intent: input.intent } : {}),
      ...(workingContext === undefined
        ? {}
        : { workingContext: workingContext as NonNullable<AceTransformRequest['workingContext']> }),
      ...(typeof input.knownBundleId === 'string' ? { knownBundleId: input.knownBundleId } : {}),
      ...(Array.isArray(input.knownEvidenceIds) && input.knownEvidenceIds.every((id) => typeof id === 'string')
        ? { knownEvidenceIds: input.knownEvidenceIds as string[] }
        : {}),
    },
  };
};

export const handleContextBridgeMessage = async (
  service: ContextBridgeService,
  input: unknown,
): Promise<ContextBridgeResponse> => {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return invalid('json', 'bridge input is not valid JSON');
    }
  }
  const decoded = decodeRequest(value);
  if (decoded._tag === 'Err') {
    const requestId = object(value)?.requestId;
    return {
      type: 'transform_error',
      requestId: typeof requestId === 'string' ? requestId : null,
      ok: false,
      error: decoded.error,
    };
  }
  try {
    const transformed = await Effect.runPromise(service.transform(decoded.value));
    if (isErr(transformed)) {
      return {
        type: 'transform_error',
        requestId: decoded.value.requestId,
        ok: false,
        error: transformed.error,
      };
    }
    return {
      type: 'transform_result',
      requestId: decoded.value.requestId,
      ok: true,
      result: transformed.value,
    };
  } catch {
    return {
      type: 'transform_error',
      requestId: decoded.value.requestId,
      ok: false,
      error: domainError('NOT_READY', 'bridge', 'context transformation failed inside the bridge'),
    };
  }
};

export const runContextBridgeStdio = async (
  service: ContextBridgeService,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> => {
  const lines = createInterface({ input });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    const response = await handleContextBridgeMessage(service, line);
    output.write(`${JSON.stringify(response)}\n`);
  }
};

export { makeContextTransformService };
