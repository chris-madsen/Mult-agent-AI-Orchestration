import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isSuccessfulAceContextJsonLine } from '../src/domain/harbor-mcp-evidence.js';

interface HarborAggregateStats {
  readonly n_completed_trials: number;
  readonly n_errored_trials: number;
  readonly n_running_trials: number;
  readonly n_pending_trials: number;
  readonly n_cancelled_trials: number;
  readonly n_input_tokens: number | null;
  readonly n_cache_tokens: number | null;
  readonly n_output_tokens: number | null;
  readonly cost_usd: number | null;
  readonly evals: Record<string, {
    readonly n_trials: number;
    readonly metrics: readonly [{ readonly mean: number }];
    readonly pass_at_k: Record<string, number>;
  }>;
}

interface HarborAggregate {
  readonly n_total_trials: number;
  readonly stats: HarborAggregateStats;
}

interface HarborTrial {
  readonly trial_name?: string;
  readonly agent_result?: { readonly n_input_tokens?: number; readonly n_cache_tokens?: number; readonly n_output_tokens?: number; readonly cost_usd?: number } | null;
  readonly verifier_result?: { readonly rewards?: { readonly reward?: number } } | null;
  readonly exception_info?: unknown;
}

interface ConfigurationSummary {
  readonly configuration: 'native-codex' | 'codex-plus-ace';
  readonly aggregatePath: string;
  readonly aggregateSha256: string;
  readonly trials: number;
  readonly completed: number;
  readonly errors: number;
  readonly qualityMean: number;
  readonly passAt5: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly trialsWithRewardOne: number;
  readonly successfulAceContextCalls: number;
}

const asRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
};

const finiteNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  return value;
};

