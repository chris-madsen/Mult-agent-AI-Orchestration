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

export type ProjectionStatus = 'pending' | 'projected' | 'incomplete' | 'dead_letter' | 'tombstoned';

export interface ProjectionReceipt {
  readonly key: ProjectionKey;
  readonly episodeId: EpisodeId;
  readonly extractorVersion: string;
  readonly status: ProjectionStatus;
  /** Attempts in the current automatic retry cycle. */
  readonly attempts: number;
  /** Monotonic lifetime attempt count retained across manual repairs. */
  readonly totalAttempts?: number;
  readonly nextAttemptAtMs?: number;
  readonly lastErrorCode?: string;
  readonly deadLetteredAtMs?: number;
  readonly manualRepairCount?: number;
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
  /** Immutable decision transitions; legacy records may omit them. */
  readonly transitions?: readonly DecisionTransition[];
}

export type SessionEpisodeReference = Omit<SessionEpisode, 'content'> & {
  /** Present only when the caller explicitly requested original bytes. */
  readonly content?: Uint8Array;
};

export interface MemorySearchHit {
  readonly episode: SessionEpisodeReference;
  readonly matchingExcerpt: string;
  readonly decisionState?: DecisionState;
  readonly historicalUncertainty?: boolean;
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
  // Platform-independent domain validation: the archive adapter verifies
  // SHA-256 binding to the exact bytes at the persistence boundary (DBC-09).
  if (!/^[a-f0-9]{64}$/u.test(input.contentDigest)) {
    return err(domainError('INVALID_MEMORY', 'content_digest', 'episode requires a lowercase SHA-256 digest'));
  }
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


export interface ProjectionRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const defaultProjectionRetryPolicy: ProjectionRetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
};

const validRetryPolicy = (policy: ProjectionRetryPolicy): boolean =>
  Number.isSafeInteger(policy.maxAttempts) && policy.maxAttempts >= 1
  && Number.isSafeInteger(policy.baseDelayMs) && policy.baseDelayMs >= 0
  && Number.isSafeInteger(policy.maxDelayMs) && policy.maxDelayMs >= policy.baseDelayMs;

export const projectionRetryDue = (receipt: ProjectionReceipt, nowMs: number): boolean =>
  (receipt.status === 'pending' || receipt.status === 'incomplete')
  && (receipt.nextAttemptAtMs === undefined || receipt.nextAttemptAtMs <= nowMs);

export const scheduleProjectionRetry = (
  receipt: ProjectionReceipt,
  nowMs: number,
  errorCode: string,
  policy: ProjectionRetryPolicy = defaultProjectionRetryPolicy,
): Result<ProjectionReceipt, DomainError> => {
  if (!validRetryPolicy(policy)) {
    return err(domainError('INVALID_MEMORY', 'projection_retry_policy', 'projection retry policy is invalid'));
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !nonEmpty(errorCode)) {
    return err(domainError('INVALID_MEMORY', 'projection_retry', 'retry timestamp and error code are required'));
  }
  if (receipt.status === 'projected' || receipt.status === 'tombstoned') {
    return err(domainError('INVALID_MEMORY', 'projection_retry', 'terminal successful/tombstoned projection cannot be retried'));
  }
  const attempts = receipt.attempts + 1;
  const totalAttempts = (receipt.totalAttempts ?? receipt.attempts) + 1;
  const {
    nextAttemptAtMs: discardedNextAttemptAtMs,
    deadLetteredAtMs: discardedDeadLetteredAtMs,
    ...retryBase
  } = receipt;
  void discardedNextAttemptAtMs;
  void discardedDeadLetteredAtMs;
  if (attempts >= policy.maxAttempts) {
    return ok({
      ...retryBase,
      status: 'dead_letter',
      attempts,
      totalAttempts,
      lastErrorCode: errorCode,
      deadLetteredAtMs: nowMs,
    });
  }
  const exponent = Math.max(0, attempts - 1);
  const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** exponent));
  return ok({
    ...retryBase,
    status: 'incomplete',
    attempts,
    totalAttempts,
    lastErrorCode: errorCode,
    nextAttemptAtMs: nowMs + delay,
  });
};

export const recordProjectionEnqueue = (
  receipt: ProjectionReceipt,
  providerReceipt: ProjectionReceipt,
  nowMs: number,
  verificationDelayMs: number,
): Result<ProjectionReceipt, DomainError> => {
  if (receipt.key !== providerReceipt.key
    || receipt.episodeId !== providerReceipt.episodeId
    || receipt.extractorVersion !== providerReceipt.extractorVersion) {
    return err(domainError('INVALID_MEMORY', 'projection_receipt', 'provider projection receipt identity does not match durable outbox intent'));
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0
    || !Number.isSafeInteger(verificationDelayMs) || verificationDelayMs < 0) {
    return err(domainError('INVALID_MEMORY', 'projection_receipt', 'projection enqueue timestamps/delay are invalid'));
  }
  if (providerReceipt.status !== 'pending' && providerReceipt.status !== 'projected') {
    return err(domainError('INVALID_MEMORY', 'projection_receipt', 'successful projection enqueue must be pending or projected'));
  }
  const attempts = receipt.attempts + 1;
  const totalAttempts = (receipt.totalAttempts ?? receipt.attempts) + 1;
  const {
    nextAttemptAtMs: discardedNextAttemptAtMs,
    deadLetteredAtMs: discardedDeadLetteredAtMs,
    lastErrorCode: discardedLastErrorCode,
    ...enqueueBase
  } = receipt;
  void discardedNextAttemptAtMs;
  void discardedDeadLetteredAtMs;
  void discardedLastErrorCode;
  return ok({
    ...enqueueBase,
    status: providerReceipt.status,
    attempts,
    totalAttempts,
    ...(providerReceipt.status === 'pending' ? { nextAttemptAtMs: nowMs + verificationDelayMs } : {}),
  });
};

