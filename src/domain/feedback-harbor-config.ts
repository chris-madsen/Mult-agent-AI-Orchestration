import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type FeedbackReasoningEffort = 'low' | 'medium' | 'high';

export interface FeedbackHarborJobIdentity {
  readonly model: string;
  readonly reasoningEffort: FeedbackReasoningEffort;
  readonly nConcurrentTrials: 1;
  readonly nAttempts: 1;
  readonly taskPaths: readonly string[];
  readonly configPath?: string;
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
  const tasks = root.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return invalid(`${path}.tasks`, 'at least one frozen task path is required');
  const taskPaths: string[] = [];
  for (const [index, item] of tasks.entries()) {
    const task = object(item);
    if (!nonEmpty(task?.path)) return invalid(`${path}.tasks[${index}].path`, 'task path must be explicit and non-empty');
    const taskPath = task.path.trim();
    if (taskPaths.includes(taskPath)) return invalid(`${path}.tasks[${index}].path`, 'task paths must be unique');
    taskPaths.push(taskPath);
  }
  const agent = object(agents[0]);
  const kwargs = object(agent?.kwargs);
  const model = agent?.model_name;
  const effort = kwargs?.reasoning_effort;
  const configPath = kwargs?.config;
  if (configPath !== undefined && !nonEmpty(configPath)) return invalid(`${path}.agents[0].kwargs.config`, 'Codex config path must be non-empty when present');
  if (agent?.name !== 'codex' || !nonEmpty(model)) return invalid(`${path}.agents[0]`, 'job must explicitly select a non-empty Codex model');
  if (!reasoningEffort(effort)) return invalid(`${path}.agents[0].kwargs.reasoning_effort`, 'reasoning effort must be low, medium or high');
  if (root.n_concurrent_trials !== 1) return invalid(`${path}.n_concurrent_trials`, 'feedback jobs must be serial');
  if (root.n_attempts !== 1) return invalid(`${path}.n_attempts`, 'feedback jobs must use one attempt per task');
  return ok({
    model: model.trim(),
    reasoningEffort: effort,
    nConcurrentTrials: 1,
    nAttempts: 1,
    taskPaths,
    ...(configPath === undefined ? {} : { configPath: configPath.trim() }),
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
  if (JSON.stringify(nativeIdentity.value.taskPaths) !== JSON.stringify(aceIdentity.value.taskPaths)) {
    return invalid('harbor_jobs.tasks', 'native and ACE optional jobs must pin the same frozen task paths in the same order');
  }
  if (nativeIdentity.value.configPath !== undefined) {
    return invalid('native_job.agents[0].kwargs.config', 'native baseline must not load an ACE Codex config');
  }
  if (aceIdentity.value.configPath === undefined) {
    return invalid('ace_optional_job.agents[0].kwargs.config', 'ACE optional job must load an explicit Codex config');
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
