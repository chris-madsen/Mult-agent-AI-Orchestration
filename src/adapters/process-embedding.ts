import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { ProviderTraceSink, VectorEmbeddingPort } from '../application/ports.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';

interface EmbeddingResponse {
  readonly id?: unknown;
  readonly vectors?: unknown;
  readonly error?: unknown;
  readonly type?: unknown;
  readonly identity?: unknown;
}

interface PendingRequest {
  readonly expectedCount: number;
  readonly resolve: (result: Result<readonly (readonly number[])[], DomainError>) => void;
  readonly timer: NodeJS.Timeout;
}

export interface ResolvedEmbeddingConfig {
  readonly provider: string;
  readonly model: string;
  readonly modelRevision: string;
  readonly artifactModel: string;
  readonly artifactRevision: string;
  /** A pinned SHA-256 or the explicit experimental marker "unverified". */
  readonly artifactDigest: string;
  readonly dimension: number;
  readonly preprocessing: string;
  /** Pinned is an explicit mode, never inferred from a model label. */
  readonly executionMode: 'pinned' | 'experimental-unpinned';
  readonly pinned: boolean;
}

export interface EmbeddingWorkerIdentity extends ResolvedEmbeddingConfig {
  /** Hash of the worker implementation that produced the receipt. */
  readonly runtimeBuild: string;
  /** Runtime/library versions actually reported by the worker. */
  readonly runtimeVersion: string;
}

export const verifiedEmbeddingIdentityFingerprint = (
  identity: EmbeddingWorkerIdentity,
): string => createHash('sha256').update([
  'embedding-identity-v1',
  identity.provider,
  identity.model,
  identity.modelRevision,
  identity.artifactModel,
  identity.artifactRevision,
  identity.artifactDigest,
  String(identity.dimension),
  identity.preprocessing,
  identity.executionMode,
  String(identity.pinned),
  identity.runtimeBuild,
  identity.runtimeVersion,
].join('|'), 'utf8').digest('hex');

export interface ProcessEmbeddingOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly dimension: number;
  readonly timeoutMs?: number;
  readonly providerVersion?: string;
  readonly trace?: ProviderTraceSink;
  /** Explicit, non-secret environment supplied to the worker. */
  readonly env?: Readonly<Record<string, string>>;
  /** When present, a verified worker startup receipt is mandatory. */
  readonly expectedIdentity?: ResolvedEmbeddingConfig;
}

export interface ManagedVectorEmbeddingPort extends VectorEmbeddingPort {
  readonly close: () => void;
  readonly probe: () => Effect.Effect<Result<void, DomainError>>;
  readonly identity: () => EmbeddingWorkerIdentity | undefined;
}

const providerError = (message: string): Result<never, DomainError> =>
  err(domainError('UNSUPPORTED_PROVIDER', 'embedding', message));

const responseObject = (value: unknown): EmbeddingResponse | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as EmbeddingResponse
    : undefined;

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const parseIdentity = (value: unknown): Result<EmbeddingWorkerIdentity, DomainError> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding.identity', 'embedding worker identity must be an object'));
  }
  const raw = value as Record<string, unknown>;
  const fields = [
    'provider', 'model', 'modelRevision', 'artifactModel', 'artifactRevision',
    'artifactDigest', 'preprocessing', 'executionMode', 'runtimeBuild', 'runtimeVersion',
  ] as const;
  const executionMode = raw.executionMode;
  if (!fields.every((field) => nonEmpty(raw[field]))
    || typeof raw.dimension !== 'number' || !Number.isSafeInteger(raw.dimension) || raw.dimension < 1
    || !/^[a-f0-9]{64}$/u.test(String(raw.artifactDigest))
    || (executionMode !== 'pinned' && executionMode !== 'experimental-unpinned')
    || typeof raw.pinned !== 'boolean'
    || raw.pinned !== (executionMode === 'pinned')) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding.identity', 'embedding worker returned an invalid effective identity'));
  }
  return ok({
    provider: String(raw.provider),
    model: String(raw.model),
    modelRevision: String(raw.modelRevision),
    artifactModel: String(raw.artifactModel),
    artifactRevision: String(raw.artifactRevision),
    artifactDigest: String(raw.artifactDigest),
    dimension: raw.dimension,
    preprocessing: String(raw.preprocessing),
    executionMode,
    pinned: raw.pinned,
    runtimeBuild: String(raw.runtimeBuild),
    runtimeVersion: String(raw.runtimeVersion),
  });
};

