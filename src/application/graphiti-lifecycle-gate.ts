import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { finishProjection, type ProjectionReceipt, type SessionEpisode } from '../domain/memory.js';
import { err, ok, type Result } from '../domain/result.js';
import type {
  GraphProjectionPort,
  GraphProjectionStatePort,
  MemorySearchPort,
  ProjectionOutboxPort,
} from './ports.js';
import type { AsyncMemoryArchivePort } from '../adapters/file-memory-archive.js';
import { deleteEpisodeWithProjection } from './retained-memory.js';

export interface GraphitiLifecycleGateInput {
  readonly episode: SessionEpisode;
  readonly query: string;
  readonly extractorVersion: string;
  readonly requestId: string;
  readonly archive: AsyncMemoryArchivePort;
  readonly outbox: ProjectionOutboxPort;
  readonly projection: GraphProjectionPort;
  readonly projectionState: GraphProjectionStatePort;
  readonly memory: MemorySearchPort;
  readonly projectionPollAttempts?: number;
  readonly projectionPollDelayMs?: number;
}

export interface GraphitiLifecycleEvidence {
  readonly episodeId: string;
  readonly sourcePointer: string;
  readonly sourceDigest: string;
  readonly projectionKey: string;
  readonly projectionAttempts: number;
  readonly projectionObserved: true;
  readonly provenanceHitCount: number;
  readonly requestId: string;
  readonly purgeVerified: true;
  readonly archiveTombstoneVerified: true;
}

const positiveInteger = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;

const nonNegativeInteger = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : fallback;

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, milliseconds); });

const waitForProjection = async (
  state: GraphProjectionStatePort,
  episode: SessionEpisode,
  attempts: number,
  delayMs: number,
): Promise<Result<void, DomainError>> => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const present = await Effect.runPromise(state.isPresent(episode.episodeId));
    if (present._tag === 'Err') return present;
    if (present.value) return ok(undefined);
    if (attempt < attempts && delayMs > 0) await delay(delayMs);
  }
  return err(domainError(
    'EXTERNAL_UNAVAILABLE',
    'graphiti_projection',
    'Graphiti projection did not become observable before the lifecycle gate deadline',
    { attempts },
  ));
};

/**
 * Real-provider acceptance orchestration for the Graphiti branch.
 *
 * The same application code is contract-tested with injected ports and may be
 * run by Codex against local Graphiti/FalkorDB. It never accepts an enqueue
 * acknowledgement as completed projection evidence.
 */
export const runGraphitiLifecycleGate = async (
  input: GraphitiLifecycleGateInput,
): Promise<Result<GraphitiLifecycleEvidence, DomainError>> => {
  if (input.query.trim().length === 0 || input.extractorVersion.trim().length === 0 || input.requestId.trim().length === 0) {
    return err(domainError('INVALID_INPUT', 'graphiti_lifecycle', 'query, extractor version and request id are required'));
  }

  const archived = await input.archive.importEpisode(input.episode);
  if (archived._tag === 'Err') return archived;

  const queued = await input.outbox.begin(input.episode.episodeId, input.extractorVersion);
  if (queued._tag === 'Err') return queued;
  if (queued.value.status === 'tombstoned') {
    return err(domainError('ARCHIVE_TOMBSTONED', 'projection_outbox', 'tombstoned projection cannot be reused for a lifecycle gate'));
  }

  const projected = await Effect.runPromise(input.projection.project({
    episodeId: input.episode.episodeId,
    occurredAtMs: input.episode.occurredAtMs,
    extractorVersion: input.extractorVersion,
    claims: [{
      original_digest: input.episode.contentDigest,
      text: input.episode.searchText,
      original_pointer: input.episode.sourcePointer,
    }],
  }));
  if (projected._tag === 'Err') {
    const incomplete = finishProjection(queued.value, 'incomplete');
    const stored = await input.outbox.put(incomplete);
    return stored._tag === 'Err' ? stored : projected;
  }

  const pendingReceipt: ProjectionReceipt = {
    ...projected.value,
    attempts: Math.max(projected.value.attempts, queued.value.attempts + 1),
  };
  const storedPending = await input.outbox.put(pendingReceipt);
  if (storedPending._tag === 'Err') return storedPending;

  const attempts = positiveInteger(input.projectionPollAttempts, 60);
  const delayMs = nonNegativeInteger(input.projectionPollDelayMs, 500);
  const observable = await waitForProjection(
    input.projectionState,
    input.episode,
    attempts,
    delayMs,
  );
  if (observable._tag === 'Err') return observable;

  const completed = finishProjection(pendingReceipt, 'projected');
  const storedCompleted = await input.outbox.put(completed);
  if (storedCompleted._tag === 'Err') return storedCompleted;

  const recalled = await Effect.runPromise(input.memory.search({
    workspaceId: input.episode.workspaceId,
    query: input.query,
    includeOriginal: false,
    requestId: input.requestId,
  }));
  if (recalled._tag === 'Err') return recalled;

  const provenanceHits = recalled.value.hits.filter((hit) =>
    hit.episode.episodeId === input.episode.episodeId
    && hit.episode.sourcePointer === input.episode.sourcePointer
    && hit.episode.contentDigest === input.episode.contentDigest);
  if (provenanceHits.length === 0) {
    return err(domainError(
      'INVALID_EXTERNAL_RESPONSE',
      'graphiti_memory',
      'Graphiti recall returned no fact linked to the exact immutable ACE episode',
    ));
  }

  const deleted = await Effect.runPromise(deleteEpisodeWithProjection(
    input.archive,
    input.projection,
    input.projectionState,
    input.episode.episodeId,
    { verificationAttempts: attempts, verificationDelayMs: delayMs, deletionFence: input.outbox },
  ));
  if (deleted._tag === 'Err') return deleted;

  const stillPresent = await Effect.runPromise(input.projectionState.isPresent(input.episode.episodeId));
  if (stillPresent._tag === 'Err') return stillPresent;
  if (stillPresent.value) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'graphiti_purge', 'derived episode reappeared after verified purge'));
  }

  const archivedAfterDelete = await input.archive.readEpisode(input.episode.episodeId);
  if (archivedAfterDelete._tag !== 'Err' || archivedAfterDelete.error.code !== 'ARCHIVE_TOMBSTONED') {
    return err(domainError('PERSISTENCE_FAILED', 'archive', 'archive tombstone was not observable after verified Graphiti purge'));
  }

  const tombstoned = await input.outbox.put({ ...completed, status: 'tombstoned' });
  if (tombstoned._tag === 'Err') return tombstoned;

  return ok({
    episodeId: input.episode.episodeId,
    sourcePointer: input.episode.sourcePointer,
    sourceDigest: input.episode.contentDigest,
    projectionKey: completed.key,
    projectionAttempts: completed.attempts,
    projectionObserved: true,
    provenanceHitCount: provenanceHits.length,
    requestId: input.requestId,
    purgeVerified: true,
    archiveTombstoneVerified: true,
  });
};
