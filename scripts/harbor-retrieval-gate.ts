import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { isObservedAceContextJsonLine, isSuccessfulAceContextJsonLine } from '../src/domain/harbor-mcp-evidence.js';
import { assessHarborAcceptance } from '../src/domain/harbor-evaluation-policy.js';

type JsonObject = Readonly<Record<string, unknown>>;
type Configuration = 'native-codex' | 'codex-plus-ace';
const requiredProviderOperations = [
  'embedding:embed_many',
  'qdrant:query_points',
  'tree_sitter:extract',
  'typescript_language_service:definition',
] as const;

interface ProviderReceiptSummary {
  readonly traceFiles: readonly string[];
  readonly successfulProviders: readonly string[];
  readonly successfulOperations: readonly string[];
  readonly valid: boolean;
}

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
  readonly rawTotalTokens: number | null;
  readonly costUsd: number | null;
  readonly externalProviderCostUsd: number | null;
  readonly aceCalls: number;
  readonly aceObservedCalls: number;
  readonly aceIncompleteCalls: number;
  readonly currentSourceCalls: number;
  readonly taskNames: readonly string[];
  readonly taskStats: readonly TaskSummary[];
  readonly providerReceipts: readonly ProviderReceiptSummary[];
}

interface TaskSummary {
  readonly taskName: string;
  readonly trials: number;
  readonly successes: number;
  readonly failures: number;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly rawTotalTokens: number | null;
  readonly costUsd: number | null;
  readonly latencyMsMedian: number | null;
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
const optionalInteger = (value: unknown, path: string): number | null => value === null || value === undefined ? null : integer(value, path);
const optionalNumber = (value: unknown, path: string): number | null => value === null || value === undefined ? null : number(value, path);
const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex');
const readJson = async (path: string): Promise<JsonObject> => object(JSON.parse(await readFile(path, 'utf8')) as unknown, path);

const trialDirectories = async (aggregatePath: string): Promise<readonly string[]> => {
  const parent = dirname(resolve(aggregatePath));
  const entries = await readdir(parent, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(parent, entry.name)).sort();
};

const filesNamed = async (root: string, name: string): Promise<readonly string[]> => {
  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === name) found.push(path);
    }
  };
  await visit(root);
  return found.sort();
};

const isCurrentSourceAceContextJsonLine = (line: string): boolean => {
  try {
    const event = object(JSON.parse(line) as unknown, 'Codex event');
    const item = object(event.item, 'Codex event.item');
    if (!isSuccessfulAceContextJsonLine(line)) return false;
    const result = object(item.result, 'Codex event.item.result');
    const structured = object(result.structured_content, 'Codex event.item.result.structured_content');
    if (!Array.isArray(structured.evidence)) return false;
    return structured.evidence.some((candidate) => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return false;
      const evidence = candidate as JsonObject;
      return evidence.freshness === 'current'
        && typeof evidence.citation === 'string' && evidence.citation.length > 0
        && typeof evidence.content === 'string' && evidence.content.length > 0;
    });
  } catch {
    return false;
  }
};

const providerReceipts = async (directory: string): Promise<ProviderReceiptSummary> => {
  const traceFiles = await filesNamed(directory, 'provider-trace.jsonl');
  const successful = new Set<string>();
  const operations = new Set<string>();
  for (const path of traceFiles) {
    const content = await readFile(path, 'utf8');
    for (const line of content.split('\n').filter((value) => value.trim().length > 0)) {
      const event = object(JSON.parse(line) as unknown, path);
      if (event.status === 'success' && typeof event.provider === 'string' && typeof event.operation === 'string') {
        successful.add(event.provider);
        operations.add(event.provider + ':' + event.operation);
      }
      const forbidden = ['source', 'query', 'text', 'token', 'secret', 'authorization'];
      if (forbidden.some((key) => key in event)) throw new Error(`${path}: unsafe provider trace field ${forbidden.find((key) => key in event)}`);
    }
  }
  return {
    traceFiles: traceFiles.map((path) => relative(process.cwd(), path)),
    successfulProviders: [...successful].sort(),
    successfulOperations: [...operations].sort(),
    valid: requiredProviderOperations.every((operation) => operations.has(operation)),
  };
};

