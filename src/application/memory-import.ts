import { Effect } from 'effect';
import { admitMemoryEpisode, defaultMemoryAdmissionPolicy, type MemoryAdmission, type MemoryAdmissionPolicy } from '../domain/memory-admission.js';
import { domainError, type DomainError, type DomainErrorCode } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { EpisodeId, SessionEpisode } from '../domain/memory.js';
import type { GraphProjectionPort, MemoryArchivePort } from './ports.js';

export interface ProjectionSession {
  readonly projection: GraphProjectionPort;
  readonly close: () => Promise<void>;
}

export interface MemoryImportOutcome {
  readonly episodeId: EpisodeId;
  /** True only when this import created a new immutable archive record. */
  readonly persisted: boolean;
  readonly admission: MemoryAdmission;
  readonly projectionStatus?: 'pending' | 'projected' | 'incomplete' | 'tombstoned';
  readonly projectionErrorCode?: DomainErrorCode;
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

interface ArchivedEpisode {
  readonly episode: SessionEpisode;
  readonly created: boolean;
  readonly admission: MemoryAdmission;
}

/**
 * Two-phase import:
 * 1. archive every original episode first;
 * 2. only then attempt the derived Graphiti projection.
 *
 * A Graphiti/extractor outage must never prevent later originals from reaching
 * the immutable archive. Projection failures are reported as incomplete
 * outcomes and may be retried idempotently later.
 */
export const importMemoryEpisodes = async (input: MemoryImportInput): Promise<Result<readonly MemoryImportOutcome[], DomainError>> => {
  const policy = input.admissionPolicy ?? defaultMemoryAdmissionPolicy;
  const archived: ArchivedEpisode[] = [];

  // Phase 1: source truth first. Any archive failure is fatal because ACE cannot
  // honestly claim the original history was preserved.
  for (const episode of input.episodes) {
    const saved = await input.archive.importEpisode(episode);
    if (saved._tag === 'Err') return saved;
    archived.push({
      episode,
      created: saved.value.created,
      admission: admitMemoryEpisode(episode, policy),
    });
  }

  const outcomes: MemoryImportOutcome[] = [];
  let session: ProjectionSession | undefined;
  let projectionUnavailable: DomainError | undefined;

  try {
    for (const item of archived) {
      const { episode, created, admission } = item;
      if (admission.kind === 'archive_only') {
        outcomes.push({ episodeId: episode.episodeId, persisted: created, admission });
        continue;
      }

      if (projectionUnavailable !== undefined) {
        outcomes.push({
          episodeId: episode.episodeId,
          persisted: created,
          admission,
          projectionStatus: 'incomplete',
          projectionErrorCode: projectionUnavailable.code,
        });
        continue;
      }

      if (session === undefined) {
        try {
          session = await input.createProjection();
        } catch (cause) {
          projectionUnavailable = errorFrom(cause, 'graphiti', 'Graphiti projection session could not start');
          outcomes.push({
            episodeId: episode.episodeId,
            persisted: created,
            admission,
            projectionStatus: 'incomplete',
            projectionErrorCode: projectionUnavailable.code,
          });
          continue;
        }
      }

      const projected = await Effect.runPromise(session.projection.project({
        episodeId: episode.episodeId,
        occurredAtMs: episode.occurredAtMs,
        extractorVersion: input.extractorVersion,
        claims: [{
          original_digest: episode.contentDigest,
          text: episode.searchText,
          original_pointer: episode.sourcePointer,
        }],
      }));
      if (projected._tag === 'Err') {
        outcomes.push({
          episodeId: episode.episodeId,
          persisted: created,
          admission,
          projectionStatus: 'incomplete',
          projectionErrorCode: projected.error.code,
        });
        continue;
      }
      outcomes.push({
        episodeId: episode.episodeId,
        persisted: created,
        admission,
        projectionStatus: projected.value.status,
      });
    }
  } finally {
    if (session !== undefined) {
      try {
        await session.close();
      } catch (cause) {
        return err(errorFrom(cause, 'graphiti', 'Graphiti session close failed'));
      }
    }
  }

  return ok(outcomes);
};
