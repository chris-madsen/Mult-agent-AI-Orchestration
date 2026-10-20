import { admitMemoryEpisode, defaultMemoryAdmissionPolicy, type MemoryAdmissionPolicy } from '../domain/memory-admission.js';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { SessionEpisode } from '../domain/memory.js';
import type { ProjectionOutboxPort } from './ports.js';

export interface ProjectionIntentReconcileInput {
  readonly episodes: readonly SessionEpisode[];
  readonly extractorVersion: string;
  readonly outbox: ProjectionOutboxPort;
  readonly admissionPolicy?: MemoryAdmissionPolicy;
}

/**
 * Rebuild missing projection intents from immutable archive truth. This closes
 * the crash window after an archive commit and before an outbox receipt: the
 * next reconciliation creates the durable intent without re-importing bytes.
 */
export const reconcileProjectionIntents = async (
  input: ProjectionIntentReconcileInput,
): Promise<Result<number, DomainError>> => {
  if (input.extractorVersion.trim().length === 0) {
    return err(domainError('INVALID_MEMORY', 'extractor_version', 'extractor version is required'));
  }
  const existing = await input.outbox.list();
  if (existing._tag === 'Err') return existing;
  const episodeIds = new Set(existing.value.map((receipt) => receipt.episodeId));
  let created = 0;
  const policy = input.admissionPolicy ?? defaultMemoryAdmissionPolicy;
  for (const episode of input.episodes) {
    if (episode.tombstoned || admitMemoryEpisode(episode, policy).kind !== 'project' || episodeIds.has(episode.episodeId)) continue;
    const begun = await input.outbox.begin(episode.episodeId, input.extractorVersion);
    if (begun._tag === 'Err') return begun;
    episodeIds.add(episode.episodeId);
    created += 1;
  }
  return ok(created);
};
