import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isSuccessfulAceContextJsonLine } from '../src/domain/harbor-mcp-evidence.js';

type JsonObject = Readonly<Record<string, unknown>>;

interface JobSummary {
  readonly jobPath: string;
  readonly aggregateSha256: string;
  readonly trials: number;
  readonly completed: number;
  readonly errors: number;
  readonly successes: number;
  readonly quality: number;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly costUsd: number | null;
  readonly aceCalls: number;
  readonly taskNames: readonly string[];
}

const object = (value: unknown, path: string): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as JsonObject;
};

const number = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  return value;
};

const integer = (value: unknown, path: string): number => {
  const result = number(value, path);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${path} must be a non-negative integer`);
  return result;
};

const optionalInteger = (value: unknown, path: string): number | null =>
  value === null || value === undefined ? null : integer(value, path);

const optionalNumber = (value: unknown, path: string): number | null =>
  value === null || value === undefined ? null : number(value, path);

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex');

const readJson = async (path: string): Promise<JsonObject> => object(JSON.parse(await readFile(path, 'utf8')) as unknown, path);

const trialDirectories = async (aggregatePath: string): Promise<readonly string[]> => {
  const parent = dirname(resolve(aggregatePath));
  const entries = await readdir(parent, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(parent, entry.name)).sort();
};

const summarize = async (aggregatePath: string): Promise<JobSummary> => {
  const aggregateContent = await readFile(aggregatePath, 'utf8');
  const aggregate = await readJson(aggregatePath);
  const stats = object(aggregate.stats, `${aggregatePath}.stats`);
  const totalTrials = integer(aggregate.n_total_trials, `${aggregatePath}.n_total_trials`);
  const completed = integer(stats.n_completed_trials, `${aggregatePath}.stats.n_completed_trials`);
  const errors = integer(stats.n_errored_trials, `${aggregatePath}.stats.n_errored_trials`);
  const inputTokens = optionalInteger(stats.n_input_tokens, `${aggregatePath}.stats.n_input_tokens`);
  const cachedInputTokens = optionalInteger(stats.n_cache_tokens, `${aggregatePath}.stats.n_cache_tokens`);
  const outputTokens = optionalInteger(stats.n_output_tokens, `${aggregatePath}.stats.n_output_tokens`);
  const costUsd = optionalNumber(stats.cost_usd, `${aggregatePath}.stats.cost_usd`);
  const evaluations = object(stats.evals, `${aggregatePath}.stats.evals`);
  const primaryValue = Object.values(evaluations)[0];
  if (primaryValue === undefined) throw new Error(`${aggregatePath}: missing primary evaluation`);
  const primary = object(primaryValue, `${aggregatePath}.stats.evals[0]`);
  const metrics = primary.metrics;
  if (!Array.isArray(metrics) || metrics.length === 0) throw new Error(`${aggregatePath}: missing quality metric`);
  const quality = number(object(metrics[0], `${aggregatePath}.stats.evals[0].metrics[0]`).mean, `${aggregatePath}: quality mean`);

  const trials = await trialDirectories(aggregatePath);
  let successes = 0;
  let aceCalls = 0;
  const taskNames: string[] = [];
  for (const directory of trials) {
    const trial = await readJson(join(directory, 'result.json'));
    const taskName = trial.task_name;
    if (typeof taskName !== 'string' || taskName.length === 0) throw new Error(`${directory}: missing task_name`);
    taskNames.push(taskName);
    const exception = trial.exception_info;
    const verifier = trial.verifier_result === null || trial.verifier_result === undefined
      ? null
      : object(trial.verifier_result, `${directory}.verifier_result`);
    const rewards = verifier === null || verifier.rewards === null || verifier.rewards === undefined
      ? null
      : object(verifier.rewards, `${directory}.verifier_result.rewards`);
    if ((exception === null || exception === undefined) && rewards !== null
      && number(rewards.reward, `${directory}.reward`) === 1) {
      successes += 1;
    }
    try {
      const trace = await readFile(join(directory, 'agent', 'codex.txt'), 'utf8');
      aceCalls += trace.split('\n').filter(isSuccessfulAceContextJsonLine).length;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }
  if (trials.length !== totalTrials) throw new Error(`${aggregatePath}: aggregate/trial count mismatch`);
  return {
    jobPath: aggregatePath,
    aggregateSha256: sha256(aggregateContent),
    trials: totalTrials,
    completed,
    errors,
    successes,
    quality,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens,
    costUsd,
    aceCalls,
    taskNames: [...new Set(taskNames)].sort(),
  };
};

const [nativePath, acePath, reportPath] = process.argv.slice(2);
if (nativePath === undefined || acePath === undefined || reportPath === undefined) {
  throw new Error('Usage: tsx scripts/harbor-retrieval-gate.ts <native-result.json> <ace-result.json> <report.json>');
}

const native = await summarize(nativePath);
const ace = await summarize(acePath);
const paired = native.trials === ace.trials && native.trials >= 3
  && JSON.stringify(native.taskNames) === JSON.stringify(ace.taskNames);
const qualityNonInferior = ace.successes / ace.trials >= native.successes / native.trials;
const attributed = native.aceCalls === 0 && ace.aceCalls > 0;
const report = {
  evidence: 'real-harbor-trials',
  native,
  ace,
  paired,
  qualityNonInferior,
  aceInvocationsObserved: attributed,
  measuredTokenRatio: native.totalTokens === null || ace.totalTokens === null || ace.totalTokens === 0
    ? null : native.totalTokens / ace.totalTokens,
  measuredCostRatio: native.costUsd === null || ace.costUsd === null || ace.costUsd === 0
    ? null : native.costUsd / ace.costUsd,
  target5xReached: paired && qualityNonInferior && attributed && ace.totalTokens !== null
    && native.totalTokens !== null && ace.totalTokens > 0 && native.totalTokens / ace.totalTokens >= 5,
  acceptance: paired && qualityNonInferior && attributed ? 'measured-not-necessarily-5x' : 'rejected',
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify(report) + '\n');
if (report.acceptance === 'rejected') process.exitCode = 2;
