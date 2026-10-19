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
}

interface PendingRequest {
  readonly expectedCount: number;
  readonly resolve: (result: Result<readonly (readonly number[])[], DomainError>) => void;
  readonly timer: NodeJS.Timeout;
}

export interface ProcessEmbeddingOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly dimension: number;
  readonly timeoutMs?: number;
  readonly providerVersion?: string;
  readonly trace?: ProviderTraceSink;
}

export interface ManagedVectorEmbeddingPort extends VectorEmbeddingPort {
  readonly close: () => void;
  readonly probe: () => Effect.Effect<Result<void, DomainError>>;
}

const providerError = (message: string): Result<never, DomainError> =>
  err(domainError('UNSUPPORTED_PROVIDER', 'embedding', message));

const responseObject = (value: unknown): EmbeddingResponse | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as EmbeddingResponse
    : undefined;

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

/**
 * Process boundary for a maintained local embedding runtime. The child keeps
 * the model loaded and accepts newline-delimited JSON requests, so indexing
 * batches do not reload the model for every call.
 */
export const makeProcessEmbeddingPort = (options: ProcessEmbeddingOptions): ManagedVectorEmbeddingPort => {
  const child: ChildProcessWithoutNullStreams = spawn(options.command, [...(options.args ?? [])], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map<number, PendingRequest>();
  const timeoutMs = options.timeoutMs ?? 120_000;
  let nextId = 1;
  let stdoutBuffer = '';
  let failure: DomainError | undefined;

  const failPending = (error: DomainError): void => {
    failure = error;
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
      const id = response?.id;
      if (response === undefined || typeof id !== 'number' || !Number.isSafeInteger(id)) {
        failPending(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding', 'embedding worker response id is invalid'));
        continue;
      }
      const request = pending.get(id);
      if (request === undefined) continue;
      pending.delete(id);
      clearTimeout(request.timer);
      if (typeof response.error === 'string') {
        request.resolve(providerError(response.error));
      } else {
        request.resolve(vectorsFromResponse(response, request.expectedCount, options.dimension));
      }
    }
  });
  child.stderr.on('data', () => undefined);

  child.on('error', () => failPending(domainError('UNSUPPORTED_PROVIDER', 'embedding', 'embedding worker failed to start')));
  child.on('exit', (code) => {
    if (failure === undefined) failPending(domainError('UNSUPPORTED_PROVIDER', 'embedding', `embedding worker exited with code ${code ?? 'unknown'}`));
  });

  const embedMany = (input: readonly string[], requestId?: string): Effect.Effect<Result<readonly (readonly number[])[], DomainError>> => {
    const startedAtMs = Date.now();
    const operation: Effect.Effect<Result<readonly (readonly number[])[], DomainError>> = Effect.async((resume) => {
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
      pending.set(id, {
        expectedCount: input.length,
        timer,
        resolve: (result) => resume(Effect.succeed(result)),
      });
      child.stdin.write(JSON.stringify({ id, texts: input }) + '\n', (error) => {
        if (error !== undefined && error !== null) {
          clearTimeout(timer);
          pending.delete(id);
          resume(Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'embedding', 'embedding worker write failed'))));
        }
      });
    });
    return Effect.map(operation, (result) => {
      providerTraceEvent(options.trace ?? noopProviderTrace, {
        provider: 'embedding',
        providerVersion: options.providerVersion ?? 'process-worker/unknown',
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

  const probe = (): Effect.Effect<Result<void, DomainError>> => Effect.map(
    embedMany(['ace_embedding_provider_probe']),
    (result) => result._tag === 'Err' ? result : ok(undefined),
  );

  const close = (): void => {
    if (!child.killed) {
      failPending(domainError('EXTERNAL_UNAVAILABLE', 'embedding', 'embedding worker closed'));
      child.kill('SIGTERM');
    }
  };

  return { embedMany, close, probe };
};