const summarize = async (aggregatePath: string, configuration: Configuration): Promise<JobSummary> => {
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
  let aceObservedCalls = 0;
  let currentSourceCalls = 0;
  const taskNames: string[] = [];
  const receipts: ProviderReceiptSummary[] = [];
  const perTask = new Map<string, { trials: number; successes: number; input: number; cached: number; output: number; cost: number; latencies: number[]; completeUsage: boolean }>();
  for (const directory of trials) {
    const trial = await readJson(join(directory, 'result.json'));
    const taskName = trial.task_name;
    if (typeof taskName !== 'string' || taskName.length === 0) throw new Error(`${directory}: missing task_name`);
    taskNames.push(taskName);
    const task = perTask.get(taskName) ?? { trials: 0, successes: 0, input: 0, cached: 0, output: 0, cost: 0, latencies: [], completeUsage: true };
    task.trials += 1;
    const exception = trial.exception_info;
    const verifier = trial.verifier_result === null || trial.verifier_result === undefined ? null : object(trial.verifier_result, `${directory}.verifier_result`);
    const rewards = verifier === null || verifier.rewards === null || verifier.rewards === undefined ? null : object(verifier.rewards, `${directory}.verifier_result.rewards`);
    const trialSuccess = (exception === null || exception === undefined) && rewards !== null && number(rewards.reward, `${directory}.reward`) === 1;
    if (trialSuccess) {
      successes += 1;
      task.successes += 1;
    }
    const agentResult = trial.agent_result === null || trial.agent_result === undefined ? null : object(trial.agent_result, `${directory}.agent_result`);
    if (agentResult === null) task.completeUsage = false;
    else {
      const input = optionalInteger(agentResult.n_input_tokens, `${directory}.agent_result.n_input_tokens`);
      const cached = optionalInteger(agentResult.n_cache_tokens, `${directory}.agent_result.n_cache_tokens`);
      const output = optionalInteger(agentResult.n_output_tokens, `${directory}.agent_result.n_output_tokens`);
      const cost = optionalNumber(agentResult.cost_usd, `${directory}.agent_result.cost_usd`);
      if (input === null || cached === null || output === null || cost === null) task.completeUsage = false;
      else { task.input += input; task.cached += cached; task.output += output; task.cost += cost; }
    }
    const startedAt = typeof trial.started_at === 'string' ? Date.parse(trial.started_at) : Number.NaN;
    const finishedAt = typeof trial.finished_at === 'string' ? Date.parse(trial.finished_at) : Number.NaN;
    if (Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt >= startedAt) task.latencies.push(finishedAt - startedAt);
    let trace = '';
    try { trace = await readFile(join(directory, 'agent', 'codex.txt'), 'utf8'); } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    aceCalls += trace.split('\n').filter(isSuccessfulAceContextJsonLine).length;
    aceObservedCalls += trace.split('\n').filter(isObservedAceContextJsonLine).length;
    currentSourceCalls += trace.split('\n').filter(isCurrentSourceAceContextJsonLine).length;
    receipts.push(await providerReceipts(directory));
    perTask.set(taskName, task);
  }
  if (trials.length !== totalTrials) throw new Error(`${aggregatePath}: aggregate/trial count mismatch`);
  if (configuration === 'native-codex' && (aceObservedCalls !== 0 || currentSourceCalls !== 0)) throw new Error(`${aggregatePath}: native baseline unexpectedly called ACE MCP`);
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
    rawTotalTokens: inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens,
    costUsd,
    // Local CPU/RAM/indexing and model acquisition were not metered. Zero would
    // falsely present an unknown end-to-end cost as a measured free service.
    externalProviderCostUsd: null,
    aceCalls,
    aceObservedCalls,
    aceIncompleteCalls: aceObservedCalls - aceCalls,
    currentSourceCalls,
    taskNames: [...taskNames].sort(),
    taskStats: [...perTask.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([taskName, task]) => {
      const sorted = [...task.latencies].sort((left, right) => left - right);
      return {
        taskName,
        trials: task.trials,
        successes: task.successes,
        failures: task.trials - task.successes,
        inputTokens: task.completeUsage ? task.input : null,
        cachedInputTokens: task.completeUsage ? task.cached : null,
        outputTokens: task.completeUsage ? task.output : null,
        rawTotalTokens: task.completeUsage ? task.input + task.output : null,
        costUsd: task.completeUsage ? task.cost : null,
        latencyMsMedian: sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)],
      };
    }),
    providerReceipts: receipts,
  };
};