export const deadLetterProjection = (
  receipt: ProjectionReceipt,
  nowMs: number,
  errorCode: string,
): Result<ProjectionReceipt, DomainError> => {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !nonEmpty(errorCode)) {
    return err(domainError('INVALID_MEMORY', 'projection_dead_letter', 'dead-letter timestamp and error code are required'));
  }
  if (receipt.status === 'projected' || receipt.status === 'tombstoned') {
    return err(domainError('INVALID_MEMORY', 'projection_dead_letter', 'successful/tombstoned projection cannot be dead-lettered'));
  }
  const { nextAttemptAtMs: discardedNextAttemptAtMs, ...deadBase } = receipt;
  void discardedNextAttemptAtMs;
  return ok({
    ...deadBase,
    status: 'dead_letter',
    lastErrorCode: errorCode,
    deadLetteredAtMs: nowMs,
  });
};

export const repairProjection = (
  receipt: ProjectionReceipt,
): Result<ProjectionReceipt, DomainError> => {
  if (receipt.status !== 'dead_letter' && receipt.status !== 'incomplete') {
    return err(domainError('INVALID_MEMORY', 'projection_repair', 'only failed projection receipts may be manually repaired'));
  }
  const {
    nextAttemptAtMs: discardedNextAttemptAtMs,
    deadLetteredAtMs: discardedDeadLetteredAtMs,
    ...repairBase
  } = receipt;
  void discardedNextAttemptAtMs;
  void discardedDeadLetteredAtMs;
  return ok({
    ...repairBase,
    status: 'pending',
    attempts: 0,
    manualRepairCount: (receipt.manualRepairCount ?? 0) + 1,
  });
};

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

export type DecisionTransition =
  | { readonly type: 'confirm'; readonly atMs: number }
  | { readonly type: 'reject'; readonly atMs: number }
  | { readonly type: 'supersede'; readonly atMs: number; readonly successorId: DecisionId };

export type DecisionEvent = DecisionTransition;

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
  const transitions = [...(record.transitions ?? []), event];
  if (event.type === 'confirm') return ok({ ...record, state: 'Accepted', transitions });
  if (event.type === 'reject') return ok({ ...record, state: 'Rejected', validToMs: event.atMs, transitions });
  if (event.successorId === record.decisionId || !nonEmpty(event.successorId)) {
    return err(domainError('INVALID_MEMORY', 'successor_id', 'successor must be a non-empty different decision'));
  }
  return ok({ ...record, state: 'Superseded', validToMs: event.atMs, successorId: event.successorId, transitions });
};

export const decisionStateAt = (
  record: DecisionRecord,
  asOfMs?: number,
): { readonly state?: DecisionState; readonly historicalUncertainty: boolean } => {
  if (asOfMs === undefined) return { state: record.state, historicalUncertainty: false };
  if (asOfMs < record.validFromMs) return { historicalUncertainty: false };
  const transitions = record.transitions;
  if (transitions === undefined || transitions.length === 0) {
    return record.state === 'Proposed'
      ? { state: 'Proposed', historicalUncertainty: false }
      : { historicalUncertainty: true };
  }
  let state: DecisionState = 'Proposed';
  for (const transition of [...transitions].sort((left, right) => left.atMs - right.atMs)) {
    if (transition.atMs > asOfMs) break;
    if (transition.type === 'confirm' && state === 'Proposed') state = 'Accepted';
    else if (transition.type === 'reject' && state === 'Proposed') state = 'Rejected';
    else if (transition.type === 'supersede' && state === 'Accepted') state = 'Superseded';
  }
  return { state, historicalUncertainty: false };
};

export const validateDecisionGraph = (decisions: readonly DecisionRecord[]): Result<void, DomainError> => {
  const byId = new Map(decisions.map((decision) => [decision.decisionId, decision]));
  for (const decision of decisions) {
    if (decision.successorId !== undefined && !byId.has(decision.successorId)) {
      return err(domainError('INVALID_MEMORY', 'successor_id', 'decision successor must exist in the decision graph'));
    }
    const seen = new Set<DecisionId>();
    let current: DecisionRecord | undefined = decision;
    while (current?.successorId !== undefined) {
      if (seen.has(current.decisionId)) {
        return err(domainError('INVALID_MEMORY', 'successor_id', 'decision successor graph must be acyclic'));
      }
      seen.add(current.decisionId);
      current = byId.get(current.successorId);
    }
  }
  return ok(undefined);
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
      const state = decision === undefined ? undefined : decisionStateAt(decision, asOfMs);
      return {
        episode,
        matchingExcerpt: matches.join(', '),
        ...(state?.state === undefined ? {} : { decisionState: state.state }),
        ...(state?.historicalUncertainty === true ? { historicalUncertainty: true } : {}),
      };
    });
  const effective = decisions
    .map((decision) => ({ decision, state: decisionStateAt(decision, asOfMs) }))
    .filter((item) => item.state.state === 'Accepted');
  const conflicts = effective
    .filter(({ decision }) => effective.some(({ decision: other }) =>
      other.decisionId !== decision.decisionId
      && other.workspaceId === decision.workspaceId
      && other.subject === decision.subject
      && other.proposal !== decision.proposal))
    .map(({ decision }) => `conflicting accepted decisions for ${decision.subject}: ${decision.decisionId}`);
  return { hits, conflicts: [...new Set(conflicts)], ...(asOfMs === undefined ? {} : { asOfMs }) };
};

export const unsupportedMemoryImporter = (reason: string): Result<never, DomainError> =>
  err(domainError('UNSUPPORTED_PROVIDER', 'session_importer', reason));
