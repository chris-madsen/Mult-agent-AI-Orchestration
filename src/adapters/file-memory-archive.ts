import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

  return {
    importEpisode: async (episode) => {
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
    },
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
        return ok({ ...metadata, content });
      } catch (error) {
        return isMissing(error) ? missing(`episode:${episodeId}`) : err(domainError('PERSISTENCE_FAILED', 'archive', 'could not read episode'));
      }
    },
    deleteEpisode: async (episodeId) => {
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
      await rm(metadataPath(episodeId), { force: true });
      await rm(contentPath(existing.contentDigest), { force: true });
      await writeFile(tombstonePath(episodeId), JSON.stringify({ episodeId, deletedAtMs: Date.now() }), { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      return ok(undefined);
    },
  };
};
