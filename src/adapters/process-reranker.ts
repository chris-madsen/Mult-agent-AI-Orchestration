import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { ProviderTraceSink, RerankerPort, RerankScore } from '../application/ports.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';

interface RerankerResponse {
  readonly type?: unknown;
  readonly identity?: unknown;
  readonly id?: unknown;
  readonly scores?: unknown;
  readonly error?: unknown;
}

export interface RerankerWorkerIdentity {
  readonly provider: string;
  readonly model: string;
  readonly runtimeBuild: string;
  readonly runtimeVersion: string;
}

export interface ProcessRerankerOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  readonly expectedModel?: string;
  readonly providerVersion?: string;
  readonly trace?: ProviderTraceSink;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ManagedRerankerPort extends RerankerPort {
  readonly close: () => void;
  readonly probe: () => Effect.Effect<Result<void, DomainError>>;
  readonly identity: () => RerankerWorkerIdentity | undefined;
}

interface PendingRequest {
  readonly expectedCount: number;
  readonly resolve: (result: Result<readonly RerankScore[], DomainError>) => void;
  readonly timer: NodeJS.Timeout;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const parseIdentity = (value: unknown): Result<RerankerWorkerIdentity, DomainError> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'reranker.identity', 'reranker worker identity must be an object'));
  }
  const raw = value as Record<string, unknown>;
  if (!nonEmpty(raw.provider) || !nonEmpty(raw.model)
    || !nonEmpty(raw.runtimeBuild) || !nonEmpty(raw.runtimeVersion)) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'reranker.identity', 'reranker worker returned an invalid identity'));
  }
  return ok({
    provider: raw.provider,
    model: raw.model,
    runtimeBuild: raw.runtimeBuild,
    runtimeVersion: raw.runtimeVersion,
  });
};

const scoresFromResponse = (
  value: RerankerResponse,
  expectedCount: number,
): Result<readonly RerankScore[], DomainError> => {
  if (!Array.isArray(value.scores) || value.scores.length !== expectedCount
    || !value.scores.every((score) => typeof score === 'number' && Number.isFinite(score))) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'reranker.scores', 'reranker worker returned invalid scores'));
  }
  return ok(value.scores
    .map((score, index) => ({ index, score: score as number }))
    .sort((left, right) => right.score - left.score || left.index - right.index));
};

const safeInheritedEnvironment = (): NodeJS.ProcessEnv => {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'XDG_CACHE_HOME'];
  return Object.fromEntries(
    allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key] as string]]),
  );
};

const allowedWorkerEnvironment = new Set([
  'ACE_RERANKER_MODEL',
  'ACE_RERANKER_PYTHON',
  'ACE_RERANKER_THREADS',
  'FASTEMBED_CACHE_PATH',
  'HF_HOME',
  'HF_HUB_CACHE',
]);

