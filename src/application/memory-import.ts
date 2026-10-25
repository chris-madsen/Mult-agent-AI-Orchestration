import { Effect } from 'effect';
import { admitMemoryEpisode, defaultMemoryAdmissionPolicy, type MemoryAdmission, type MemoryAdmissionPolicy } from '../domain/memory-admission.js';
import { domainError, type DomainError, type DomainErrorCode } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  defaultProjectionRetryPolicy,
  recordProjectionEnqueue,
  scheduleProjectionRetry,
  type EpisodeId,
  type ProjectionReceipt,
  type ProjectionRetryPolicy,
  type ProjectionStatus,
  type SessionEpisode,
} from '../domain/memory.js';
import type { GraphProjectionPort, MemoryArchivePort, ProjectionOutboxPort } from './ports.js';

export interface ProjectionSession {
  readonly projection: GraphProjectionPort;
  readonly close: () => Promise<void>;
}

export interface MemoryImportOutcome {
  readonly episodeId: EpisodeId;
  /** True only when this import created a new immutable archive record. */
  readonly persisted: boolean;
  readonly admission: MemoryAdmission;
  readonly projectionStatus?: ProjectionStatus;
  readonly projectionErrorCode?: DomainErrorCode;
}

export interface MemoryImportInput {
  readonly episodes: readonly SessionEpisode[];
  readonly archive: MemoryArchivePort;
  readonly createProjection: () => Promise<ProjectionSession>;
  readonly extractorVersion: string;
  readonly admissionPolicy?: MemoryAdmissionPolicy;
  readonly outbox?: ProjectionOutboxPort;
  readonly retryPolicy?: ProjectionRetryPolicy;
  readonly nowMs?: () => number;
  readonly verificationDelayMs?: number;
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
  const retryPolicy = input.retryPolicy ?? defaultProjectionRetryPolicy;
  const nowMs = input.nowMs ?? Date.now;
  const verificationDelayMs = input.verificationDelayMs ?? retryPolicy.baseDelayMs;
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

      let queued: ProjectionReceipt | undefined;
      if (input.outbox !== undefined) {
        const begun = await input.outbox.begin(episode.episodeId, input.extractorVersion);
        if (begun._tag === 'Err') return begun;
        queued = begun.value;
        if (queued.status === 'projected' || queued.status === 'tombstoned' || queued.status === 'dead_letter') {
          outcomes.push({
            episodeId: episode.episodeId,
            persisted: created,
            admission,
            projectionStatus: queued.status,
          });
          continue;
        }
      }

      if (projectionUnavailable !== undefined) {
        if (queued !== undefined && input.outbox !== undefined) {
          const incomplete = scheduleProjectionRetry(queued, nowMs(), projectionUnavailable.code, retryPolicy);
          if (incomplete._tag === 'Err') return incomplete;
          const stored = await input.outbox.put(incomplete.value);
          if (stored._tag === 'Err') return stored;
          queued = incomplete.value;
        }
        outcomes.push({
          episodeId: episode.episodeId,
          persisted: created,
          admission,
          projectionStatus: queued?.status ?? 'incomplete',
          projectionErrorCode: projectionUnavailable.code,
        });
        continue;
      }

      if (session === undefined) {
        try {
          session = await input.createProjection();
        } catch (cause) {
          projectionUnavailable = errorFrom(cause, 'graphiti', 'Graphiti projection session could not start');
          if (queued !== undefined && input.outbox !== undefined) {
            const incomplete = scheduleProjectionRetry(queued, nowMs(), projectionUnavailable.code, retryPolicy);
            if (incomplete._tag === 'Err') return incomplete;
            const stored = await input.outbox.put(incomplete.value);
            if (stored._tag === 'Err') return stored;
            queued = incomplete.value;
          }
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

      let projected: Result<ProjectionReceipt, DomainError>;
      try {
        projected = await Effect.runPromise(session.projection.project({
          episodeId: episode.episodeId,
          occurredAtMs: episode.occurredAtMs,
          extractorVersion: input.extractorVersion,
          claims: [{
            original_digest: episode.contentDigest,
            text: episode.searchText,
            original_pointer: episode.sourcePointer,
          }],
        }));
      } catch {
        // An Effect defect/rejection is also an unavailable Graphiti provider,
        // not permission to throw away outcomes for already archived originals.
        projected = err(domainError('EXTERNAL_UNAVAILABLE', 'graphiti', 'Graphiti projection execution failed'));
      }
      if (projected._tag === 'Err') {
        if (queued !== undefined && input.outbox !== undefined) {
          const incomplete = scheduleProjectionRetry(queued, nowMs(), projected.error.code, retryPolicy);
          if (incomplete._tag === 'Err') return incomplete;
          const stored = await input.outbox.put(incomplete.value);
          if (stored._tag === 'Err') return stored;
          queued = incomplete.value;
        }
        outcomes.push({
          episodeId: episode.episodeId,
          persisted: created,
          admission,
          projectionStatus: queued?.status ?? 'incomplete',
          projectionErrorCode: projected.error.code,
        });
        continue;
      }
      if (input.outbox !== undefined) {
        const base: ProjectionReceipt = queued ?? {
          ...projected.value,
          status: 'pending',
          attempts: 0,
        };
        const receipt = recordProjectionEnqueue(base, projected.value, nowMs(), verificationDelayMs);
        if (receipt._tag === 'Err') return receipt;
        const stored = await input.outbox.put(receipt.value);
        if (stored._tag === 'Err') return stored;
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
