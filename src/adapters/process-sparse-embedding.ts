import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type {
  ProviderTraceSink,
  SparseEmbeddingPort,
  SparseVector,
} from '../application/ports.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';

interface SparseEmbeddingResponse {
  readonly type?: unknown;
  readonly identity?: unknown;
  readonly id?: unknown;
  readonly vectors?: unknown;
  readonly error?: unknown;
}

export interface SparseEmbeddingWorkerIdentity {
  readonly provider: string;
  readonly model: string;
  readonly preprocessing: string;
  readonly artifactDigest: string;
  readonly runtimeBuild: string;
  readonly runtimeVersion: string;
}

export const sparseEmbeddingIdentityFingerprint = (
  identity: SparseEmbeddingWorkerIdentity,
): string => createHash('sha256').update([
  'sparse-embedding-identity-v1',
  identity.provider,
  identity.model,
  identity.preprocessing,
  identity.artifactDigest,
  identity.runtimeBuild,
  identity.runtimeVersion,
].join('|'), 'utf8').digest('hex');

export interface ProcessSparseEmbeddingOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  readonly expectedModel?: string;
  readonly providerVersion?: string;
  readonly trace?: ProviderTraceSink;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ManagedSparseEmbeddingPort extends SparseEmbeddingPort {
  readonly close: () => void;
  readonly probe: () => Effect.Effect<Result<void, DomainError>>;
  readonly identity: () => SparseEmbeddingWorkerIdentity | undefined;
}

interface PendingRequest {
  readonly expectedCount: number;
  readonly resolve: (result: Result<readonly SparseVector[], DomainError>) => void;
  readonly timer: NodeJS.Timeout;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const parseIdentity = (value: unknown): Result<SparseEmbeddingWorkerIdentity, DomainError> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err(domainError(
      'INVALID_EXTERNAL_RESPONSE',
      'sparse_embedding.identity',
      'sparse embedding worker identity must be an object',
    ));
  }
  const raw = value as Record<string, unknown>;
  if (!nonEmpty(raw.provider) || !nonEmpty(raw.model) || !nonEmpty(raw.preprocessing)
    || !nonEmpty(raw.runtimeBuild) || !nonEmpty(raw.runtimeVersion)
    || typeof raw.artifactDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.artifactDigest)) {
    return err(domainError(
      'INVALID_EXTERNAL_RESPONSE',
      'sparse_embedding.identity',
      'sparse embedding worker returned an invalid identity',
    ));
  }
  return ok({
    provider: raw.provider,
    model: raw.model,
    preprocessing: raw.preprocessing,
    artifactDigest: raw.artifactDigest,
    runtimeBuild: raw.runtimeBuild,
    runtimeVersion: raw.runtimeVersion,
  });
};

const sparseVectorsFromResponse = (
  value: SparseEmbeddingResponse,
  expectedCount: number,
): Result<readonly SparseVector[], DomainError> => {
  if (!Array.isArray(value.vectors) || value.vectors.length !== expectedCount) {
    return err(domainError(
      'INVALID_EXTERNAL_RESPONSE',
      'sparse_embedding.vectors',
      'sparse embedding worker returned an invalid batch size',
    ));
  }
  const output: SparseVector[] = [];
  for (const [vectorIndex, raw] of value.vectors.entries()) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return err(domainError(
        'INVALID_EXTERNAL_RESPONSE',
        `sparse_embedding.vectors[${vectorIndex}]`,
        'sparse vector must be an object',
      ));
    }
    const item = raw as Record<string, unknown>;
    if (!Array.isArray(item.indices) || !Array.isArray(item.values)
      || item.indices.length === 0 || item.indices.length !== item.values.length
      || !item.indices.every((index) => typeof index === 'number'
        && Number.isSafeInteger(index) && index >= 0)
      || !item.values.every((score) => typeof score === 'number' && Number.isFinite(score) && score >= 0)
      || new Set(item.indices).size !== item.indices.length) {
      return err(domainError(
        'INVALID_EXTERNAL_RESPONSE',
        `sparse_embedding.vectors[${vectorIndex}]`,
        'sparse vector requires unique non-negative integer indices and finite non-negative values',
      ));
    }
    output.push({
      indices: item.indices as number[],
      values: item.values as number[],
    });
  }
  return ok(output);
};

