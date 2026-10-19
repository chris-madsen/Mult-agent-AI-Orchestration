import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { beginProjection, type EpisodeId, type ProjectionReceipt } from '../domain/memory.js';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { ProjectionOutboxPort } from '../application/ports.js';

const validReceipt = (value: unknown): value is ProjectionReceipt => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const receipt = value as Partial<ProjectionReceipt>;
  return typeof receipt.key === 'string' && receipt.key.length > 0
    && typeof receipt.episodeId === 'string' && receipt.episodeId.length > 0
    && typeof receipt.extractorVersion === 'string' && receipt.extractorVersion.trim().length > 0
    && ['pending', 'projected', 'incomplete', 'tombstoned'].includes(String(receipt.status))
    && typeof receipt.attempts === 'number' && Number.isSafeInteger(receipt.attempts) && receipt.attempts >= 0;
};

export const makeFileProjectionOutbox = async (rootPath: string): Promise<ProjectionOutboxPort> => {
  await mkdir(rootPath, { recursive: true });
  const pathFor = (key: string): string => join(rootPath, `${Buffer.from(key).toString('base64url')}.json`);

  const read = async (path: string): Promise<Result<ProjectionReceipt | undefined, DomainError>> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      return validReceipt(parsed)
        ? ok(parsed)
        : err(domainError('PERSISTENCE_FAILED', 'projection_outbox', 'projection receipt on disk is invalid'));
    } catch (cause) {
      return (cause as NodeJS.ErrnoException).code === 'ENOENT'
        ? ok(undefined)
        : err(domainError('PERSISTENCE_FAILED', 'projection_outbox', 'could not read projection receipt'));
    }
  };

  const put = async (receipt: ProjectionReceipt): Promise<Result<void, DomainError>> => {
    if (!validReceipt(receipt)) {
      return err(domainError('INVALID_MEMORY', 'projection_receipt', 'cannot persist an invalid projection receipt'));
    }
    const path = pathFor(receipt.key);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(receipt), { flag: 'wx' });
      await rename(temporary, path);
      return ok(undefined);
    } catch {
      return err(domainError('PERSISTENCE_FAILED', 'projection_outbox', 'could not atomically persist projection receipt'));
    }
  };

  return {
    begin: async (episodeId: EpisodeId, extractorVersion: string) => {
      const candidate = beginProjection([], episodeId, extractorVersion);
      if (candidate._tag === 'Err') return candidate;
      const existing = await read(pathFor(candidate.value.key));
      if (existing._tag === 'Err') return existing;
      if (existing.value !== undefined) return ok(existing.value);
      const persisted = await put(candidate.value);
      return persisted._tag === 'Err' ? persisted : ok(candidate.value);
    },
    put,
    get: (key) => read(pathFor(key)),
    list: async () => {
      try {
        const entries = (await readdir(rootPath)).filter((entry) => entry.endsWith('.json')).sort();
        const receipts: ProjectionReceipt[] = [];
        for (const entry of entries) {
          const receipt = await read(join(rootPath, entry));
          if (receipt._tag === 'Err') return receipt;
          if (receipt.value !== undefined) receipts.push(receipt.value);
        }
        return ok(receipts);
      } catch {
        return err(domainError('PERSISTENCE_FAILED', 'projection_outbox', 'could not enumerate projection receipts'));
      }
    },
  };
};
