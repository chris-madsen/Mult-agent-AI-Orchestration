import type { SessionEpisode } from './memory.js';

export type MemoryAdmissionReason =
  | 'explicit_annotation'
  | 'durable_decision'
  | 'architecture_choice'
  | 'durable_constraint'
  | 'unresolved_question'
  | 'user_preference'
  | 'ordinary_transcript'
  | 'too_large';

export type MemoryAdmission =
  | { readonly kind: 'project'; readonly reason: Exclude<MemoryAdmissionReason, 'ordinary_transcript' | 'too_large'> }
  | { readonly kind: 'archive_only'; readonly reason: Extract<MemoryAdmissionReason, 'ordinary_transcript' | 'too_large'> };

export interface MemoryAdmissionPolicy {
  /** Large episodes stay in the exact archive and are not sent to an LLM-backed extractor. */
  readonly maxProjectCharacters: number;
}

export const defaultMemoryAdmissionPolicy: MemoryAdmissionPolicy = Object.freeze({ maxProjectCharacters: 4_000 });

const signals: readonly { readonly reason: Exclude<MemoryAdmissionReason, 'explicit_annotation' | 'ordinary_transcript' | 'too_large'>; readonly pattern: RegExp }[] = [
  { reason: 'durable_decision', pattern: /\b(?:we\s+)?(?:decided|decision|chosen|choose|adopted|approved|will\s+use)\b/iu },
  { reason: 'architecture_choice', pattern: /\b(?:architecture|architectural|design\s+decision|adr[-\s]?\d+|production\s+provider)\b/iu },
  { reason: 'durable_constraint', pattern: /\b(?:must\s+(?:not|never)|never\s+use|do\s+not\s+use|cannot\s+be|required\s+constraint|policy)\b/iu },
  { reason: 'unresolved_question', pattern: /\b(?:open\s+question|unresolved|blocked|needs?\s+(?:a\s+)?decision|todo)\b/iu },
  { reason: 'user_preference', pattern: /\b(?:prefer(?:ence)?|always\s+use|avoid\s+using|instead\s+of)\b/iu },
];

const validLimit = (policy: MemoryAdmissionPolicy): boolean => Number.isSafeInteger(policy.maxProjectCharacters) && policy.maxProjectCharacters > 0;

/**
 * Selects durable facts before any Graphiti call. This is deliberately
 * conservative: a false negative keeps the original bytes searchable locally;
 * a false positive can spend provider tokens and is therefore bounded.
 */
export const admitMemoryEpisode = (
  episode: Pick<SessionEpisode, 'searchText' | 'memoryHint'>,
  policy: MemoryAdmissionPolicy = defaultMemoryAdmissionPolicy,
): MemoryAdmission => {
  if (!validLimit(policy) || episode.searchText.length > policy.maxProjectCharacters) return { kind: 'archive_only', reason: 'too_large' };
  if (episode.memoryHint === 'archive_only') return { kind: 'archive_only', reason: 'ordinary_transcript' };
  if (episode.memoryHint === 'project') return { kind: 'project', reason: 'explicit_annotation' };
  const signal = signals.find(({ pattern }) => pattern.test(episode.searchText));
  return signal === undefined ? { kind: 'archive_only', reason: 'ordinary_transcript' } : { kind: 'project', reason: signal.reason };
};
