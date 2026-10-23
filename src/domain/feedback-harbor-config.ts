import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type FeedbackReasoningEffort = 'low' | 'medium' | 'high';

export const feedbackHermesAgentImportPath = 'scripts.harbor_hermes_codex_oauth:HermesCodexOAuth' as const;
export const feedbackHermesVersion = 'v0.22.3' as const;
export const feedbackHermesProviderPrefix = 'openai-codex/' as const;
export const feedbackAceMcpCommand = '/ace/scripts/harbor-ace-mcp.sh' as const;

export interface FeedbackHarborJobIdentity {
  readonly agent: 'hermes';
  readonly agentVersion: typeof feedbackHermesVersion;
  readonly model: string;
  readonly reasoningEffort: FeedbackReasoningEffort;
  readonly nConcurrentTrials: 1;
  readonly nAttempts: 1;
  readonly taskPaths: readonly string[];
  readonly hasAceMcp: boolean;
}

export interface FeedbackHarborPairIdentity extends FeedbackHarborJobIdentity {
  readonly aceMcpCommand: typeof feedbackAceMcpCommand;
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

const validateAceMcp = (value: unknown, path: string): Result<boolean, DomainError> => {
  if (value === undefined) return ok(false);
  if (!Array.isArray(value)) return invalid(path, 'Hermes MCP servers must be an array when present');
  if (value.length === 0) return ok(false);
  if (value.length !== 1) return invalid(path, 'feedback jobs may expose only the ACE MCP server');
  const server = object(value[0]);
  if (server?.name !== 'ace' || server.transport !== 'stdio' || server.command !== feedbackAceMcpCommand
    || !Array.isArray(server.args) || server.args.length !== 0) {
    return invalid(`${path}[0]`, 'ACE MCP server identity must be pinned to the read-only /ace runtime');
  }
  return ok(true);
};

export const validateFeedbackHarborJob = (
  value: unknown,
  path = 'harbor_job',
): Result<FeedbackHarborJobIdentity, DomainError> => {
  const root = object(value);
  if (root === undefined) return invalid(path, 'Harbor job must be an object');
  const agents = root.agents;
  if (!Array.isArray(agents) || agents.length !== 1) return invalid(`${path}.agents`, 'exactly one Hermes agent is required');
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
  const version = kwargs?.version;
  if (agent?.import_path !== feedbackHermesAgentImportPath || !nonEmpty(model)
    || !model.startsWith(feedbackHermesProviderPrefix) || model.length <= feedbackHermesProviderPrefix.length) {
    return invalid(`${path}.agents[0]`, 'job must use the pinned Hermes Codex-OAuth adapter and an openai-codex model');
  }
  if (version !== feedbackHermesVersion) {
    return invalid(`${path}.agents[0].kwargs.version`, `Hermes version must be pinned to ${feedbackHermesVersion}`);
  }
  if (!reasoningEffort(effort)) return invalid(`${path}.agents[0].kwargs.reasoning_effort`, 'reasoning effort must be low, medium or high');
  const aceMcp = validateAceMcp(agent.mcp_servers, `${path}.agents[0].mcp_servers`);
  if (aceMcp._tag === 'Err') return aceMcp;
  if (root.n_concurrent_trials !== 1) return invalid(`${path}.n_concurrent_trials`, 'feedback jobs must be serial');
  if (root.n_attempts !== 1) return invalid(`${path}.n_attempts`, 'feedback jobs must use one attempt per task');
  return ok({
    agent: 'hermes',
    agentVersion: feedbackHermesVersion,
    model: model.trim(),
    reasoningEffort: effort,
    nConcurrentTrials: 1,
    nAttempts: 1,
    taskPaths,
    hasAceMcp: aceMcp.value,
  });
};

export const validateMatchingFeedbackHarborJobs = (
  native: unknown,
  aceOptional: unknown,
): Result<FeedbackHarborPairIdentity, DomainError> => {
  const nativeIdentity = validateFeedbackHarborJob(native, 'native_job');
  if (nativeIdentity._tag === 'Err') return nativeIdentity;
  const aceIdentity = validateFeedbackHarborJob(aceOptional, 'ace_optional_job');
  if (aceIdentity._tag === 'Err') return aceIdentity;
  if (nativeIdentity.value.model !== aceIdentity.value.model
    || nativeIdentity.value.agentVersion !== aceIdentity.value.agentVersion
    || nativeIdentity.value.reasoningEffort !== aceIdentity.value.reasoningEffort) {
    return invalid('harbor_jobs', 'native and ACE optional jobs must pin the same Hermes/model/reasoning identity');
  }
  if (JSON.stringify(nativeIdentity.value.taskPaths) !== JSON.stringify(aceIdentity.value.taskPaths)) {
    return invalid('harbor_jobs.tasks', 'native and ACE optional jobs must pin the same frozen task paths in the same order');
  }
  if (nativeIdentity.value.hasAceMcp) return invalid('native_job.agents[0].mcp_servers', 'native Hermes baseline must not expose ACE');
  if (!aceIdentity.value.hasAceMcp) return invalid('ace_optional_job.agents[0].mcp_servers', 'ACE optional Hermes job must expose the pinned ACE MCP server');
  return ok({ ...nativeIdentity.value, aceMcpCommand: feedbackAceMcpCommand });
};

export const dockerImageMatchesDigest = (digest: string, inspection: unknown): boolean => {
  if (!dockerImageDigestPattern.test(digest)) return false;
  const image = object(inspection);
  if (image === undefined) return false;
  if (image.Id === digest) return true;
  const repoDigests = image.RepoDigests;
  return Array.isArray(repoDigests)
    && repoDigests.some((value) => typeof value === 'string' && value.endsWith(`@${digest}`));
};
