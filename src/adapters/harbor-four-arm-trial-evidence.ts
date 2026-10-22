import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  isObservedAceToolJsonLine,
  isSuccessfulAceContextJsonLine,
  isSuccessfulAceToolJsonLine,
  successfulAceContextRequestIdJsonLine,
} from '../domain/harbor-mcp-evidence.js';
import type { HarborFourArmName } from '../domain/harbor-four-arm.js';
import type { HarborFourArmTrialObservation } from '../domain/harbor-four-arm-evidence.js';

type JsonObject = Readonly<Record<string, unknown>>;

const object = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
const integerOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;
const readJson = async (path: string): Promise<JsonObject> => {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const value = object(parsed);
  if (value === undefined) throw new Error(`BLOCKED: Harbor JSON must be an object: ${path}`);
  return value;
};

const trialDirectories = async (aggregatePath: string): Promise<readonly string[]> => {
  // The CLI accepts an actual Harbor result file, not a directory locator.
  // Previously a non-existent aggregate path silently worked if its parent
  // happened to contain unrelated run directories.
  await readJson(aggregatePath);
  const parent = dirname(resolve(aggregatePath));
  const entries = await readdir(parent, { withFileTypes: true });
  const paths = entries.filter((entry) => entry.isDirectory()).map((entry) => join(parent, entry.name)).sort();
  const started = await Promise.all(paths.map(async (path) => {
    const raw = await readJson(join(path, 'result.json'));
    const millis = typeof raw.started_at === 'string' ? Date.parse(raw.started_at) : Number.NaN;
    return { path, millis };
  }));
  // A frozen n_concurrent_trials=1 job's actual trial order is temporal.
  // Directory names can sort trial-10 before trial-2.
  if (started.every((item) => Number.isFinite(item.millis))) {
    started.sort((left, right) => left.millis - right.millis);
    if (started.some((item, index) => index > 0 && item.millis === started[index - 1]?.millis)) {
      throw new Error('BLOCKED: raw Harbor trials have ambiguous identical start timestamps');
    }
    return started.map((item) => item.path);
  }
  // Missing timestamps are reported as unknown latency below and cannot
  // authorize release, but preserve deterministic diagnostics.
  return paths;
};

const deliveryMetrics = (event: unknown): JsonObject | undefined => {
  const root = object(event);
  const item = object(root?.item);
  const result = object(item?.result);
  const structured = object(result?.structured_content) ?? object(result?.structuredContent);
  return object(structured?.delivery_metrics) ?? object(structured?.deliveryMetrics);
};

const structuredEvidenceReceiptIds = (event: unknown): {
  readonly all: readonly string[];
  readonly reused: readonly string[];
} => {
  const root = object(event);
  const item = object(root?.item);
  const result = object(item?.result);
  const structured = object(result?.structured_content) ?? object(result?.structuredContent);
  const evidence = Array.isArray(structured?.evidence) ? structured.evidence : [];
  const all: string[] = [];
  const reused: string[] = [];
  for (const entry of evidence) {
    const itemValue = object(entry);
    const receiptId = nonEmptyString(itemValue?.receiptId ?? itemValue?.receipt_id);
    if (receiptId !== undefined) all.push(receiptId);
    const reusedBytes = numberOrNull(itemValue?.reusedContentBytes ?? itemValue?.reused_content_bytes);
    if (receiptId !== undefined && reusedBytes !== null && reusedBytes > 0) reused.push(receiptId);
  }
  return { all: [...new Set(all)], reused: [...new Set(reused)] };
};

const metricsSum = (
  metrics: readonly (JsonObject | undefined)[],
  camel: string,
  snake: string,
): number | null => {
  if (metrics.length === 0 || metrics.some((value) => value === undefined)) return null;
  const values = metrics.map((value) => integerOrNull(value?.[camel] ?? value?.[snake]));
  return values.every((value): value is number => value !== null)
    ? values.reduce((total, value) => total + value, 0)
    : null;
};

