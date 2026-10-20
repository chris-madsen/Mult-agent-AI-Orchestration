import { mkdir, readFile, readdir, rename, rmdir, writeFile } from 'node:fs/promises';
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
    && ['pending', 'projected', 'incomplete', 'dead_letter', 'tombstoned'].includes(String(receipt.status))
    && typeof receipt.attempts === 'number' && Number.isSafeInteger(receipt.attempts) && receipt.attempts >= 0
    && (receipt.totalAttempts === undefined
      || typeof receipt.totalAttempts === 'number' && Number.isSafeInteger(receipt.totalAttempts) && receipt.totalAttempts >= receipt.attempts)
    && (receipt.nextAttemptAtMs === undefined
      || typeof receipt.nextAttemptAtMs === 'number' && Number.isSafeInteger(receipt.nextAttemptAtMs) && receipt.nextAttemptAtMs >= 0)
    && (receipt.lastErrorCode === undefined
      || typeof receipt.lastErrorCode === 'string' && receipt.lastErrorCode.trim().length > 0)
    && (receipt.deadLetteredAtMs === undefined
      || typeof receipt.deadLetteredAtMs === 'number' && Number.isSafeInteger(receipt.deadLetteredAtMs) && receipt.deadLetteredAtMs >= 0)
    && (receipt.manualRepairCount === undefined
      || typeof receipt.manualRepairCount === 'number' && Number.isSafeInteger(receipt.manualRepairCount) && receipt.manualRepairCount >= 0);
};

export const makeFileProjectionOutbox = async (rootPath: string): Promise<ProjectionOutboxPort> => {
  await mkdir(rootPath, { recursive: true });
  const deletionRoot = join(rootPath, 'deletions');
  await mkdir(deletionRoot, { recursive: true });
  const pathFor = (key: string): string => join(rootPath, `${Buffer.from(key).toString('base64url')}.json`);
  const deletionPathFor = (episodeId: EpisodeId): string => join(deletionRoot, `${Buffer.from(episodeId).toString('base64url')}.json`);
  const lockPath = join(rootPath, '.projection-outbox.lock');
  const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, milliseconds); });

  const withLock = async <T>(operation: () => Promise<Result<T, DomainError>>): Promise<Result<T, DomainError>> => {
    let acquired = false;
    for (let attempt = 0; attempt < 667; attempt += 1) {
      try {
        await mkdir(lockPath);
        acquired = true;
        break;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') {
          return err(domainError('PERSISTENCE_FAILED', 'projection_outbox', 'could not acquire projection outbox fence'));
        }
        await sleep(30);
      }
    }
    if (!acquired) {
      return err(domainError('PERSISTENCE_FAILED', 'projection_outbox', 'projection outbox fence remained held; refusing an unsafe mutation'));
    }
    let result: Result<T, DomainError>;
    try {
      result = await operation();
    } catch {
      result = err(domainError('PERSISTENCE_FAILED', 'projection_outbox', 'projection outbox mutation failed'));
    }
    try {
      await rmdir(lockPath);
    } catch {
      return err(domainError('PERSISTENCE_FAILED', 'projection_outbox', 'could not release projection outbox fence'));
    }
    return result;
  };

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

  type DeletionStatus = 'deleting' | 'tombstoned';
  const readDeletion = async (episodeId: EpisodeId): Promise<Result<DeletionStatus | undefined, DomainError>> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(deletionPathFor(episodeId), 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
        || (parsed as { episodeId?: unknown }).episodeId !== episodeId
        || !['deleting', 'tombstoned'].includes(String((parsed as { status?: unknown }).status))) {
        return err(domainError('PERSISTENCE_FAILED', 'projection_deletion', 'projection deletion fence on disk is invalid'));
      }
      return ok((parsed as { status: DeletionStatus }).status);
    } catch (cause) {
      return (cause as NodeJS.ErrnoException).code === 'ENOENT'
        ? ok(undefined)
        : err(domainError('PERSISTENCE_FAILED', 'projection_deletion', 'could not read projection deletion fence'));
    }
  };

  const writeDeletion = async (episodeId: EpisodeId, status: DeletionStatus): Promise<Result<void, DomainError>> => {
    const path = deletionPathFor(episodeId);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ episodeId, status }), { flag: 'wx' });
      await rename(temporary, path);
      return ok(undefined);
    } catch {
      return err(domainError('PERSISTENCE_FAILED', 'projection_deletion', 'could not atomically persist projection deletion fence'));
    }
  };

  const putUnlocked = async (receipt: ProjectionReceipt): Promise<Result<void, DomainError>> => {
    if (!validReceipt(receipt)) {
      return err(domainError('INVALID_MEMORY', 'projection_receipt', 'cannot persist an invalid projection receipt'));
    }
    const deletion = await readDeletion(receipt.episodeId);
    if (deletion._tag === 'Err') return deletion;
    if (deletion.value !== undefined && receipt.status !== 'tombstoned') {
      return err(domainError('ARCHIVE_TOMBSTONED', 'projection_outbox', 'deletion fence rejects a stale projection receipt'));
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
      return withLock(async () => {
        const deletion = await readDeletion(episodeId);
        if (deletion._tag === 'Err') return deletion;
        if (deletion.value !== undefined) {
          return err(domainError('ARCHIVE_TOMBSTONED', 'projection_outbox', 'projection is fenced by episode deletion'));
        }
        const candidate = beginProjection([], episodeId, extractorVersion);
        if (candidate._tag === 'Err') return candidate;
        const existing = await read(pathFor(candidate.value.key));
        if (existing._tag === 'Err') return existing;
        if (existing.value !== undefined) return ok(existing.value);
        const persisted = await putUnlocked(candidate.value);
        return persisted._tag === 'Err' ? persisted : ok(candidate.value);
      });
    },
    put: (receipt) => withLock(() => putUnlocked(receipt)),
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
    beginDeletion: (episodeId) => withLock(async () => {
      const existing = await readDeletion(episodeId);
      if (existing._tag === 'Err') return existing;
      if (existing.value !== undefined) return ok(undefined);
      return writeDeletion(episodeId, 'deleting');
    }),
    finalizeDeletion: (episodeId) => withLock(async () => {
      const existing = await readDeletion(episodeId);
      if (existing._tag === 'Err') return existing;
      if (existing.value === undefined) {
        return err(domainError('PERSISTENCE_FAILED', 'projection_deletion', 'cannot finalize an unstarted projection deletion'));
      }
      return writeDeletion(episodeId, 'tombstoned');
    }),
    isDeletionBlocked: async (episodeId) => {
      const status = await readDeletion(episodeId);
      return status._tag === 'Err' ? status : ok(status.value !== undefined);
    },
  };
};
