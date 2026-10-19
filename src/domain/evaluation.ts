import { domainError, type DomainError } from './errors.js';
import { err, isErr, ok, type Result } from './result.js';

export type SuiteId = string & { readonly __brand: 'SuiteId' };
export type SuiteVersion = number & { readonly __brand: 'SuiteVersion' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type RunId = string & { readonly __brand: 'RunId' };
export type AgentConfigId = string & { readonly __brand: 'AgentConfigId' };
export type UsageSampleId = string & { readonly __brand: 'UsageSampleId' };
export type ReportId = string & { readonly __brand: 'ReportId' };

export type Measurement<Value> =
  | { readonly status: 'known'; readonly value: Value }
  | { readonly status: 'unknown'; readonly reason: string };

export const known = <Value>(value: Value): Measurement<Value> => ({ status: 'known', value });

export const unknown = <Value>(reason: string): Measurement<Value> => ({ status: 'unknown', reason });

const isKnown = <Value>(value: Measurement<Value>): value is { readonly status: 'known'; readonly value: Value } =>
  value.status === 'known';

const identifier = <Brand extends string>(value: unknown, path: string): Result<Brand, DomainError> => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return err(domainError('INVALID_BENCHMARK', path, `${path} must be a non-empty string`));
  }
  return ok(value.trim() as Brand);
};

export const makeSuiteId = (value: unknown): Result<SuiteId, DomainError> => identifier(value, 'suite_id');
export const makeTaskId = (value: unknown): Result<TaskId, DomainError> => identifier(value, 'task_id');
export const makeRunId = (value: unknown): Result<RunId, DomainError> => identifier(value, 'run_id');
export const makeReportId = (value: unknown): Result<ReportId, DomainError> => identifier(value, 'report_id');
export const makeAgentConfigId = (value: unknown): Result<AgentConfigId, DomainError> =>
  identifier(value, 'agent_config_id');

export const makeSuiteVersion = (value: unknown): Result<SuiteVersion, DomainError> => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return err(domainError('INVALID_BENCHMARK', 'suite_version', 'suite version must be a positive integer'));
  }
  return ok(value as SuiteVersion);
};

export interface TaskManifest {
  readonly taskId: TaskId;
  readonly taskVersion: string;
  readonly repoBaseCommit: string;
  readonly taskInputDigest: string;
  readonly qualityCommands: readonly string[];
}

export interface EvaluationSuite {
  readonly suiteId: SuiteId;
  readonly suiteVersion: SuiteVersion;
  readonly taskManifests: readonly TaskManifest[];
  readonly frozen: boolean;
  readonly holdout: boolean;
  readonly qualityRubric: string;
  readonly comparatorSet: readonly string[];
  readonly environmentRules: readonly string[];
  readonly suiteFingerprint?: string;
}

export interface EvaluationSuiteInput {
  readonly suiteId: unknown;
  readonly suiteVersion: unknown;
  readonly taskManifests: readonly TaskManifest[];
  readonly holdout: boolean;
  readonly qualityRubric: string;
  readonly comparatorSet: readonly string[];
  readonly environmentRules: readonly string[];
}

const validateTaskManifest = (task: TaskManifest, index: number): Result<TaskManifest, DomainError> => {
  const taskId = makeTaskId(task.taskId);
  if (isErr(taskId)) return err(domainError('INVALID_BENCHMARK', `task_manifests[${index}].task_id`, taskId.error.message));
  const fields = [
    ['taskVersion', task.taskVersion],
    ['repoBaseCommit', task.repoBaseCommit],
    ['taskInputDigest', task.taskInputDigest],
  ] as const;
  const invalidField = fields.find(([, value]) => typeof value !== 'string' || value.trim().length === 0);
  if (invalidField !== undefined) {
    return err(domainError('INVALID_BENCHMARK', `task_manifests[${index}].${invalidField[0]}`, 'field must be non-empty'));
  }
  if (!Array.isArray(task.qualityCommands) || task.qualityCommands.some((command) => command.trim().length === 0)) {
    return err(domainError('INVALID_BENCHMARK', `task_manifests[${index}].quality_commands`, 'quality commands must be non-empty'));
  }
  return ok({
    ...task,
    taskId: taskId.value,
    taskVersion: task.taskVersion.trim(),
    repoBaseCommit: task.repoBaseCommit.trim(),
    taskInputDigest: task.taskInputDigest.trim(),
    qualityCommands: [...task.qualityCommands],
  });
};

