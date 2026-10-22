import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type FeedbackReasoningEffort = 'low' | 'medium' | 'high';

export interface FeedbackHarborJobIdentity {
  readonly model: string;
  readonly reasoningEffort: FeedbackReasoningEffort;
  readonly nConcurrentTrials: 1;
  readonly nAttempts: 1;
}

type JsonObject = Readonly<Record<string, unknown>>;

const object = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const invalid = (path: string, message: string): Result<never, DomainError> =>
  err(domainError('INVALID_BENCHMARK', path, message));

const reasoningEffort = (value: unknown): value is FeedbackReasoningEffort =>
  value === 'low' || value === 'medium' || value === 'high';

export const dockerImageDigestPattern = /^sha256:[a-f0-9]{64}$/u;

/**
 * Reads the agent/runtime identity from the exact Harbor job JSON that will be
 * executed. Environment variables are deliberately not part of this contract.
 */
export const validateFeedbackHarborJob = (
  value: unknown,
  path = 'harbor_job',
): Result<FeedbackHarborJobIdentity, DomainError> => {
  const root = object(value);
  if (root === undefined) return invalid(path, 'Harbor job must be an object');
  const agents = root.agents;
  if (!Array.isArray(agents) || agents.length !== 1) return invalid(`${path}.agents`, 'exactly one Codex agent is required');
  const agent = object(agents[0]);
  const kwargs = object(agent?.kwargs);
  const model = agent?.model_name;
  const effort = kwargs?.reasoning_effort;
  if (agent?.name !== 'codex' || !nonEmpty(model)) return invalid(`${path}.agents[0]`, 'job must explicitly select a non-empty Codex model');
  if (!reasoningEffort(effort)) return invalid(`${path}.agents[0].kwargs.reasoning_effort`, 'reasoning effort must be low, medium or high');
  if (root.n_concurrent_trials !== 1) return invalid(`${path}.n_concurrent_trials`, 'feedback jobs must be serial');
  if (root.n_attempts !== 1) return invalid(`${path}.n_attempts`, 'feedback jobs must use one attempt per task');
  return ok({
    model: model.trim(),
    reasoningEffort: effort,
    nConcurrentTrials: 1,
    nAttempts: 1,
  });
};

export const validateMatchingFeedbackHarborJobs = (
  native: unknown,
  aceOptional: unknown,
): Result<FeedbackHarborJobIdentity, DomainError> => {
  const nativeIdentity = validateFeedbackHarborJob(native, 'native_job');
  if (nativeIdentity._tag === 'Err') return nativeIdentity;
  const aceIdentity = validateFeedbackHarborJob(aceOptional, 'ace_optional_job');
  if (aceIdentity._tag === 'Err') return aceIdentity;
  if (nativeIdentity.value.model !== aceIdentity.value.model
    || nativeIdentity.value.reasoningEffort !== aceIdentity.value.reasoningEffort) {
    return invalid('harbor_jobs', 'native and ACE optional jobs must pin the same model and reasoning effort');
  }
  return nativeIdentity;
};

/** Accepts either a local Docker image ID or a repository digest. */
export const dockerImageMatchesDigest = (digest: string, inspection: unknown): boolean => {
  if (!dockerImageDigestPattern.test(digest)) return false;
  const image = object(inspection);
  if (image === undefined) return false;
  if (image.Id === digest) return true;
  const repoDigests = image.RepoDigests;
  return Array.isArray(repoDigests)
    && repoDigests.some((value) => typeof value === 'string' && value.endsWith(`@${digest}`));
};