const integer = (value: unknown, path: string): number => {
  const number = finiteNumber(value, path);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${path} must be a non-negative integer`);
  return number;
};

const nullableNumber = (value: unknown, path: string): number => {
  if (value === null) throw new Error(`${path} is unavailable`);
  return finiteNumber(value, path);
};

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex');

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;

const readAggregate = async (path: string): Promise<{ readonly aggregate: HarborAggregate; readonly content: string }> => {
  const content = await readFile(path, 'utf8');
  const root = asRecord(JSON.parse(content) as unknown, path);
  const stats = asRecord(root.stats, `${path}.stats`);
  const evaluations = asRecord(stats.evals, `${path}.stats.evals`);
  const evaluation = Object.values(evaluations)[0];
  if (evaluation === undefined) throw new Error(`${path}.stats.evals must contain one evaluation`);
  const evaluationRecord = asRecord(evaluation, `${path}.stats.evals[0]`);
  const metrics = evaluationRecord.metrics;
  if (!Array.isArray(metrics) || metrics.length !== 1) throw new Error(`${path}.stats.evals[0].metrics must contain one metric`);
  const metric = asRecord(metrics[0], `${path}.stats.evals[0].metrics[0]`);
  const passAtK = asRecord(evaluationRecord.pass_at_k, `${path}.stats.evals[0].pass_at_k`);
  const aggregate: HarborAggregate = {
    n_total_trials: integer(root.n_total_trials, `${path}.n_total_trials`),
    stats: {
      n_completed_trials: integer(stats.n_completed_trials, `${path}.stats.n_completed_trials`),
      n_errored_trials: integer(stats.n_errored_trials, `${path}.stats.n_errored_trials`),
      n_running_trials: integer(stats.n_running_trials, `${path}.stats.n_running_trials`),
      n_pending_trials: integer(stats.n_pending_trials, `${path}.stats.n_pending_trials`),
      n_cancelled_trials: integer(stats.n_cancelled_trials, `${path}.stats.n_cancelled_trials`),
      n_input_tokens: stats.n_input_tokens === null ? null : integer(stats.n_input_tokens, `${path}.stats.n_input_tokens`),
      n_cache_tokens: stats.n_cache_tokens === null ? null : integer(stats.n_cache_tokens, `${path}.stats.n_cache_tokens`),
      n_output_tokens: stats.n_output_tokens === null ? null : integer(stats.n_output_tokens, `${path}.stats.n_output_tokens`),
      cost_usd: stats.cost_usd === null ? null : finiteNumber(stats.cost_usd, `${path}.stats.cost_usd`),
      evals: {
        primary: {
          n_trials: integer(evaluationRecord.n_trials, `${path}.stats.evals[0].n_trials`),
          metrics: [{ mean: finiteNumber(metric.mean, `${path}.stats.evals[0].metrics[0].mean`) }],
          pass_at_k: Object.fromEntries(Object.entries(passAtK).map(([key, value]) => [key, finiteNumber(value, `${path}.pass_at_k.${key}`)])),
        },
      },
    },
  };
  return { aggregate, content };
};

const trialDirectories = async (aggregatePath: string): Promise<readonly string[]> => {
  const entries = await readdir(resolve(aggregatePath, '..'), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(resolve(aggregatePath, '..'), entry.name)).sort();
};

const readTrials = async (aggregatePath: string): Promise<readonly { readonly trial: HarborTrial; readonly mcpCalls: number }[]> => {
  const directories = await trialDirectories(aggregatePath);
  const trials: { readonly trial: HarborTrial; readonly mcpCalls: number }[] = [];
  for (const directory of directories) {
    const resultPath = join(directory, 'result.json');
    let trial: HarborTrial;
    try {
      trial = asRecord(await readJson(resultPath), resultPath) as HarborTrial;
    } catch {
      continue;
    }
    let mcpCalls = 0;
    try {
      const log = await readFile(join(directory, 'agent', 'codex.txt'), 'utf8');
      for (const line of log.split('\n')) {
        try {
          if (isSuccessfulAceContextJsonLine(line)) mcpCalls += 1;
        } catch {
          // Non-JSON Codex stderr lines are retained but are not MCP evidence.
        }
      }
    } catch {
      // Missing logs are validated by the configuration-specific evidence rule.
    }
    trials.push({ trial, mcpCalls });
  }
  return trials;
};

const summarize = async (configuration: ConfigurationSummary['configuration'], aggregatePath: string): Promise<ConfigurationSummary> => {
  const { aggregate, content } = await readAggregate(aggregatePath);
  const stats = aggregate.stats;
  const trials = await readTrials(aggregatePath);
  const primary = Object.values(stats.evals)[0];
  if (primary === undefined) throw new Error(`${aggregatePath}: missing primary evaluation`);
  if (aggregate.n_total_trials !== 5 || stats.n_completed_trials !== 5 || stats.n_errored_trials !== 0 || stats.n_running_trials !== 0 || stats.n_pending_trials !== 0 || stats.n_cancelled_trials !== 0) throw new Error(`${aggregatePath}: expected five completed trials with no errors`);
  if (primary.n_trials !== 5 || primary.metrics[0].mean !== 1 || primary.pass_at_k['5'] !== 1) throw new Error(`${aggregatePath}: expected reward mean and pass@5 of 1.0`);
  if (trials.length !== 5 || trials.some(({ trial }) => trial.exception_info !== null && trial.exception_info !== undefined)) throw new Error(`${aggregatePath}: every trial must have a result without exception`);
  const trialsWithRewardOne = trials.filter(({ trial }) => trial.verifier_result?.rewards?.reward === 1).length;
  if (trialsWithRewardOne !== 5) throw new Error(`${aggregatePath}: every trial must have verifier reward 1.0`);
  const successfulAceContextCalls = trials.reduce((sum, item) => sum + item.mcpCalls, 0);
  if (configuration === 'native-codex' && successfulAceContextCalls !== 0) throw new Error(`${aggregatePath}: native baseline unexpectedly called ACE MCP`);
  const inputTokens = nullableNumber(stats.n_input_tokens, `${aggregatePath}.stats.n_input_tokens`);
  const cachedInputTokens = nullableNumber(stats.n_cache_tokens, `${aggregatePath}.stats.n_cache_tokens`);
  const outputTokens = nullableNumber(stats.n_output_tokens, `${aggregatePath}.stats.n_output_tokens`);
  return {
    configuration,
    aggregatePath,
    aggregateSha256: sha256(content),
    trials: aggregate.n_total_trials,
    completed: stats.n_completed_trials,
    errors: stats.n_errored_trials,
    qualityMean: primary.metrics[0].mean,
    passAt5: primary.pass_at_k['5'] ?? 0,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: nullableNumber(stats.cost_usd, `${aggregatePath}.stats.cost_usd`),
    trialsWithRewardOne,
    successfulAceContextCalls,
  };
};

const csvCell = (value: string | number): string => `"${String(value).replaceAll('"', '""')}"`;

const main = async (): Promise<void> => {
  const [nativePath = 'artifacts/harbor-native-natural-repeat5-serial/ace-local-smoke-native-natural-repeat5-serial/result.json', acePath = 'artifacts/harbor-ace-natural-repeat5-serial/ace-local-smoke-ace-natural-repeat5-serial/result.json', outputDirectory = 'benchmarks/reports'] = process.argv.slice(2);
  const native = await summarize('native-codex', nativePath);
  const ace = await summarize('codex-plus-ace', acePath);
  const report = {
    report_id: 'ace-local-smoke-natural-paired-repeat5',
    suite_id: 'ace-harness-local-paired',
    holdout: true,
    task_count: 1,
    mcp_mode: 'optional',
    configurations: [native, ace],
    deltas: {
      quality_mean: ace.qualityMean - native.qualityMean,
      total_tokens: ace.totalTokens - native.totalTokens,
      cost_usd: ace.costUsd - native.costUsd,
      cost_ratio_ace_over_native: ace.costUsd / native.costUsd,
    },
    limitations: [
      'This is one deterministic fixture task repeated five times, not a general coding benchmark.',
      'Both configurations achieved the same quality outcome; no quality advantage is established.',
      'The natural paired task made no ACE MCP calls in either arm; retrieval efficiency remains unmeasured.',
      'Serena, independent MCP and long-horizon memory extraction are not included in this comparison.',
      'The measured ACE overhead is provider-reported Codex usage/cost only; no external provider cost was present.',
      'No 5x improvement claim is permitted.',
    ],
  };
  const markdown = [
    '# ACE natural paired Harbor report',
    '',
    '- Suite: `ace-harness-local-paired`',
    '- Holdout: `true`',
    '- Trials per configuration: `5`',
    '',
    '| Configuration | Quality mean | Pass@5 | Input tokens | Output tokens | Total tokens | Cost USD | ACE calls |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...[native, ace].map((item) => `| ${item.configuration} | ${item.qualityMean} | ${item.passAt5} | ${item.inputTokens} | ${item.outputTokens} | ${item.totalTokens} | ${item.costUsd} | ${item.successfulAceContextCalls} |`),
    '',
    '## Interpretation',
    '',
    `- Quality delta (ACE - native): ${report.deltas.quality_mean}.`,
    `- Token delta (ACE - native): ${report.deltas.total_tokens}.`,
    `- Cost ratio (ACE/native): ${report.deltas.cost_ratio_ace_over_native.toFixed(3)}.`,
    '- ACE MCP was available but not called in the natural paired task; this measures no-regression behavior, not retrieval quality or a speedup.',
    '',
    '## Evidence',
    '',
    ...[native, ace].map((item) => `- ${item.configuration}: \`${item.aggregatePath}\`, SHA-256 \`${item.aggregateSha256}\`.`),
    '',
    '## Limitations',
    ...report.limitations.map((limitation) => `- ${limitation}`),
    '',
  ].join('\n');
  const csv = [
    'configuration,trials,completed,errors,quality_mean,pass_at_5,input_tokens,cached_input_tokens,output_tokens,total_tokens,cost_usd,successful_ace_context_calls,aggregate_sha256',
    ...[native, ace].map((item) => [item.configuration, item.trials, item.completed, item.errors, item.qualityMean, item.passAt5, item.inputTokens, item.cachedInputTokens, item.outputTokens, item.totalTokens, item.costUsd, item.successfulAceContextCalls, item.aggregateSha256].map(csvCell).join(',')),
  ].join('\n') + '\n';
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(outputDirectory, 'ace-local-smoke-natural-paired-repeat5.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(join(outputDirectory, 'ace-local-smoke-natural-paired-repeat5.md'), markdown, 'utf8'),
    writeFile(join(outputDirectory, 'ace-local-smoke-natural-paired-repeat5.csv'), csv, 'utf8'),
  ]);
  process.stdout.write(`${JSON.stringify({ report: 'ace-local-smoke-natural-paired-repeat5', nativeCostUsd: native.costUsd, aceCostUsd: ace.costUsd, costRatio: report.deltas.cost_ratio_ace_over_native })}\n`);
};

await main();
