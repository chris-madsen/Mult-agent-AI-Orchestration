import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { validateDecisionGraph, type DecisionRecord, type DecisionState } from '../domain/memory.js';
import { err, ok, type Result } from '../domain/result.js';
import type { DecisionHistoryPort } from '../application/ports.js';
import type { WorkspaceId } from '../domain/workspace.js';

const decisionStates: readonly DecisionState[] = ['Proposed', 'Accepted', 'Rejected', 'Superseded'];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const safeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

const validDecision = (value: unknown): value is DecisionRecord => {
  if (!isRecord(value)
    || !nonEmptyString(value.decisionId)
    || !nonEmptyString(value.workspaceId)
    || !nonEmptyString(value.subject)
    || !nonEmptyString(value.proposal)
    || !decisionStates.includes(value.state as DecisionState)
    || !safeInteger(value.validFromMs)
    || !Array.isArray(value.sourceEpisodeIds)
    || value.sourceEpisodeIds.length === 0
    || !value.sourceEpisodeIds.every(nonEmptyString)) return false;
  if (value.validToMs !== undefined && !safeInteger(value.validToMs)) return false;
  if (value.successorId !== undefined && !nonEmptyString(value.successorId)) return false;
  if (value.transitions !== undefined && (!Array.isArray(value.transitions) || !value.transitions.every((transition) => {
    if (!isRecord(transition)
      || !['confirm', 'reject', 'supersede'].includes(String(transition.type))
      || !safeInteger(transition.atMs)
      || !nonEmptyString(transition.approvalIdentity)
      || !Array.isArray(transition.sourceEpisodeIds)
      || transition.sourceEpisodeIds.length === 0
      || !transition.sourceEpisodeIds.every(nonEmptyString)) return false;
    return transition.type !== 'supersede' || nonEmptyString(transition.successorId);
  }))) return false;
  return true;
};

const parse = (raw: unknown): Result<readonly DecisionRecord[], DomainError> => {
  if (!Array.isArray(raw) || !raw.every(validDecision)) {
    return err(domainError('PERSISTENCE_FAILED', 'decision_history', 'decision history must be an array of typed decision records'));
  }
  const decisions = raw as readonly DecisionRecord[];
  const graph = validateDecisionGraph(decisions);
  return graph._tag === 'Err' ? graph : ok(decisions);
};

export const makeFileDecisionHistory = (path: string): DecisionHistoryPort => ({
  list: (workspaceId: WorkspaceId) => Effect.promise(async () => {
    try {
      const parsed = parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
      if (parsed._tag === 'Err') return parsed;
      return ok(parsed.value.filter((decision) => decision.workspaceId === workspaceId));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return ok([]);
      return err(domainError(
        'PERSISTENCE_FAILED',
        'decision_history',
        cause instanceof Error ? `could not read decision history: ${cause.message}` : 'could not read decision history',
      ));
    }
  }),
});
