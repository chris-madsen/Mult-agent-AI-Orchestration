import { Effect } from 'effect';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';

export type QdrantQueryRequest = Parameters<QdrantClient['query']>[1];
export type QdrantUpsertRequest = Parameters<QdrantClient['upsert']>[1];
export type QdrantDeleteRequest = Parameters<QdrantClient['delete']>[1];
export type QdrantCreateCollectionRequest = Parameters<QdrantClient['createCollection']>[1];
export type QdrantAliasUpdateRequest = Parameters<QdrantClient['updateCollectionAliases']>[0];
export type QdrantCountRequest = Parameters<QdrantClient['count']>[1];
export type QdrantScrollRequest = Parameters<QdrantClient['scroll']>[1];

export interface QdrantScrollPage {
  readonly points: readonly unknown[];
  readonly nextPageOffset?: string | number | null;
}

export interface QdrantSdkPort {
  readonly probeService: () => Effect.Effect<Result<void, DomainError>>;
  readonly getCollection: (collection: string) => Effect.Effect<Result<unknown, DomainError>>;
  readonly createCollection: (
    collection: string,
    request: QdrantCreateCollectionRequest,
  ) => Effect.Effect<Result<void, DomainError>>;
  readonly getAliases: () => Effect.Effect<Result<readonly unknown[], DomainError>>;
  readonly updateAliases: (request: QdrantAliasUpdateRequest) => Effect.Effect<Result<void, DomainError>>;
  readonly countPoints: (
    collection: string,
    request: QdrantCountRequest,
  ) => Effect.Effect<Result<number, DomainError>>;
  readonly scrollPoints: (
    collection: string,
    request: QdrantScrollRequest,
  ) => Effect.Effect<Result<QdrantScrollPage, DomainError>>;
  readonly queryPoints: (
    collection: string,
    request: QdrantQueryRequest,
  ) => Effect.Effect<Result<readonly unknown[], DomainError>>;
  readonly upsertPoints: (
    collection: string,
    request: QdrantUpsertRequest,
  ) => Effect.Effect<Result<void, DomainError>>;
  readonly deletePoints: (
    collection: string,
    request: QdrantDeleteRequest,
  ) => Effect.Effect<Result<void, DomainError>>;
}

export interface QdrantSdkAdapterConfig {
  readonly baseUrl: string;
  readonly client: QdrantClient;
  readonly allowedHosts?: readonly string[];
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const invalidResponse = (path: string, message: string): Result<never, DomainError> =>
  err(domainError('INVALID_EXTERNAL_RESPONSE', path, message));

const qdrantSdkHttpStatus = (cause: unknown): number | undefined => {
  const value = object(cause);
  if (typeof value?.status === 'number' && Number.isSafeInteger(value.status)
    && value.status >= 400 && value.status <= 599) return value.status;
  if (!(cause instanceof Error)) return undefined;
  const match = /^Unexpected Response: ([4-5][0-9]{2})(?:\s|$)/u.exec(cause.message);
  return match === null ? undefined : Number(match[1]);
};

const qdrantSdkCall = <Value>(
  action: () => Promise<Value>,
): Effect.Effect<Result<Value, DomainError>> => Effect.catchAll(
    Effect.tryPromise<Result<Value, DomainError>, DomainError>({
      try: async () => {
        try {
          return ok(await action());
        } catch (cause) {
          const httpStatus = qdrantSdkHttpStatus(cause);
          return err(domainError(
            'EXTERNAL_UNAVAILABLE',
            'qdrant',
            cause instanceof Error ? cause.message : 'Qdrant SDK call failed',
            httpStatus === undefined ? undefined : { httpStatus },
          ));
        }
      },
      catch: () => domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'Qdrant SDK call failed'),
    }),
    (failure) => Effect.succeed(err(failure)),
  );

export const validateLocalQdrantBaseUrl = (
  baseUrl: string,
  allowedHosts: readonly string[] = [],
): Result<string, DomainError> => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return err(domainError('INVALID_INPUT', 'qdrant_url', 'Qdrant URL must be a valid absolute URL'));
  }
  const hostname = url.hostname.toLocaleLowerCase().replace(/^\[|\]$/gu, '');
  const allowed = new Set(['localhost', '127.0.0.1', '::1', ...allowedHosts.map((host) => host.trim().toLocaleLowerCase())]);
  if (url.protocol !== 'http:' || !allowed.has(hostname) || url.username !== '' || url.password !== '') {
    return err(domainError(
      'POLICY_DENIED',
      'qdrant_url',
      'Qdrant code index is local-only: use loopback HTTP or an explicitly allowlisted local bridge host',
    ));
  }
  return ok(url.origin);
};