const safeInheritedEnvironment = (): NodeJS.ProcessEnv => {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'XDG_CACHE_HOME'];
  return Object.fromEntries(
    allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key] as string]]),
  );
};

const allowedWorkerEnvironment = new Set([
  'ACE_SPARSE_EMBEDDING_MODEL',
  'ACE_SPARSE_EMBEDDING_PYTHON',
  'ACE_SPARSE_EMBEDDING_LD_PRELOAD',
  'ACE_SPARSE_EMBEDDING_THREADS',
  'FASTEMBED_CACHE_PATH',
  'HF_HOME',
  'HF_HUB_CACHE',
]);

const controlledWorkerEnvironment = (
  environment: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv => Object.fromEntries(
  Object.entries(environment ?? {}).filter(([key]) => allowedWorkerEnvironment.has(key)),
);

export const makeProcessSparseEmbeddingPort = (
  options: ProcessSparseEmbeddingOptions,
): ManagedSparseEmbeddingPort => {
  const child: ChildProcessWithoutNullStreams = spawn(options.command, [...(options.args ?? [])], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...safeInheritedEnvironment(), ...controlledWorkerEnvironment(options.env) },
  });
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pending = new Map<number, PendingRequest>();
  const readyWaiters = new Set<(result: Result<SparseEmbeddingWorkerIdentity, DomainError>) => void>();
  let nextId = 1;
  let stdoutBuffer = '';
  let failure: DomainError | undefined;
  let effectiveIdentity: Result<SparseEmbeddingWorkerIdentity, DomainError> | undefined;

  const settleIdentity = (result: Result<SparseEmbeddingWorkerIdentity, DomainError>): void => {
    if (effectiveIdentity !== undefined) return;
    effectiveIdentity = result;
    for (const waiter of readyWaiters) waiter(result);
    readyWaiters.clear();
  };

  const failPending = (error: DomainError): void => {
    failure = error;
    if (effectiveIdentity === undefined) settleIdentity(err(error));
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
        failPending(domainError(
          'INVALID_EXTERNAL_RESPONSE',
          'sparse_embedding',
          'sparse embedding worker returned invalid JSON',
        ));
        continue;
      }
      const response = typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded)
        ? decoded as SparseEmbeddingResponse
        : undefined;
      if (response?.type === 'ready') {
        const parsed = parseIdentity(response.identity);
        if (parsed._tag === 'Ok' && options.expectedModel !== undefined
          && parsed.value.model.toLocaleLowerCase() !== options.expectedModel.toLocaleLowerCase()) {
          settleIdentity(err(domainError(
            'INVALID_EXTERNAL_RESPONSE',
            'sparse_embedding.identity',
            'sparse embedding worker model does not match configured model',
          )));
        } else {
          settleIdentity(parsed);
        }
        continue;
      }
      const id = response?.id;
      if (response === undefined || typeof id !== 'number' || !Number.isSafeInteger(id)) {
        failPending(domainError(
          'INVALID_EXTERNAL_RESPONSE',
          'sparse_embedding',
          'sparse embedding worker response id is invalid',
        ));
        continue;
      }
      const request = pending.get(id);
      if (request === undefined) continue;
      pending.delete(id);
      clearTimeout(request.timer);
      if (typeof response.error === 'string') {
        request.resolve(err(domainError('UNSUPPORTED_PROVIDER', 'sparse_embedding', response.error)));
      } else {
        request.resolve(sparseVectorsFromResponse(response, request.expectedCount));
      }
    }
  });

  child.stderr.on('data', () => undefined);
  child.on('error', () => failPending(domainError(
    'UNSUPPORTED_PROVIDER',
    'sparse_embedding',
    'sparse embedding worker failed to start',
  )));
  child.on('exit', (code) => {
    if (failure === undefined) {
      failPending(domainError(
        'UNSUPPORTED_PROVIDER',
        'sparse_embedding',
        `sparse embedding worker exited with code ${code ?? 'unknown'}`,
      ));
    }
  });

  const awaitIdentity = (): Effect.Effect<Result<SparseEmbeddingWorkerIdentity, DomainError>> => {
    if (effectiveIdentity !== undefined) return Effect.succeed(effectiveIdentity);
    return Effect.async((resume) => {
      let waiter: (result: Result<SparseEmbeddingWorkerIdentity, DomainError>) => void;
      const timer = setTimeout(() => {
        readyWaiters.delete(waiter);
        resume(Effect.succeed(err(domainError(
          'EXTERNAL_UNAVAILABLE',
          'sparse_embedding.identity',
          'sparse embedding worker startup receipt timed out',
        ))));
      }, timeoutMs);
      waiter = (result): void => {
        clearTimeout(timer);
        resume(Effect.succeed(result));
      };
      readyWaiters.add(waiter);
    });
  };

  const issue = (
    mode: 'document' | 'query',
    input: readonly string[],
  ): Effect.Effect<Result<readonly SparseVector[], DomainError>> => Effect.async((resume) => {
    if (input.length === 0 || input.some((text) => text.trim().length === 0)) {
      resume(Effect.succeed(err(domainError(
        'INVALID_INPUT',
        'sparse_embedding',
        'sparse embedding input must contain non-empty text',
      ))));
      return;
    }
    if (failure !== undefined || child.stdin.destroyed) {
      resume(Effect.succeed(err(
        failure ?? domainError('UNSUPPORTED_PROVIDER', 'sparse_embedding', 'sparse embedding worker is unavailable'),
      )));
      return;
    }
    const id = nextId;
    nextId += 1;
    const timer = setTimeout(() => {
      pending.delete(id);
      resume(Effect.succeed(err(domainError(
        'EXTERNAL_UNAVAILABLE',
        'sparse_embedding',
        'sparse embedding worker timed out',
      ))));
    }, timeoutMs);
    pending.set(id, {
      expectedCount: input.length,
      timer,
      resolve: (result) => resume(Effect.succeed(result)),
    });
    child.stdin.write(JSON.stringify({ id, mode, texts: input }) + '\n', (error) => {
      if (error !== undefined && error !== null) {
        clearTimeout(timer);
        pending.delete(id);
        resume(Effect.succeed(err(domainError(
          'EXTERNAL_UNAVAILABLE',
          'sparse_embedding',
          'sparse embedding worker write failed',
        ))));
      }
    });
  });

  const embed = (
    mode: 'document' | 'query',
    input: readonly string[],
    requestId?: string,
  ): Effect.Effect<Result<readonly SparseVector[], DomainError>> => {
    const startedAtMs = Date.now();
    const operation = Effect.gen(function* () {
      const ready = yield* awaitIdentity();
      if (ready._tag === 'Err') return ready;
      return yield* issue(mode, input);
    });
    return Effect.map(operation, (result) => {
      const identity = effectiveIdentity?._tag === 'Ok' ? effectiveIdentity.value : undefined;
      providerTraceEvent(options.trace ?? noopProviderTrace, {
        provider: 'sparse_embedding',
        providerVersion: identity === undefined
          ? options.providerVersion ?? 'process-sparse-embedding/unknown'
          : `${identity.provider}|model=${identity.model}#${identity.artifactDigest}|preprocessing=${identity.preprocessing}|runtime=${identity.runtimeBuild}@${identity.runtimeVersion}`,
        operation: mode === 'document' ? 'embed_documents' : 'embed_queries',
        status: result._tag === 'Ok' ? 'success' : 'failure',
        durationMs: Math.max(0, Date.now() - startedAtMs),
        ...(requestId === undefined ? {} : { requestId }),
        ...(result._tag === 'Err' ? { errorCode: result.error.code } : {}),
      });
      return result;
    });
  };

  return {
    embedDocuments: (input, requestId) => embed('document', input, requestId),
    embedQueries: (input, requestId) => embed('query', input, requestId),
    probe: () => Effect.gen(function* () {
      const ready = yield* awaitIdentity();
      if (ready._tag === 'Err') return ready;
      const document = yield* embed('document', ['ace sparse document probe']);
      if (document._tag === 'Err') return document;
      const query = yield* embed('query', ['ace sparse query probe']);
      return query._tag === 'Err' ? query : ok(undefined);
    }),
    identity: () => effectiveIdentity?._tag === 'Ok' ? effectiveIdentity.value : undefined,
    close: () => {
      if (!child.killed) {
        failPending(domainError('EXTERNAL_UNAVAILABLE', 'sparse_embedding', 'sparse embedding worker closed'));
        child.kill('SIGTERM');
      }
    },
  };
};