const compareIdentity = (
  expected: ResolvedEmbeddingConfig,
  actual: EmbeddingWorkerIdentity,
): Result<EmbeddingWorkerIdentity, DomainError> => {
  const comparisons: Array<readonly [string, string | number | boolean, string | number | boolean]> = [
    ['provider', expected.provider, actual.provider],
    ['model', expected.model, actual.model],
    ['modelRevision', expected.modelRevision, actual.modelRevision],
    ['artifactModel', expected.artifactModel, actual.artifactModel],
    ['artifactRevision', expected.artifactRevision, actual.artifactRevision],
    ['dimension', expected.dimension, actual.dimension],
    ['preprocessing', expected.preprocessing, actual.preprocessing],
    ['executionMode', expected.executionMode, actual.executionMode],
    ['pinned', expected.pinned, actual.pinned],
  ];
  if (expected.artifactDigest !== 'unverified') {
    comparisons.push(['artifactDigest', expected.artifactDigest, actual.artifactDigest]);
  }
  const mismatch = comparisons.find(([, wanted, observed]) => wanted !== observed);
  return mismatch === undefined
    ? ok(actual)
    : err(domainError(
      'INVALID_EXTERNAL_RESPONSE',
      'embedding.identity',
      `embedding worker identity mismatch for ${mismatch[0]}`,
    ));
};

const vectorsFromResponse = (
  value: EmbeddingResponse,
  expectedCount: number,
  dimension: number,
): Result<readonly (readonly number[])[], DomainError> => {
  if (!Array.isArray(value.vectors) || value.vectors.length !== expectedCount) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding.vectors', 'embedding worker returned an invalid batch size'));
  }
  const vectors: number[][] = [];
  for (const [index, rawVector] of value.vectors.entries()) {
    if (!Array.isArray(rawVector) || rawVector.length !== dimension
      || !rawVector.every((item) => typeof item === 'number' && Number.isFinite(item))) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', `embedding.vectors[${index}]`, 'embedding vector has invalid dimensions or values'));
    }
    vectors.push([...rawVector]);
  }
  return ok(vectors);
};

const safeInheritedEnvironment = (): NodeJS.ProcessEnv => {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'XDG_CACHE_HOME'];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key] as string]]));
};

const allowedWorkerEnvironment = new Set([
  'ACE_EMBEDDING_PROVIDER',
  'ACE_EMBEDDING_MODEL',
  'ACE_EMBEDDING_MODEL_REVISION',
  'ACE_EMBEDDING_ARTIFACT_MODEL',
  'ACE_EMBEDDING_ARTIFACT_REVISION',
  'ACE_EMBEDDING_ARTIFACT_DIGEST',
  'ACE_EMBEDDING_DIMENSION',
  'ACE_EMBEDDING_PREPROCESSING',
  'ACE_EMBEDDING_EXECUTION_MODE',
  'ACE_EMBEDDING_PINNED',
  'ACE_EMBEDDING_PYTHON',
  'ACE_EMBEDDING_LD_LIBRARY_PATH',
  'ACE_EMBEDDING_DELAY_MS',
  'FASTEMBED_CACHE_PATH',
  'HF_HOME',
  'HF_HUB_CACHE',
]);

