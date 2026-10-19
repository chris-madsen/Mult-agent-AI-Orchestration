import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { ContentDigest, WorkspaceId } from './workspace.js';

export type EpisodeId = string & { readonly __brand: 'EpisodeId' };
export type DecisionId = string & { readonly __brand: 'DecisionId' };
export type ProjectionKey = string & { readonly __brand: 'ProjectionKey' };

export interface SessionEpisode {
  readonly episodeId: EpisodeId;
  readonly workspaceId: WorkspaceId;
  readonly sessionId: string;
  readonly sourcePointer: string;
  readonly occurredAtMs: number;
  readonly importedAtMs: number;
  readonly contentDigest: ContentDigest;
  readonly content: Uint8Array;
  readonly searchText: string;
  /** Optional exporter annotation; absence must remain archive-only unless policy signals are present. */
  readonly memoryHint?: 'project' | 'archive_only';
  readonly tombstoned: boolean;
}

export type ProjectionStatus = 'pending' | 'projected' | 'incomplete' | 'tombstoned';

export interface ProjectionReceipt {
  readonly key: ProjectionKey;
  readonly episodeId: EpisodeId;
  readonly extractorVersion: string;
  readonly status: ProjectionStatus;
  readonly attempts: number;
}

export type DecisionState = 'Proposed' | 'Accepted' | 'Rejected' | 'Superseded';

export interface DecisionRecord {
  readonly decisionId: DecisionId;
  readonly workspaceId: WorkspaceId;
  readonly subject: string;
  readonly proposal: string;
  readonly state: DecisionState;
  readonly validFromMs: number;
  readonly validToMs?: number;
  readonly sourceEpisodeIds: readonly EpisodeId[];
  readonly successorId?: DecisionId;
}

export interface MemorySearchHit {
  readonly episode: SessionEpisode;
  readonly matchingExcerpt: string;
  readonly decisionState?: DecisionState;
}

