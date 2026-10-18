import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { HttpPort } from '../application/ports.js';

export interface VectorEmbeddingPort {
  readonly embedMany: (input: readonly string[]) => Effect.Effect<Result<readonly (readonly number[])[], DomainError>>;
}

export interface OllamaEmbeddingConfig {
  readonly endpoint: string;
  readonly model: string;
  readonly http: HttpPort;
}

const parseEmbeddings = (value: unknown, count: number): Result<readonly (readonly number[])[], DomainError> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'ollama', 'embedding response must be an object'));
  }
  const vectors = (value as Record<string, unknown>).embeddings;
  if (!Array.isArray(vectors) || vectors.length !== count || count === 0) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'ollama', 'embedding count does not match inputs'));
  }
  const result: number[][] = [];
  let dimension = 0;
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length === 0 || !vector.every((element) => typeof element === 'number' && Number.isFinite(element))) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'ollama', 'embedding contains invalid vector values'));
    }
    if (dimension !== 0 && vector.length !== dimension) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'ollama', 'inconsistent embedding dimensions'));
    }
    dimension = vector.length;
    result.push(vector as number[]);
  }
  return ok(result);
};

/** Real local Ollama /api/embed model inference: never a hash-based pseudo embedding. */
export const makeOllamaEmbeddingPort = (config: OllamaEmbeddingConfig): VectorEmbeddingPort => ({
  embedMany: (input) => Effect.gen(function* () {
    if (input.length === 0 || input.some((text) => text.trim().length === 0)) {
      return err(domainError('INVALID_INPUT', 'embedding_text', 'embedding batch must contain nonempty strings'));
    }
    const response = yield* config.http.request({
      method: 'POST',
      url: config.endpoint.replace(/\/$/u, '') + '/api/embed',
      body: { model: config.model, input: input.length === 1 ? input[0] : [...input] },
      timeoutMs: 120_000,
    });
    if (response._tag === 'Err') return response;
    if (response.value.status < 200 || response.value.status >= 300) {
      return err(domainError('EXTERNAL_UNAVAILABLE', 'ollama', 'local embedding inference failed: HTTP ' + response.value.status));
    }
    return parseEmbeddings(response.value.body, input.length);
  }),
});