export const makeEvaluationSuite = (input: EvaluationSuiteInput): Result<EvaluationSuite, DomainError> => {
  const suiteId = makeSuiteId(input.suiteId);
  const suiteVersion = makeSuiteVersion(input.suiteVersion);
  if (isErr(suiteId)) return suiteId;
  if (isErr(suiteVersion)) return suiteVersion;
  if (!Array.isArray(input.taskManifests) || input.taskManifests.length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'task_manifests', 'suite must contain at least one task'));
  }
  if (typeof input.qualityRubric !== 'string' || input.qualityRubric.trim().length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'quality_rubric', 'quality rubric must be non-empty'));
  }
  const tasks: TaskManifest[] = [];
  for (const [index, task] of input.taskManifests.entries()) {
    const validated = validateTaskManifest(task, index);
    if (isErr(validated)) return validated;
    tasks.push(validated.value);
  }
  if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length) {
    return err(domainError('INVALID_BENCHMARK', 'task_manifests', 'task ids must be unique'));
  }
  return ok({
    suiteId: suiteId.value,
    suiteVersion: suiteVersion.value,
    taskManifests: tasks,
    frozen: false,
    holdout: input.holdout,
    qualityRubric: input.qualityRubric.trim(),
    comparatorSet: [...input.comparatorSet],
    environmentRules: [...input.environmentRules],
  });
};

export const evaluationSuiteFingerprintSource = (suite: EvaluationSuite): string => JSON.stringify({
  suiteId: suite.suiteId,
  suiteVersion: suite.suiteVersion,
  taskManifests: suite.taskManifests,
  holdout: suite.holdout,
  qualityRubric: suite.qualityRubric,
  comparatorSet: suite.comparatorSet,
  environmentRules: suite.environmentRules,
});

export const freezeEvaluationSuiteWithFingerprint = (
  suite: EvaluationSuite,
  fingerprint: string,
): Result<EvaluationSuite, DomainError> => {
  if (suite.frozen) return ok(suite);
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) {
    return err(domainError('INVALID_BENCHMARK', 'suite_fingerprint', 'suite fingerprint must be a SHA-256 digest'));
  }
  return ok({
    ...suite,
    frozen: true,
    suiteFingerprint: fingerprint,
  });
};

export const freezeEvaluationSuite = freezeEvaluationSuiteWithFingerprint;

export const addSuiteTask = (suite: EvaluationSuite, task: TaskManifest): Result<EvaluationSuite, DomainError> => {
  if (suite.frozen) return err(domainError('INVALID_BENCHMARK', 'suite', 'frozen suite requires a new version'));
  return makeEvaluationSuite({ ...suite, taskManifests: [...suite.taskManifests, task] });
};

export type BenchmarkRunState =
  | 'Prepared'
  | 'Running'
  | 'Finished'
  | 'Aborted'
  | 'Grading'
  | 'Recorded'
  | 'RecordedIncomplete';

export type QualityStatus = 'passed' | 'failed' | 'unknown';

export interface QualityOutcome {
  readonly status: QualityStatus;
  readonly passedChecks: number;
  readonly failedChecks: number;
  readonly hiddenChecks: Measurement<number>;
  readonly failureReason?: string;
}

export interface BenchmarkRun {
  readonly runId: RunId;
  readonly suiteVersion: SuiteVersion;
  readonly taskId: TaskId;
  readonly agentConfigId: AgentConfigId;
  readonly repoBaseCommit: string;
  readonly environmentFingerprint?: string;
  readonly state: BenchmarkRunState;
  readonly usageLedger?: UsageLedger;
  readonly quality?: QualityOutcome;
  readonly failureReason?: string;
  readonly startedAtMs?: number;
  readonly endedAtMs?: number;
}

export interface BenchmarkRunInput {
  readonly runId: unknown;
  readonly suite: EvaluationSuite;
  readonly taskId: unknown;
  readonly agentConfigId: unknown;
  readonly repoBaseCommit: string;
}