const [nativePath, acePath, reportPath] = process.argv.slice(2);
if (nativePath === undefined || acePath === undefined || reportPath === undefined) throw new Error('Usage: tsx scripts/harbor-retrieval-gate.ts <native-result.json> <ace-result.json> <report.json>');
const native = await summarize(nativePath, 'native-codex');
const ace = await summarize(acePath, 'codex-plus-ace');
const receiptGate = ace.providerReceipts.length === ace.trials && ace.providerReceipts.every((receipt) => receipt.valid);
const paired = native.trials === ace.trials && native.trials >= 9 && JSON.stringify(native.taskNames) === JSON.stringify(ace.taskNames);
const qualityNonInferior = native.trials > 0 && ace.successes / ace.trials >= native.successes / native.trials;
const attributed = native.aceObservedCalls === 0 && ace.aceCalls > 0 && ace.currentSourceCalls === ace.aceCalls;
// This is a deliberately FORCED tool-use experiment: the ACE arm's additional
// instruction requires an extra call. Provider operations are uncorrelated
// with individual MCP request IDs. Do not promote this to a production DBC-12
// effectiveness claim regardless of the ratio.
const evaluationDesign = 'forced-tool-use';
const providerCorrelationVerified = false;
const acceptance = assessHarborAcceptance({
  paired,
  qualityNonInferior,
  actualAceCallObserved: ace.aceObservedCalls > 0 && native.aceObservedCalls === 0,
  codeEvidenceObserved: attributed,
  providerOperationsObserved: receiptGate,
  forcedToolUse: true,
  providerRequestCorrelationVerified: providerCorrelationVerified,
  completeCostTelemetry: false,
});
const report = {
  evidence: 'real-harbor-retrieval-trials',
  native,
  ace,
  paired,
  qualityNonInferior,
  evaluationDesign,
  aceInvocationsObserved: ace.aceObservedCalls > 0,
  completeAceCallsObserved: attributed,
  providerOperationsObserved: receiptGate,
  providerCorrelationVerified,
  providerReceiptsVerified: false, // no per-request provider correlation
  costScope: 'codex-reported-usage-only; local infrastructure cost unmeasured',
  rawTotalTokens: { native: native.rawTotalTokens, ace: ace.rawTotalTokens },
  uncachedInputTokens: {
    native: native.inputTokens === null || native.cachedInputTokens === null ? null : native.inputTokens - native.cachedInputTokens,
    ace: ace.inputTokens === null || ace.cachedInputTokens === null ? null : ace.inputTokens - ace.cachedInputTokens,
  },
  costUsd: { native: native.costUsd, ace: ace.costUsd },
  externalProviderCostUsd: { native: native.externalProviderCostUsd, ace: ace.externalProviderCostUsd },
  savingsFactor: native.rawTotalTokens === null || ace.rawTotalTokens === null || ace.rawTotalTokens === 0 ? null : native.rawTotalTokens / ace.rawTotalTokens,
  tokenReduction: native.rawTotalTokens === null || ace.rawTotalTokens === null || native.rawTotalTokens === 0 ? null : 1 - ace.rawTotalTokens / native.rawTotalTokens,
  costSavingsFactor: native.costUsd === null || ace.costUsd === null || ace.costUsd === 0 ? null : native.costUsd / ace.costUsd,
  costReduction: native.costUsd === null || ace.costUsd === null || native.costUsd === 0 ? null : 1 - ace.costUsd / native.costUsd,
  target5xReached: false, // a forced tool invocation cannot close DBC-12
  acceptance,
  productionAcceptance: 'rejected',
  limitations: [
    'ACE was forced by an extra instruction, so natural tool-choice savings were not tested.',
    'Only three small tasks repeated three times; this is not a large-repository long-horizon workload.',
    'Provider operations are observed in each trial, not tied to an individual request/citation.',
    'Local embedding, Qdrant, Tree-sitter and TypeScript LS CPU/RAM cost and index setup are not metered.',
    'Raw totals include cached input tokens; Codex cost represents its reported usage only.',
  ],
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify(report) + '\n');
if (report.acceptance === 'rejected') process.exitCode = 2;
