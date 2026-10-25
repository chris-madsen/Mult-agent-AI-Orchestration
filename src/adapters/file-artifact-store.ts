import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { DomainError } from '../domain/errors.js';
import { makeContentDigest } from '../domain/workspace.js';
import type { ArtifactRange, ArtifactReference, ArtifactStore } from '../application/ports.js';
import { recoverResult } from '../application/effect-result.js';

const handlePattern = /^[0-9a-f-]{36}$/;

const nodeErrorCode = (cause: unknown): string | undefined => {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined;
  const code = cause.code;
  return typeof code === 'string' ? code : undefined;
};

const digest = (bytes: Uint8Array) => makeContentDigest(createHash('sha256').update(bytes).digest('hex'));

export const makeFileArtifactStore = (directory: string): ArtifactStore => ({
  storeExact: (bytes) =>
    recoverResult(Effect.tryPromise<Result<ArtifactReference, DomainError>, DomainError>({
      try: async () => {
        const handle = randomUUID();
        await mkdir(directory, { recursive: true });
        const temporaryPath = join(directory, `${handle}.tmp`);
        const artifactPath = join(directory, `${handle}.bin`);
        await writeFile(temporaryPath, bytes);
        await rename(temporaryPath, artifactPath);
        const contentDigest = digest(bytes);
        return contentDigest._tag === 'Ok'
          ? ok({ handle, digest: contentDigest.value, sizeBytes: bytes.byteLength })
          : contentDigest;
      },
      catch: () => domainError('PERSISTENCE_FAILED', 'artifact', 'exact artifact could not be stored'),
    })),
  readRange: (handle, cursor, maxBytes) =>
    recoverResult(Effect.tryPromise<Result<ArtifactRange, DomainError>, DomainError>({
      try: async () => {
        if (!handlePattern.test(handle)) return err(domainError('INVALID_HANDLE', 'handle', 'artifact handle is invalid'));
        if (cursor !== undefined && !/^(?:0|[1-9][0-9]*)$/u.test(cursor)) {
          return err(domainError('INVALID_HANDLE', 'cursor', 'artifact cursor must be a canonical decimal byte offset'));
        }
        const offset = cursor === undefined ? 0 : Number(cursor);
        if (!Number.isSafeInteger(offset) || offset < 0) return err(domainError('INVALID_HANDLE', 'cursor', 'artifact cursor is invalid'));
        const bytes = new Uint8Array(await readFile(join(directory, `${handle}.bin`)));
        const contentDigest = digest(bytes);
        if (contentDigest._tag === 'Err') return contentDigest;
        if (offset > bytes.byteLength) return err(domainError('INVALID_HANDLE', 'cursor', 'artifact cursor exceeds artifact size'));
        const pageSize = maxBytes === undefined ? bytes.byteLength : maxBytes;
        if (!Number.isSafeInteger(pageSize) || pageSize < 1) return err(domainError('INVALID_INPUT', 'max_bytes', 'max_bytes must be positive'));
        const end = Math.min(offset + pageSize, bytes.byteLength);
        return ok({
          bytes: bytes.subarray(offset, end),
          digest: contentDigest.value,
          offset,
          totalBytes: bytes.byteLength,
          ...(end < bytes.byteLength ? { nextCursor: String(end) } : {}),
        });
      },
      catch: (cause) => nodeErrorCode(cause) === 'ENOENT'
        ? domainError('ARTIFACT_NOT_FOUND', 'handle', 'artifact handle is not available')
        : domainError('PERSISTENCE_FAILED', 'artifact', 'exact artifact could not be read'),
    })),
});