const readTrial = async (arm: HarborFourArmName, directory: string): Promise<HarborFourArmTrialObservation> => {
  const resultPath = join(directory, 'result.json');
  const trial = await readJson(resultPath);
  const taskName = nonEmptyString(trial.task_name ?? trial.trial_name);
  if (taskName === undefined) throw new Error(`BLOCKED: missing task name: ${resultPath}`);
  const verifier = trial.verifier_result === null || trial.verifier_result === undefined
    ? undefined
    : object(trial.verifier_result);
  const rewards = object(verifier?.rewards);
  if (typeof rewards?.reward !== 'number' || !Number.isFinite(rewards.reward)) {
    throw new Error(`BLOCKED: missing verifier reward: ${resultPath}`);
  }
  const exceptionPresent = trial.exception_info !== null && trial.exception_info !== undefined;
  const success = !exceptionPresent && rewards.reward === 1;
  const timedOut = typeof trial.timed_out === 'boolean' ? trial.timed_out : null;
  const agentResult = object(trial.agent_result);
  const startedAt = typeof trial.started_at === 'string' ? Date.parse(trial.started_at) : Number.NaN;
  const finishedAt = typeof trial.finished_at === 'string' ? Date.parse(trial.finished_at) : Number.NaN;
  const latencyMs = Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt >= startedAt
    ? finishedAt - startedAt
    : null;
  const logPath = join(directory, 'agent', 'codex.txt');
  const log = await readFile(logPath, 'utf8');
  const lines = log.split('\n').filter((line) => line.trim().length > 0);
  const parsedEvents = lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
  const observedAceCalls = lines.filter(isObservedAceToolJsonLine).length;
  const successfulContextCalls = lines.filter(isSuccessfulAceContextJsonLine).length;
  const successfulAceCalls = lines.filter(isSuccessfulAceToolJsonLine).length;
  const successfulRequestIds = lines
    .map(successfulAceContextRequestIdJsonLine)
    .filter((value): value is string => value !== undefined);
  // ace_context carries the provider requestId. ace_expand is an exact local
  // artifact read and intentionally has no new provider requestId, so it is
  // counted but cannot silently establish provider correlation.
  if (successfulRequestIds.length !== successfulContextCalls) {
    throw new Error(`BLOCKED: successful ACE calls are missing request correlation: ${logPath}`);
  }
  const successfulEvents = parsedEvents.filter((event) => isSuccessfulAceToolJsonLine(JSON.stringify(event)));
  const evidenceReceiptIds = [...new Set(successfulEvents.flatMap((event) => structuredEvidenceReceiptIds(event).all))];
  const reusedReceiptIds = [...new Set(successfulEvents.flatMap((event) => structuredEvidenceReceiptIds(event).reused))];
  const metrics = successfulEvents.map(deliveryMetrics);
  const metricValues = {
    uniqueContextBytes: metricsSum(metrics, 'uniqueContentBytes', 'unique_content_bytes'),
    newContextBytes: metricsSum(metrics, 'newContextBytes', 'new_context_bytes'),
    reusedContextBytes: metricsSum(metrics, 'reusedContextBytes', 'reused_context_bytes'),
    duplicateContextAvoided: metricsSum(metrics, 'duplicateContextBytesAvoided', 'duplicate_context_bytes_avoided'),
  };
  const trialId = nonEmptyString(trial.trial_id) ?? basename(directory);
  if (trialId === undefined || trialId.length === 0) throw new Error(`BLOCKED: missing trial ID: ${resultPath}`);
  return {
    arm,
    trialId,
    taskName,
    success,
    timedOut,
    observedAceCalls,
    successfulAceCalls,
    rawInputTokens: integerOrNull(agentResult?.n_input_tokens),
    rawOutputTokens: integerOrNull(agentResult?.n_output_tokens),
    cachedInputTokens: integerOrNull(agentResult?.n_cache_tokens),
    // Current Harbor/Codex traces do not carry a native-read counter. Never
    // infer zero from the absence of an ACE expand call.
    nativeFileReads: null,
    ...metricValues,
    latencyMs,
    successfulRequestIds,
    evidenceReceiptIds,
    reusedReceiptIds,
  };
};

export const readHarborFourArmTrialObservations = async (
  arm: HarborFourArmName,
  aggregatePath: string,
): Promise<readonly HarborFourArmTrialObservation[]> => {
  const directories = await trialDirectories(aggregatePath);
  if (directories.length === 0) throw new Error(`BLOCKED: no Harbor trial directories beside ${aggregatePath}`);
  return Promise.all(directories.map((directory) => readTrial(arm, directory)));
};
