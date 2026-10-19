import { Effect } from 'effect';
import { admitMemoryEpisode, defaultMemoryAdmissionPolicy, type MemoryAdmission, type MemoryAdmissionPolicy } from '../domain/memory-admission.js';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { EpisodeId, SessionEpisode } from '../domain/memory.js';
import type { GraphProjectionPort, MemoryArchivePort } from './ports.js';

export interface ProjectionSession {
  readonly projection: GraphProjectionPort;
  readonly close: () => Promise<void>;
}

export interface MemoryImportOutcome {
  readonly episodeId: EpisodeId;
  readonly persisted: boolean;
  readonly admission: MemoryAdmission;
  readonly projectionStatus?: 'pending' | 'projected' | 'incomplete' | 'tombstoned';
}

export interface MemoryImportInput {
  readonly episodes: readonly SessionEpisode[];
  readonly archive: MemoryArchivePort;
  readonly createProjection: () => Promise<ProjectionSession>;
  readonly extractorVersion: string;
  readonly admissionPolicy?: MemoryAdmissionPolicy;
}

const errorFrom = (cause: unknown, path: string, message: string): DomainError =>
  domainError('EXTERNAL_UNAVAILABLE', path, cause instanceof Error ? `${message}: ${cause.message}` : message);

/** Archives every episode, but lazily projects only admitted durable memory. */
export const importMemoryEpisodes = async (input: MemoryImportInput): Promise<Result<readonly MemoryImportOutcome[], DomainError>> => {
  let session: ProjectionSession | undefined;
  const outcomes: MemoryImportOutcome[] = [];
  const policy = input.admissionPolicy ?? defaultMemoryAdmissionPolicy;
  let failure: DomainError | undefined;
  try {
    for (const episode of input.episodes) {
      const saved = await input.archive.importEpisode(episode);
      if (saved._tag === 'Err') {
        failure = saved.error;
        break;
      }
      const admission = admitMemoryEpisode(episode, policy);
      if (admission.kind === 'archive_only') {
        outcomes.push({ episodeId: episode.episodeId, persisted: saved.value.created, admission });
        continue;
      }
      session ??= await input.createProjection();
      const projected = await Effect.runPromise(session.projection.project({
        episodeId: episode.episodeId,
        extractorVersion: input.extractorVersion,
        claims: [{ original_digest: episode.contentDigest, text: episode.searchText, original_pointer: episode.sourcePointer }],
      }));
      if (projected._tag === 'Err') {
        failure = projected.error;
        break;
      }
      outcomes.push({ episodeId: episode.episodeId, persisted: saved.value.created, admission, projectionStatus: projected.value.status });
    }
  } catch (cause) {
    failure = errorFrom(cause, 'memory_import', 'memory import failed');
  } finally {
    if (session !== undefined) {
      try {
        await session.close();
      } catch (cause) {
        failure ??= errorFrom(cause, 'graphiti', 'Graphiti session close failed');
      }
    }
  }
  return failure === undefined ? ok(outcomes) : err(failure);
};
