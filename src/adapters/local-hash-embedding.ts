import { createHash } from 'node:crypto';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  readonly embed: (text: string) => Result<readonly number[], ReturnType<typeof domainError>>;
}

export interface LocalHashEmbeddingOptions {
  readonly dimensions?: number;
}

const validDimensions = (value: number): boolean => Number.isSafeInteger(value) && value >= 8 && value <= 4096;

const digestBytes = (text: string): Uint8Array => createHash('sha256').update(text, 'utf8').digest();

const normalize = (values: readonly number[]): readonly number[] => {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + (value * value), 0));
  return magnitude === 0 ? values : values.map((value) => value / magnitude);
};

export const makeLocalHashEmbedding = (options: LocalHashEmbeddingOptions = {}): Result<EmbeddingProvider, ReturnType<typeof domainError>> => {
  const dimensions = options.dimensions ?? 64;
  if (!validDimensions(dimensions)) return err(domainError('INVALID_RETRIEVAL', 'embedding_dimensions', 'local embedding dimensions must be an integer between 8 and 4096'));
  return ok({
    name: 'local_sha256_projection_v1',
    dimensions,
    embed: (text) => {
      if (text.trim().length === 0) return err(domainError('INVALID_RETRIEVAL', 'embedding_text', 'embedding text must not be empty'));
      const values = Array.from({ length: dimensions }, (_, index) => {
        const bytes = digestBytes(`${index}:${text}`);
        const bucket = bytes[index % bytes.length] ?? 0;
        return (bucket / 127.5) - 1;
      });
      return ok(normalize(values));
    },
  });
};
