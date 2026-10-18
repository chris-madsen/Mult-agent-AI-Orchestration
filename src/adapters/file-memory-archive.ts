import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { ContentDigest } from '../domain/workspace.js';
import { makeEpisode, type EpisodeId, type SessionEpisode } from '../domain/memory.js';

const digestOf = (bytes: Uint8Array): ContentDigest => createHash('sha256').update(bytes).digest('hex') as ContentDigest;

export interface AsyncMemoryArchivePort {
  readonly importEpisode: (episode: SessionEpisode) => Promise<Result<{ readonly created: boolean; readonly episode: SessionEpisode }, ReturnType<typeof domainError>>>;
  readonly readEpisode: (episodeId: EpisodeId) => Promise<Result<SessionEpisode, ReturnType<typeof domainError>>>;
  readonly deleteEpisode: (episodeId: EpisodeId) => Promise<Result<void, ReturnType<typeof domainError>>>;
}

export const makeAsyncFileMemoryArchive = async (rootPath: string): Promise<AsyncMemoryArchivePort> => {
  const episodesPath = join(rootPath, 'episodes');
  const tombstonesPath = join(rootPath, 'tombstones');
  await mkdir(episodesPath, { recursive: true });
  await mkdir(tombstonesPath, { recursive: true });
  const metadataPath = (id: EpisodeId) => join(episodesPath, `${id}.json`);
  const contentPath = (digest: ContentDigest) => join(episodesPath, `${digest}.bin`);
  const tombstonePath = (id: EpisodeId) => join(tombstonesPath, `${id}.json`);
  const missing = (path: string) => err(domainError('FILE_NOT_FOUND', path, 'archive episode not found'));
  const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';
  // Cross-process mkdir mutex: never steal an ambiguous stale lock (fail closed).
  // For distributed/multi-host operation use a transactional DB or leader lease.
  let tail: Promise<void> = Promise.resolve();
  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const current = tail.then(() => withProcessLock(operation), () => withProcessLock(operation));
    tail = current.then(() => undefined, () => undefined);
    return current;
  };
  const lockPath = join(rootPath, '.archive-write.lock');
  const withProcessLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const deadline = Date.now() + 20_000;
    while (true) {
      try {
        await mkdir(lockPath);
        break;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
        if (Date.now() >= deadline) throw new Error('archive lock contention: operator must inspect stale lock');
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
      }
    }
    try {
      return await operation();
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  };
  const hasOtherReference = async (digest: ContentDigest): Promise<boolean> => {
    const entries = await readdir(episodesPath);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const metadata = JSON.parse(await readFile(join(episodesPath, entry), 'utf8')) as { contentDigest?: string };
      if (metadata.contentDigest === digest) return true;
    }
    return false;
  };

  return {
    importEpisode: (episode) => exclusive(async () => {
      const checked = makeEpisode(episode);
      if (checked._tag === 'Err') return checked;
      const actualDigest = digestOf(checked.value.content);
      if (actualDigest !== checked.value.contentDigest) return err(domainError('DIGEST_MISMATCH', 'episode', 'episode bytes do not match declared digest'));
      try {
        await readFile(tombstonePath(checked.value.episodeId));
        return err(domainError('ARCHIVE_TOMBSTONED', 'episode', 'tombstoned episode cannot be re-imported'));
      } catch (error) {
        if (!isMissing(error)) return err(domainError('PERSISTENCE_FAILED', 'archive', 'could not inspect tombstone'));
      }
      try {
        const existing = JSON.parse(await readFile(metadataPath(checked.value.episodeId), 'utf8')) as Omit<SessionEpisode, 'content'>;
        const bytes = new Uint8Array(await readFile(contentPath(existing.contentDigest)));
        if (existing.contentDigest !== checked.value.contentDigest || digestOf(bytes) !== existing.contentDigest) {
          return err(domainError('DIGEST_MISMATCH', 'episode', 'reimport conflicts with immutable original content'));
        }
        return ok({ created: false, episode: { ...existing, content: bytes } });
      } catch (error) {
        if (!isMissing(error)) return err(domainError('PERSISTENCE_FAILED', 'archive', 'could not read existing episode'));
      }
      await writeFile(contentPath(checked.value.contentDigest), checked.value.content, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      const serializable = { ...checked.value, content: undefined };
      await writeFile(metadataPath(checked.value.episodeId), JSON.stringify(serializable), { flag: 'wx' });
      return ok({ created: true, episode: checked.value });
    }),
    readEpisode: async (episodeId) => {
      try {
        await readFile(tombstonePath(episodeId));
        return err(domainError('ARCHIVE_TOMBSTONED', 'episode', 'episode was deleted'));
      } catch (error) {
        if (!isMissing(error)) return err(domainError('PERSISTENCE_FAILED', 'archive', 'could not inspect tombstone'));
      }
      try {
        const metadata = JSON.parse(await readFile(metadataPath(episodeId), 'utf8')) as Omit<SessionEpisode, 'content'>;
        const content = new Uint8Array(await readFile(contentPath(metadata.contentDigest)));
        if (digestOf(content) !== metadata.contentDigest) {
          return err(domainError('DIGEST_MISMATCH', 'episode', 'original archive bytes failed SHA-256 verification'));
        }
        return ok({ ...metadata, content });
      } catch (error) {
        return isMissing(error) ? missing(`episode:${episodeId}`) : err(domainError('PERSISTENCE_FAILED', 'archive', 'could not read episode'));
      }
    },
    deleteEpisode: (episodeId) => exclusive(async () => {
      const existing = await (async () => {
        try {
          return JSON.parse(await readFile(metadataPath(episodeId), 'utf8')) as Omit<SessionEpisode, 'content'>;
        } catch (error) {
          return isMissing(error) ? undefined : null;
        }
      })();
      if (existing === null) return err(domainError('PERSISTENCE_FAILED', 'archive', 'could not read episode metadata'));
      if (existing === undefined) {
        try { await readFile(tombstonePath(episodeId)); return ok(undefined); } catch (error) {
          return isMissing(error) ? missing(`episode:${episodeId}`) : err(domainError('PERSISTENCE_FAILED', 'archive', 'could not inspect tombstone'));
        }
      }
      try {
        // Tombstone BEFORE removing any blob: a crashed delete cannot resurrect an episode.
        await writeFile(tombstonePath(episodeId), JSON.stringify({ episodeId, deletedAtMs: Date.now() }), { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        });
        await rm(metadataPath(episodeId), { force: true });
        // Content addressing permits multiple episodes to point to one blob.
        // Delete bytes only when the last metadata reference disappears.
        if (!await hasOtherReference(existing.contentDigest)) {
          await rm(contentPath(existing.contentDigest), { force: true });
        }
        return ok(undefined);
      } catch {
        return err(domainError('PERSISTENCE_FAILED', 'archive', 'could not safely delete episode'));
      }
    }),
  };
};