export const makeBenchmarkRun = (input: BenchmarkRunInput): Result<BenchmarkRun, DomainError> => {
  if (!input.suite.frozen) return err(domainError('INVALID_BENCHMARK', 'suite', 'benchmark requires a frozen suite'));
  const runId = makeRunId(input.runId);
  const taskId = makeTaskId(input.taskId);
  const agentConfigId = makeAgentConfigId(input.agentConfigId);
  if (isErr(runId)) return runId;
  if (isErr(taskId)) return taskId;
  if (isErr(agentConfigId)) return agentConfigId;
  if (!input.suite.taskManifests.some((task) => task.taskId === taskId.value)) {
    return err(domainError('INVALID_BENCHMARK', 'task_id', 'task is not present in the frozen suite'));
  }
  if (typeof input.repoBaseCommit !== 'string' || input.repoBaseCommit.trim().length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'repo_base_commit', 'repository base commit is required'));
  }
  return ok({
    runId: runId.value,
    suiteVersion: input.suite.suiteVersion,
    taskId: taskId.value,
    agentConfigId: agentConfigId.value,
    repoBaseCommit: input.repoBaseCommit.trim(),
    state: 'Prepared',
  });
};

const timestamp = (value: number, path: string): Result<number, DomainError> =>
  Number.isSafeInteger(value) && value > 0
    ? ok(value)
    : err(domainError('INVALID_BENCHMARK', path, 'timestamp must be a positive integer'));

export type BenchmarkRunEvent =
  | { readonly type: 'environment_ready'; readonly fingerprint: string; readonly startedAtMs: number }
  | { readonly type: 'agent_finished'; readonly endedAtMs: number }
  | { readonly type: 'aborted'; readonly endedAtMs: number; readonly reason: string }
  | { readonly type: 'start_grading' }
  | { readonly type: 'record'; readonly quality: QualityOutcome; readonly usage: UsageLedger }
  | { readonly type: 'record_incomplete'; readonly quality: QualityOutcome; readonly reason: string };

export const transitionBenchmarkRun = (
  run: BenchmarkRun,
  event: BenchmarkRunEvent,
): Result<BenchmarkRun, DomainError> => {
  const invalid = () => err(domainError('INVALID_BENCHMARK', 'state', `event ${event.type} is invalid from ${run.state}`));
  if (run.state === 'Prepared' && event.type === 'environment_ready') {
    const startedAtMs = timestamp(event.startedAtMs, 'started_at_ms');
    if (isErr(startedAtMs)) return startedAtMs;
    if (event.fingerprint.trim().length === 0) return err(domainError('INVALID_BENCHMARK', 'environment_fingerprint', 'fingerprint is required'));
    return ok({ ...run, state: 'Running', environmentFingerprint: event.fingerprint, startedAtMs: startedAtMs.value });
  }
  if (run.state === 'Running' && event.type === 'agent_finished') {
    const endedAtMs = timestamp(event.endedAtMs, 'ended_at_ms');
    if (isErr(endedAtMs)) return endedAtMs;
    return ok({ ...run, state: 'Finished', endedAtMs: endedAtMs.value });
  }
  if (run.state === 'Running' && event.type === 'aborted') {
    const endedAtMs = timestamp(event.endedAtMs, 'ended_at_ms');
    if (isErr(endedAtMs)) return endedAtMs;
    if (event.reason.trim().length === 0) return err(domainError('INVALID_BENCHMARK', 'failure_reason', 'abort reason is required'));
    return ok({ ...run, state: 'Aborted', endedAtMs: endedAtMs.value, failureReason: event.reason.trim() });
  }
  if ((run.state === 'Finished' || run.state === 'Aborted') && event.type === 'start_grading') {
    return ok({ ...run, state: 'Grading' });
  }
  if (run.state === 'Grading' && event.type === 'record') {
    return ok({ ...run, state: 'Recorded', quality: event.quality, usageLedger: event.usage });
  }
  if (run.state === 'Grading' && event.type === 'record_incomplete') {
    if (event.reason.trim().length === 0) return err(domainError('INVALID_BENCHMARK', 'failure_reason', 'incomplete reason is required'));
    return ok({ ...run, state: 'RecordedIncomplete', quality: event.quality, failureReason: event.reason.trim() });
  }
  return invalid();
};