const controlledWorkerEnvironment = (
  environment: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv => Object.fromEntries(
  Object.entries(environment ?? {}).filter(([key]) => allowedWorkerEnvironment.has(key)),
);

export const makeProcessRerankerPort = (options: ProcessRerankerOptions): ManagedRerankerPort => {
  const child: ChildProcessWithoutNullStreams = spawn(options.command, [...(options.args ?? [])], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...safeInheritedEnvironment(), ...controlledWorkerEnvironment(options.env) },
  });
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pending = new Map<number, PendingRequest>();
  const readyWaiters = new Set<(result: Result<RerankerWorkerIdentity, DomainError>) => void>();
  let nextId = 1;
  let stdoutBuffer = '';
  let failure: DomainError | undefined;
  let effectiveIdentity: Result<RerankerWorkerIdentity, DomainError> | undefined;

  const settleIdentity = (result: Result<RerankerWorkerIdentity, DomainError>): void => {
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
        failPending(domainError('INVALID_EXTERNAL_RESPONSE', 'reranker', 'reranker worker returned invalid JSON'));
        continue;
      }
      const response = typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded)
        ? decoded as RerankerResponse
        : undefined;
      if (response?.type === 'ready') {
        const parsed = parseIdentity(response.identity);
        if (parsed._tag === 'Ok' && options.expectedModel !== undefined
          && parsed.value.model !== options.expectedModel) {
          settleIdentity(err(domainError(
            'INVALID_EXTERNAL_RESPONSE',
            'reranker.identity',
            'reranker worker model does not match configured model',
          )));
        } else {
          settleIdentity(parsed);
        }
        continue;
      }
      const id = response?.id;
      if (response === undefined || typeof id !== 'number' || !Number.isSafeInteger(id)) {
        failPending(domainError('INVALID_EXTERNAL_RESPONSE', 'reranker', 'reranker worker response id is invalid'));
        continue;
      }
      const request = pending.get(id);
      if (request === undefined) continue;
      pending.delete(id);
      clearTimeout(request.timer);
      if (typeof response.error === 'string') {
        request.resolve(err(domainError('UNSUPPORTED_PROVIDER', 'reranker', response.error)));
      } else {
        request.resolve(scoresFromResponse(response, request.expectedCount));
      }
    }
  });

  child.stderr.on('data', () => undefined);
  child.on('error', () => failPending(domainError('UNSUPPORTED_PROVIDER', 'reranker', 'reranker worker failed to start')));
  child.on('exit', (code) => {
    if (failure === undefined) {
      failPending(domainError('UNSUPPORTED_PROVIDER', 'reranker', `reranker worker exited with code ${code ?? 'unknown'}`));
    }
  });

  const awaitIdentity = (): Effect.Effect<Result<RerankerWorkerIdentity, DomainError>> => {
    if (effectiveIdentity !== undefined) return Effect.succeed(effectiveIdentity);
    return Effect.async((resume) => {
      let waiter: (result: Result<RerankerWorkerIdentity, DomainError>) => void;
      const timer = setTimeout(() => {
        readyWaiters.delete(waiter);
        resume(Effect.succeed(err(domainError(
          'EXTERNAL_UNAVAILABLE',
          'reranker.identity',
          'reranker worker startup receipt timed out',
        ))));
      }, timeoutMs);
      waiter = (result): void => {
        clearTimeout(timer);
        resume(Effect.succeed(result));
      };
      readyWaiters.add(waiter);
    });
  };

  const rerank: RerankerPort['rerank'] = (input) => {
    const startedAtMs = Date.now();
    const operation = Effect.gen(function* () {
      if (input.query.trim().length === 0 || input.documents.length === 0
        || input.documents.some((document) => document.trim().length === 0)) {
        return err(domainError(
          'INVALID_INPUT',
          'reranker',
          'reranker query and documents must be non-empty',
        ));
      }
      const ready = yield* awaitIdentity();
      if (ready._tag === 'Err') return ready;
      return yield* Effect.async<Result<readonly RerankScore[], DomainError>>((resume) => {
        if (failure !== undefined || child.stdin.destroyed) {
          resume(Effect.succeed(err(
            failure ?? domainError('UNSUPPORTED_PROVIDER', 'reranker', 'reranker worker is unavailable'),
          )));
          return;
        }
        const id = nextId;
        nextId += 1;
        const timer = setTimeout(() => {
          pending.delete(id);
          resume(Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'reranker', 'reranker worker timed out'))));
        }, timeoutMs);
        pending.set(id, {
          expectedCount: input.documents.length,
          timer,
          resolve: (result) => resume(Effect.succeed(result)),
        });
        child.stdin.write(JSON.stringify({
          id,
          query: input.query,
          documents: input.documents,
        }) + '\n', (error) => {
          if (error !== undefined && error !== null) {
            clearTimeout(timer);
            pending.delete(id);
            resume(Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'reranker', 'reranker worker write failed'))));
          }
        });
      });
    });
    return Effect.map(operation, (result) => {
      const identity = effectiveIdentity?._tag === 'Ok' ? effectiveIdentity.value : undefined;
      providerTraceEvent(options.trace ?? noopProviderTrace, {
        provider: 'reranker',
        providerVersion: identity === undefined
          ? options.providerVersion ?? 'process-reranker/unknown'
          : `${identity.provider}|model=${identity.model}|runtime=${identity.runtimeBuild}@${identity.runtimeVersion}`,
        operation: 'rerank',
        status: result._tag === 'Ok' ? 'success' : 'failure',
        durationMs: Math.max(0, Date.now() - startedAtMs),
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        ...(result._tag === 'Err' ? { errorCode: result.error.code } : {}),
      });
      return result;
    });
  };

  return {
    rerank,
    probe: () => Effect.gen(function* () {
      const ready = yield* awaitIdentity();
      if (ready._tag === 'Err') return ready;
      const result = yield* rerank({ query: 'ace reranker probe', documents: ['relevant probe document'] });
      return result._tag === 'Err' ? result : ok(undefined);
    }),
    identity: () => effectiveIdentity?._tag === 'Ok' ? effectiveIdentity.value : undefined,
    close: () => {
      if (!child.killed) {
        failPending(domainError('EXTERNAL_UNAVAILABLE', 'reranker', 'reranker worker closed'));
        child.kill('SIGTERM');
      }
    },
  };
};
