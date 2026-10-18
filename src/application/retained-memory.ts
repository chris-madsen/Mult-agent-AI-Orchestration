import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { GraphProjectionPort } from './ports.js';
import type { EpisodeId } from '../domain/memory.js';
import type { AsyncMemoryArchivePort } from '../adapters/file-memory-archive.js';

/** Delete derived graph *before* tombstoning source. Graphiti failure must not
 * silently leave searchable derived facts for a deleted original. This is a
 * coordinated operation, not a distributed transaction; retries are idempotent. */
export const deleteEpisodeWithProjection = (
  archive: AsyncMemoryArchivePort,
  graph: GraphProjectionPort,
  id: EpisodeId,
): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
  const projected = yield* graph.purge(id);
  if (projected._tag === 'Err') return projected;
  const stored = yield* Effect.promise(() => archive.deleteEpisode(id));
  if (stored._tag === 'Err') {
    return err(domainError('PERSISTENCE_FAILED', 'archive',
      'Graphiti purge succeeded but archive delete failed; retry and reconcile before accepting deletion'));
  }
  return ok(undefined);
});