export interface MemorySearchResult {
  readonly hits: readonly MemorySearchHit[];
  readonly conflicts: readonly string[];
  readonly asOfMs?: number;
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;

export const makeEpisodeId = (value: string): Result<EpisodeId, DomainError> =>
  nonEmpty(value) ? ok(value.trim() as EpisodeId) : err(domainError('INVALID_MEMORY', 'episode_id', 'episode id must not be empty'));

export const makeEpisode = (input: SessionEpisode): Result<SessionEpisode, DomainError> => {
  if (!nonEmpty(input.sessionId) || !nonEmpty(input.sourcePointer)) {
    return err(domainError('INVALID_MEMORY', 'episode', 'session id and source pointer are required'));
  }
  if (input.content.length === 0) return err(domainError('INVALID_MEMORY', 'content', 'episode content must not be empty'));
  if (!Number.isSafeInteger(input.occurredAtMs) || !Number.isSafeInteger(input.importedAtMs)) {
    return err(domainError('INVALID_MEMORY', 'timestamp', 'episode timestamps must be safe integers'));
  }
  return ok({ ...input, content: new Uint8Array(input.content) });
};

export const projectionKey = (episodeId: EpisodeId, extractorVersion: string): ProjectionKey =>
  `${episodeId}:${extractorVersion}` as ProjectionKey;

export const beginProjection = (
  receipts: readonly ProjectionReceipt[],
  episodeId: EpisodeId,
  extractorVersion: string,
): Result<ProjectionReceipt, DomainError> => {
  if (!nonEmpty(extractorVersion)) return err(domainError('INVALID_MEMORY', 'extractor_version', 'extractor version is required'));
  const key = projectionKey(episodeId, extractorVersion);
  const existing = receipts.find((receipt) => receipt.key === key);
  if (existing !== undefined) return ok(existing);
  return ok({ key, episodeId, extractorVersion, status: 'pending', attempts: 0 });
};

export const finishProjection = (
  receipt: ProjectionReceipt,
  status: Exclude<ProjectionStatus, 'pending'>,
): ProjectionReceipt => ({ ...receipt, status, attempts: receipt.attempts + 1 });

export const makeDecisionRecord = (input: Omit<DecisionRecord, 'state'> & { readonly state?: DecisionState }): Result<DecisionRecord, DomainError> => {
  if (!nonEmpty(input.subject) || !nonEmpty(input.proposal)) {
    return err(domainError('INVALID_MEMORY', 'decision', 'decision subject and proposal are required'));
  }
  if (input.sourceEpisodeIds.length === 0) {
    return err(domainError('INVALID_MEMORY', 'source_episode_ids', 'a decision needs source evidence'));
  }
  const state = input.state ?? 'Proposed';
  if (state === 'Accepted') return err(domainError('INVALID_MEMORY', 'state', 'new decisions require explicit confirmation'));
  return ok({ ...input, state });
};

export type DecisionEvent =
  | { readonly type: 'confirm'; readonly atMs: number }
  | { readonly type: 'reject'; readonly atMs: number }
  | { readonly type: 'supersede'; readonly atMs: number; readonly successorId: DecisionId };

export const transitionDecision = (record: DecisionRecord, event: DecisionEvent): Result<DecisionRecord, DomainError> => {
  if (!Number.isSafeInteger(event.atMs) || event.atMs < record.validFromMs) {
    return err(domainError('INVALID_MEMORY', 'at_ms', 'decision transition time must be after valid-from'));
  }
  if (record.state !== 'Proposed' && event.type === 'confirm') {
    return err(domainError('INVALID_MEMORY', 'state', 'only proposed decisions may be confirmed'));
  }
  if (record.state !== 'Proposed' && event.type === 'reject') {
    return err(domainError('INVALID_MEMORY', 'state', 'only proposed decisions may be rejected'));
  }
  if (record.state !== 'Accepted' || event.type !== 'supersede') {
    if (event.type === 'supersede') return err(domainError('INVALID_MEMORY', 'state', 'only accepted decisions may be superseded'));
  }
  if (event.type === 'confirm') return ok({ ...record, state: 'Accepted' });
  if (event.type === 'reject') return ok({ ...record, state: 'Rejected', validToMs: event.atMs });
  return ok({ ...record, state: 'Superseded', validToMs: event.atMs, successorId: event.successorId });
};

export const searchMemory = (
  episodes: readonly SessionEpisode[],
  query: string,
  asOfMs?: number,
  decisions: readonly DecisionRecord[] = [],
): MemorySearchResult => {
  const terms = [...new Set(query.toLocaleLowerCase().split(/[^a-z0-9_$.-]+/u).filter((term) => term.length > 1))];
  const hits = episodes
    .filter((episode) => !episode.tombstoned && (asOfMs === undefined || episode.occurredAtMs <= asOfMs))
    .map((episode) => {
      const haystack = episode.searchText.toLocaleLowerCase();
      const matches = terms.filter((term) => haystack.includes(term));
      return { episode, matches };
    })
    .filter((item) => item.matches.length > 0)
    .sort((left, right) => right.matches.length - left.matches.length || right.episode.occurredAtMs - left.episode.occurredAtMs)
    .map(({ episode, matches }) => {
      const decision = decisions.find((candidate) => candidate.sourceEpisodeIds.includes(episode.episodeId));
      return {
        episode,
        matchingExcerpt: matches.join(', '),
        ...(decision === undefined ? {} : { decisionState: decision.state }),
      };
    });
  const accepted = decisions.filter((decision) => decision.state === 'Accepted');
  const conflicts = accepted
    .filter((decision) => accepted.some((other) => other.decisionId !== decision.decisionId && other.subject === decision.subject && other.proposal !== decision.proposal))
    .map((decision) => `conflicting accepted decisions for ${decision.subject}: ${decision.decisionId}`);
  return { hits, conflicts: [...new Set(conflicts)], ...(asOfMs === undefined ? {} : { asOfMs }) };
};

export const unsupportedMemoryImporter = (reason: string): Result<never, DomainError> =>
  err(domainError('UNSUPPORTED_PROVIDER', 'session_importer', reason));