export const makeQdrantSdkAdapter = (config: QdrantSdkAdapterConfig): QdrantSdkPort => {
  const call = <Value>(action: () => Promise<Value>): Effect.Effect<Result<Value, DomainError>> => {
    const endpoint = validateLocalQdrantBaseUrl(config.baseUrl, config.allowedHosts);
    return endpoint._tag === 'Err' ? Effect.succeed(endpoint) : qdrantSdkCall(action);
  };

  const booleanMutation = (
    action: () => Promise<unknown>,
    operation: string,
  ): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
    const result = yield* call(action);
    if (result._tag === 'Err') return result;
    if (result.value !== true) {
      return invalidResponse('qdrant_update', `Qdrant ${operation} did not report success`);
    }
    return ok(undefined);
  });

  const completedMutation = (
    action: () => Promise<unknown>,
    operation: string,
  ): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
    const result = yield* call(action);
    if (result._tag === 'Err') return result;
    if (object(result.value)?.status !== 'completed') {
      return invalidResponse('qdrant_update', `Qdrant ${operation} did not report completed status`);
    }
    return ok(undefined);
  });

  return {
    probeService: () => Effect.gen(function* () {
      const listed = yield* call(() => config.client.getCollections());
      if (listed._tag === 'Err') return listed;
      return Array.isArray(object(listed.value)?.collections)
        ? ok(undefined)
        : invalidResponse('qdrant', 'Qdrant collection-list response must contain collections');
    }),
    getCollection: (collection) => call(() => config.client.getCollection(collection)),
    createCollection: (collection, request) => booleanMutation(
      () => config.client.createCollection(collection, request),
      'collection creation',
    ),
    getAliases: () => Effect.gen(function* () {
      const listed = yield* call(() => config.client.getAliases());
      if (listed._tag === 'Err') return listed;
      const aliases = object(listed.value)?.aliases;
      return Array.isArray(aliases)
        ? ok(aliases)
        : invalidResponse('qdrant_alias', 'Qdrant SDK alias response is malformed');
    }),
    updateAliases: (request) => booleanMutation(
      () => config.client.updateCollectionAliases(request),
      'alias update',
    ),
    countPoints: (collection, request) => Effect.gen(function* () {
      const counted = yield* call(() => config.client.count(collection, request));
      if (counted._tag === 'Err') return counted;
      const count = object(counted.value)?.count;
      return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
        ? ok(count)
        : invalidResponse('qdrant_count', 'invalid exact snapshot count');
    }),
    scrollPoints: (collection, request) => Effect.gen(function* () {
      const scrolled = yield* call(() => config.client.scroll(collection, request));
      if (scrolled._tag === 'Err') return scrolled;
      const response = object(scrolled.value);
      if (response === undefined || !Array.isArray(response.points)) {
        return invalidResponse('qdrant_scroll', 'Qdrant scroll response must contain points');
      }
      const points = response.points;
      const nextPageOffset = response.next_page_offset;
      if (nextPageOffset !== undefined && nextPageOffset !== null
        && typeof nextPageOffset !== 'string' && typeof nextPageOffset !== 'number') {
        return invalidResponse('qdrant_scroll', 'Qdrant scroll page offset is malformed');
      }
      return ok({ points, ...(nextPageOffset === undefined ? {} : { nextPageOffset }) });
    }),
    queryPoints: (collection, request) => Effect.gen(function* () {
      const queried = yield* call(() => config.client.query(collection, request));
      if (queried._tag === 'Err') return queried;
      const points = object(queried.value)?.points;
      return Array.isArray(points)
        ? ok(points)
        : invalidResponse('qdrant_query', 'Qdrant query response must contain points');
    }),
    upsertPoints: (collection, request) => completedMutation(
      () => config.client.upsert(collection, request),
      'upsert',
    ),
    deletePoints: (collection, request) => completedMutation(
      () => config.client.delete(collection, request),
      'delete',
    ),
  };
};