export interface UsageEventInput {
  readonly eventId: unknown;
  readonly provider: unknown;
  readonly eventSource: unknown;
  readonly counterKind: unknown;
  readonly sequence: unknown;
  readonly rawEvent: unknown;
}

export interface UsageSample {
  readonly sampleId: UsageSampleId;
  readonly eventId: string;
  readonly provider: string;
  readonly eventSource: string;
  readonly counterKind: 'delta' | 'cumulative';
  readonly sequence: number;
  readonly inputTokens: Measurement<number>;
  readonly cachedInputTokens: Measurement<number>;
  readonly outputTokens: Measurement<number>;
  readonly reasoningOutputTokens: Measurement<number>;
  readonly costUsd: Measurement<number>;
  readonly rawEvent: Readonly<Record<string, unknown>>;
  readonly unknownFields: Readonly<Record<string, unknown>>;
}

export interface UsageTotals {
  readonly inputTokens: Measurement<number>;
  readonly cachedInputTokens: Measurement<number>;
  readonly uncachedInputTokens: Measurement<number>;
  readonly outputTokens: Measurement<number>;
  readonly reasoningOutputTokens: Measurement<number>;
  readonly totalTokens: Measurement<number>;
  readonly costUsd: Measurement<number>;
}

export interface UsageLedger {
  readonly status: 'measured' | 'measurement_unavailable';
  readonly samples: readonly UsageSample[];
  readonly totals: UsageTotals;
  readonly deduplicatedEventIds: readonly string[];
  readonly externalUsage: readonly ExternalUsageRecord[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const measurementFrom = (value: unknown, path: string, integer = true): Result<Measurement<number>, DomainError> => {
  if (value === undefined || value === null) return ok(unknown('not_reported'));
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    return err(domainError('INVALID_USAGE', path, integer ? 'usage counter must be a non-negative integer' : 'usage cost must be a finite non-negative number'));
  }
  return ok(known(value));
};

const valueAt = (source: Record<string, unknown> | undefined, names: readonly string[]): unknown => {
  if (source === undefined) return undefined;
  return names.map((name) => source[name]).find((value) => value !== undefined);
};

const sampleId = (provider: string, eventId: string): UsageSampleId => `${provider}:${eventId}` as UsageSampleId;

export const normalizeUsageSample = (input: UsageEventInput): Result<UsageSample, DomainError> => {
  const values = [
    ['event_id', input.eventId],
    ['provider', input.provider],
    ['event_source', input.eventSource],
  ] as const;
  const invalidValue = values.find(([, value]) => typeof value !== 'string' || value.trim().length === 0);
  if (invalidValue !== undefined) return err(domainError('INVALID_USAGE', invalidValue[0], 'field must be non-empty'));
  if (input.counterKind !== 'delta' && input.counterKind !== 'cumulative') {
    return err(domainError('INVALID_USAGE', 'counter_kind', 'counter kind must be delta or cumulative'));
  }
  if (typeof input.sequence !== 'number' || !Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    return err(domainError('INVALID_USAGE', 'sequence', 'sequence must be a positive integer'));
  }
  if (!record(input.rawEvent)) return err(domainError('INVALID_USAGE', 'raw_event', 'raw usage event must be an object'));
  const rawEvent = input.rawEvent;
  const usage = record(rawEvent.usage) ? rawEvent.usage : rawEvent;
  const inputTokens = measurementFrom(valueAt(usage, ['input_tokens', 'inputTokens']), 'usage.input_tokens');
  const cachedInputTokens = measurementFrom(valueAt(usage, ['cached_input_tokens', 'cachedInputTokens']), 'usage.cached_input_tokens');
  const outputTokens = measurementFrom(valueAt(usage, ['output_tokens', 'outputTokens']), 'usage.output_tokens');
  const reasoningOutputTokens = measurementFrom(valueAt(usage, ['reasoning_output_tokens', 'reasoningOutputTokens']), 'usage.reasoning_output_tokens');
  const costUsd = measurementFrom(valueAt(rawEvent, ['cost_usd', 'costUsd']), 'usage.cost_usd', false);
  const measurements = [inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, costUsd];
  const invalidMeasurement = measurements.find((measurement) => isErr(measurement));
  if (invalidMeasurement !== undefined && isErr(invalidMeasurement)) return invalidMeasurement;
  if (isErr(inputTokens)) return inputTokens;
  if (isErr(cachedInputTokens)) return cachedInputTokens;
  if (isErr(outputTokens)) return outputTokens;
  if (isErr(reasoningOutputTokens)) return reasoningOutputTokens;
  if (isErr(costUsd)) return costUsd;
  const eventId = input.eventId as string;
  const provider = input.provider as string;
  const eventSource = input.eventSource as string;
  const normalizedInput = inputTokens.value;
  const normalizedCached = cachedInputTokens.value;
  const normalizedOutput = outputTokens.value;
  const normalizedReasoning = reasoningOutputTokens.value;
  if (isKnown(normalizedInput) && isKnown(normalizedCached) && normalizedCached.value > normalizedInput.value) {
    return err(domainError('INVALID_USAGE', 'usage.cached_input_tokens', 'cached input cannot exceed input tokens'));
  }
  if (isKnown(normalizedOutput) && isKnown(normalizedReasoning) && normalizedReasoning.value > normalizedOutput.value) {
    return err(domainError('INVALID_USAGE', 'usage.reasoning_output_tokens', 'reasoning output cannot exceed output tokens'));
  }
  const knownKeys = new Set([
    'usage',
    'input_tokens',
    'inputTokens',
    'cached_input_tokens',
    'cachedInputTokens',
    'output_tokens',
    'outputTokens',
    'reasoning_output_tokens',
    'reasoningOutputTokens',
    'cost_usd',
    'costUsd',
  ]);
  const unknownFields = Object.fromEntries(Object.entries(rawEvent).filter(([key]) => !knownKeys.has(key)));
  return ok({
    sampleId: sampleId(provider.trim(), eventId.trim()),
    eventId: eventId.trim(),
    provider: provider.trim(),
    eventSource: eventSource.trim(),
    counterKind: input.counterKind,
    sequence: input.sequence,
    inputTokens: normalizedInput,
    cachedInputTokens: normalizedCached,
    outputTokens: normalizedOutput,
    reasoningOutputTokens: normalizedReasoning,
    costUsd: costUsd.value,
    rawEvent,
    unknownFields,
  });
};

const addMeasurements = (left: Measurement<number>, right: Measurement<number>): Measurement<number> => {
  if (!isKnown(left)) return unknown(left.reason);
  if (!isKnown(right)) return unknown(right.reason);
  return known(left.value + right.value);
};

const subtractMeasurements = (
  current: Measurement<number>,
  previous: Measurement<number>,
  path: string,
): Result<Measurement<number>, DomainError> => {
  if (!isKnown(current) || !isKnown(previous)) return ok(unknown('cumulative_counter_unavailable'));
  if (current.value < previous.value) return err(domainError('INVALID_USAGE', path, 'cumulative counter decreased'));
  return ok(known(current.value - previous.value));
};

const measurementTotal = (input: Measurement<number>, output: Measurement<number>): Measurement<number> =>
  isKnown(input) && isKnown(output) ? known(input.value + output.value) : unknown('input_or_output_unavailable');

const usageTotals = (
  input: Measurement<number>,
  cached: Measurement<number>,
  output: Measurement<number>,
  reasoning: Measurement<number>,
  cost: Measurement<number>,
): UsageTotals => ({
  inputTokens: input,
  cachedInputTokens: cached,
  uncachedInputTokens: isKnown(input) && isKnown(cached)
    ? known(input.value - cached.value)
    : unknown('input_or_cached_input_unavailable'),
  outputTokens: output,
  reasoningOutputTokens: reasoning,
  totalTokens: measurementTotal(input, output),
  costUsd: cost,
});

const fieldsFrom = (sample: UsageSample): readonly Measurement<number>[] => [
  sample.inputTokens,
  sample.cachedInputTokens,
  sample.outputTokens,
  sample.reasoningOutputTokens,
];

export const normalizeUsageLedger = (samples: readonly UsageSample[]): Result<UsageLedger, DomainError> => {
  const seen = new Set<string>();
  const deduplicatedEventIds: string[] = [];
  const unique = samples.filter((sample) => {
    if (seen.has(sample.eventId)) {
      deduplicatedEventIds.push(sample.eventId);
      return false;
    }
    seen.add(sample.eventId);
    return true;
  }).sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
  if (unique.length === 0) {
    const unavailable = unknown<number>('no_usage_samples');
    return ok({
      status: 'measurement_unavailable',
      samples: [],
      totals: usageTotals(unavailable, unavailable, unavailable, unavailable, unavailable),
      deduplicatedEventIds,
      externalUsage: [],
    });
  }
  const kinds = new Set(unique.map((sample) => sample.counterKind));
  if (kinds.size > 1) return err(domainError('INVALID_USAGE', 'counter_kind', 'delta and cumulative events cannot be mixed in one ledger'));
  const first = unique[0];
  if (first === undefined) return err(domainError('INVALID_USAGE', 'samples', 'usage sample is missing'));
  const cumulative = first.counterKind === 'cumulative';
  const totals: Array<Measurement<number> | undefined> = [];
  const costValues: Measurement<number>[] = [];
  let previous: UsageSample | undefined;
  for (const sample of unique) {
    const fields = fieldsFrom(sample);
    const values: Measurement<number>[] = [];
    for (const [index, field] of fields.entries()) {
      if (!cumulative || previous === undefined) {
        values.push(field);
      } else {
        const previousField = fieldsFrom(previous)[index];
        if (previousField === undefined) return err(domainError('INVALID_USAGE', 'usage', 'usage field is missing'));
        const difference = subtractMeasurements(field, previousField, `usage.field_${index}`);
        if (isErr(difference)) return difference;
        values.push(difference.value);
      }
    }
    values.forEach((value, index) => {
      const prior = totals[index];
      totals[index] = prior === undefined ? value : addMeasurements(prior, value);
    });
    costValues.push(sample.costUsd);
    previous = sample;
  }
  const cost = costValues.reduce<Measurement<number>>((sum, value) => addMeasurements(sum, value), known(0));
  const input = totals[0] ?? unknown<number>('input_unavailable');
  const cached = totals[1] ?? unknown<number>('cached_input_unavailable');
  const output = totals[2] ?? unknown<number>('output_unavailable');
  const reasoning = totals[3] ?? unknown<number>('reasoning_output_unavailable');
  const normalizedTotals = usageTotals(input, cached, output, reasoning, cost);
  const unavailable = !isKnown(normalizedTotals.inputTokens) || !isKnown(normalizedTotals.outputTokens);
  return ok({
    status: unavailable ? 'measurement_unavailable' : 'measured',
    samples: unique,
    totals: normalizedTotals,
    deduplicatedEventIds,
    externalUsage: [],
  });
};

export type ExternalProvider = 'vertex' | 'embedding' | 'graphiti' | 'jev' | 'indexing';

export interface ExternalUsageRecord {
  readonly provider: ExternalProvider;
  readonly status: 'measured' | 'unsupported';
  readonly inputTokens: Measurement<number>;
  readonly outputTokens: Measurement<number>;
  readonly costUsd: Measurement<number>;
  readonly reason?: string;
  readonly rawEvent?: Readonly<Record<string, unknown>>;
}

export const unsupportedExternalUsage = (
  provider: ExternalProvider,
  reason: string,
): Result<ExternalUsageRecord, DomainError> => {
  if (reason.trim().length === 0) return err(domainError('UNSUPPORTED_PROVIDER', 'reason', 'unsupported reason is required'));
  return ok({
    provider,
    status: 'unsupported',
    inputTokens: unknown('unsupported'),
    outputTokens: unknown('unsupported'),
    costUsd: unknown('unsupported'),
    reason: reason.trim(),
  });
};

export const attachExternalUsage = (ledger: UsageLedger, usage: ExternalUsageRecord): UsageLedger => ({
  ...ledger,
  externalUsage: [...ledger.externalUsage, usage],
});

export interface ComparisonRunMetric {
  readonly runId: RunId;
  readonly state: BenchmarkRunState;
  readonly quality: QualityStatus;
  readonly totalTokens: Measurement<number>;
  readonly costUsd: Measurement<number>;
}

export interface ComparisonReport {
  readonly reportId: ReportId;
  readonly suiteId: SuiteId;
  readonly suiteVersion: SuiteVersion;
  readonly frozenSuiteFingerprint: string;
  readonly runMetrics: readonly ComparisonRunMetric[];
  readonly totalRuns: number;
  readonly successfulRuns: number;
  /** Fraction passing quality among fully recorded (graded) runs only. */
  readonly qualityPassRate: Measurement<number>;
  readonly completionRate: Measurement<number>;
  readonly abortedRate: Measurement<number>;
  readonly incompleteRate: Measurement<number>;
  readonly limitations: readonly string[];
  readonly evidenceHash: string;
  readonly releasedAtMs: number;
}

export interface ComparisonReportInput {
  readonly reportId: unknown;
  readonly suite: EvaluationSuite;
  readonly runs: readonly BenchmarkRun[];
  readonly limitations: readonly string[];
  readonly evidenceHash: string;
  readonly releasedAtMs: number;
}

export const comparisonEvidenceSource = (report: Omit<ComparisonReport, 'evidenceHash'>): string => JSON.stringify({
  reportId: report.reportId,
  suiteFingerprint: report.frozenSuiteFingerprint,
  runMetrics: report.runMetrics,
  limitations: report.limitations,
});

export const makeComparisonReport = (input: ComparisonReportInput): Result<ComparisonReport, DomainError> => {
  if (!input.suite.frozen || input.suite.suiteFingerprint === undefined) {
    return err(domainError('INVALID_BENCHMARK', 'suite', 'comparison requires a frozen suite fingerprint'));
  }
  const reportId = makeReportId(input.reportId);
  if (isErr(reportId)) return reportId;
  if (input.runs.length === 0) return err(domainError('INVALID_BENCHMARK', 'runs', 'comparison requires at least one run'));
  if (input.runs.some((run) => run.suiteVersion !== input.suite.suiteVersion)) {
    return err(domainError('INVALID_BENCHMARK', 'runs', 'all runs must use the same suite version'));
  }
  if (!Number.isSafeInteger(input.releasedAtMs) || input.releasedAtMs < 1) {
    return err(domainError('INVALID_BENCHMARK', 'released_at_ms', 'release timestamp must be positive'));
  }
  if (!/^[a-f0-9]{64}$/u.test(input.evidenceHash)) {
    return err(domainError('INVALID_BENCHMARK', 'evidence_hash', 'evidence hash must be a SHA-256 digest'));
  }
  const runMetrics = input.runs.map((run): ComparisonRunMetric => ({
    runId: run.runId,
    state: run.state,
    quality: run.quality?.status ?? 'unknown',
    totalTokens: run.usageLedger?.totals.totalTokens ?? unknown('usage_unavailable'),
    costUsd: run.usageLedger?.totals.costUsd ?? unknown('cost_unavailable'),
  }));
  const recordedRuns = runMetrics.filter((run) => run.state === 'Recorded');
  const successfulRuns = recordedRuns.filter((run) => run.quality === 'passed').length;
  const abortedRuns = runMetrics.filter((run) => run.state === 'Aborted').length;
  const incompleteRuns = runMetrics.filter((run) => run.state === 'RecordedIncomplete').length;
  return ok({
    reportId: reportId.value,
    suiteId: input.suite.suiteId,
    suiteVersion: input.suite.suiteVersion,
    frozenSuiteFingerprint: input.suite.suiteFingerprint,
    runMetrics,
    totalRuns: runMetrics.length,
    successfulRuns,
    qualityPassRate: recordedRuns.length === 0
      ? unknown('no_fully_recorded_quality_results')
      : known(successfulRuns / recordedRuns.length),
    completionRate: known(recordedRuns.length / runMetrics.length),
    abortedRate: known(abortedRuns / runMetrics.length),
    incompleteRate: known(incompleteRuns / runMetrics.length),
    limitations: [...input.limitations],
    evidenceHash: input.evidenceHash,
    releasedAtMs: input.releasedAtMs,
  });
};