const controlledWorkerEnvironment = (
  environment: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv => Object.fromEntries(
  Object.entries(environment ?? {}).filter(([key]) => allowedWorkerEnvironment.has(key)),
);

/**
 * Long-lived maintained embedding runtime with an optional mandatory startup
 * receipt. The parent never infers effective model identity from labels alone.
 */
export const makeProcessEmbeddingPort = (options: ProcessEmbeddingOptions): ManagedVectorEmbeddingPort => {
  const child: ChildProcessWithoutNullStreams = spawn(options.command, [...(options.args ?? [])], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...safeInheritedEnvironment(), ...controlledWorkerEnvironment(options.env) },
  });
  const pending = new Map<number, PendingRequest>();
  const readyWaiters = new Set<(result: Result<EmbeddingWorkerIdentity, DomainError>) => void>();
  const timeoutMs = options.timeoutMs ?? 120_000;
  let nextId = 1;
  let stdoutBuffer = '';
  let failure: DomainError | undefined;
  let effectiveIdentity: Result<EmbeddingWorkerIdentity, DomainError> | undefined;

  const settleIdentity = (result: Result<EmbeddingWorkerIdentity, DomainError>): void => {
    if (effectiveIdentity !== undefined) return;
    effectiveIdentity = result;
    for (const waiter of readyWaiters) waiter(result);
    readyWaiters.clear();
  };

  const failPending = (error: DomainError): void => {
    failure = error;
    if (options.expectedIdentity !== undefined) settleIdentity(err(error));
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.resolve(err(error));
    }
    pending.clear();
  };

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8');
    let newline = stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      newline = stdoutBuffer.indexOf('\n');
      if (line.trim().length === 0) continue;
      let decoded: unknown;
      try {
        decoded = JSON.parse(line) as unknown;
      } catch {
        failPending(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding', 'embedding worker returned invalid JSON'));
        continue;
      }
      const response = responseObject(decoded);
      if (response?.type === 'ready') {
        const parsed = parseIdentity(response.identity);
        settleIdentity(parsed._tag === 'Err' || options.expectedIdentity === undefined
          ? parsed
          : compareIdentity(options.expectedIdentity, parsed.value));
        continue;
      }
      const id = response?.id;
      if (response === undefined || typeof id !== 'number' || !Number.isSafeInteger(id)) {
        failPending(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding', 'embedding worker response id is invalid'));
        continue;
      }
      const request = pending.get(id);
      if (request === undefined) continue;
      pending.delete(id);
      clearTimeout(request.timer);
      if (typeof response.error === 'string') request.resolve(providerError(response.error));
      else request.resolve(vectorsFromResponse(response, request.expectedCount, options.dimension));
    }
  });
  child.stderr.on('data', () => undefined);
  child.on('error', () => failPending(domainError('UNSUPPORTED_PROVIDER', 'embedding', 'embedding worker failed to start')));
  child.on('exit', (code) => {
    if (failure === undefined) {
      failPending(domainError('UNSUPPORTED_PROVIDER', 'embedding', `embedding worker exited with code ${code ?? 'unknown'}`));
    }
  });

  const awaitIdentity = (): Effect.Effect<Result<EmbeddingWorkerIdentity | undefined, DomainError>> => {
    if (options.expectedIdentity === undefined) return Effect.succeed(ok(undefined));
    if (effectiveIdentity !== undefined) return Effect.succeed(effectiveIdentity);
    return Effect.async((resume) => {
      let waiter: (result: Result<EmbeddingWorkerIdentity, DomainError>) => void;
      const timer = setTimeout(() => {
        readyWaiters.delete(waiter);
        resume(Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'embedding.identity', 'embedding worker startup receipt timed out'))));
      }, timeoutMs);
      waiter = (result: Result<EmbeddingWorkerIdentity, DomainError>): void => {
        clearTimeout(timer);
        resume(Effect.succeed(result));
      };
      readyWaiters.add(waiter);
    });
  };

  const issueEmbedding = (input: readonly string[]): Effect.Effect<Result<readonly (readonly number[])[], DomainError>> =>
    Effect.async((resume) => {
      if (input.length === 0 || input.some((text) => text.trim().length === 0)) {
        resume(Effect.succeed(err(domainError('INVALID_INPUT', 'embedding_text', 'embedding input must contain non-empty text'))));
        return;
      }
      if (failure !== undefined || child.stdin.destroyed) {
        resume(Effect.succeed(err(failure ?? domainError('UNSUPPORTED_PROVIDER', 'embedding', 'embedding worker is unavailable'))));
        return;
      }
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        pending.delete(id);
        resume(Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'embedding', 'embedding worker timed out'))));
      }, timeoutMs);
      pending.set(id, { expectedCount: input.length, timer, resolve: (result) => resume(Effect.succeed(result)) });
      child.stdin.write(JSON.stringify({ id, texts: input }) + '\n', (error) => {
        if (error !== undefined && error !== null) {
          clearTimeout(timer);
          pending.delete(id);
          resume(Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'embedding', 'embedding worker write failed'))));
        }
      });
    });

  const embedMany = (
    input: readonly string[],
    requestId?: string,
  ): Effect.Effect<Result<readonly (readonly number[])[], DomainError>> => {
    const startedAtMs = Date.now();
    const operation = Effect.gen(function* () {
      const ready = yield* awaitIdentity();
      if (ready._tag === 'Err') return ready;
      return yield* issueEmbedding(input);
    });
    return Effect.map(operation, (result) => {
      const identity = effectiveIdentity?._tag === 'Ok' ? effectiveIdentity.value : undefined;
      providerTraceEvent(options.trace ?? noopProviderTrace, {
        provider: 'embedding',
        providerVersion: identity === undefined
          ? options.providerVersion ?? 'process-worker/unknown'
          : `${identity.provider}|model=${identity.model}@${identity.modelRevision}|artifact=${identity.artifactModel}@${identity.artifactRevision}#${identity.artifactDigest}|mode=${identity.executionMode}|runtime=${identity.runtimeBuild}@${identity.runtimeVersion}`,
        operation: 'embed_many',
        status: result._tag === 'Ok' ? 'success' : 'failure',
        durationMs: Math.max(0, Date.now() - startedAtMs),
        vectorDimension: options.dimension,
        ...(requestId === undefined ? {} : { requestId }),
        ...(result._tag === 'Err' ? { errorCode: result.error.code } : {}),
      });
      return result;
    });
  };

  const probe = (): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
    const ready = yield* awaitIdentity();
    if (ready._tag === 'Err') return ready;
    const result = yield* embedMany(['ace_embedding_provider_probe']);
    return result._tag === 'Err' ? result : ok(undefined);
  });

  const close = (): void => {
    if (!child.killed) {
      failPending(domainError('EXTERNAL_UNAVAILABLE', 'embedding', 'embedding worker closed'));
      child.kill('SIGTERM');
    }
  };

  return {
    embedMany,
    close,
    probe,
    identity: () => effectiveIdentity?._tag === 'Ok' ? effectiveIdentity.value : undefined,
  };
};
