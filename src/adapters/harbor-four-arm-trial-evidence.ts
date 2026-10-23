import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  isObservedAceContextEvent,
  isObservedAceToolEvent,
  isSuccessfulAceContextEvent,
  isSuccessfulAceToolEvent,
  successfulAceContextRequestId,
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

const hermesContentText = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((part) => object(part))
    .filter((part): part is JsonObject => part !== undefined)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
  return text.length === 0 ? undefined : text;
};

const hermesToolResult = (value: unknown): JsonObject | undefined => {
  const direct = object(value);
  if (direct !== undefined) {
    const structured = object(direct.structured_content) ?? object(direct.structuredContent);
    return structured === undefined ? { structured_content: direct } : { ...direct, structured_content: structured };
  }
  const text = hermesContentText(value);
  if (text === undefined) return undefined;
  try {
    const parsed = object(JSON.parse(text) as unknown);
    if (parsed === undefined) return undefined;
    const structured = object(parsed.structured_content) ?? object(parsed.structuredContent);
    return structured === undefined ? { structured_content: parsed } : { ...parsed, structured_content: structured };
  } catch {
    return undefined;
  }
};

const hermesAceTool = (name: unknown): 'ace_context' | 'ace_expand' | undefined => {
  if (name === 'ace_context' || name === 'mcp_ace_ace_context') return 'ace_context';
  if (name === 'ace_expand' || name === 'mcp_ace_ace_expand') return 'ace_expand';
  return undefined;
};

const hermesSessionEvents = async (path: string): Promise<readonly unknown[]> => {
  const messages: JsonObject[] = [];
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const parsed = object(JSON.parse(line) as unknown);
    if (parsed === undefined) continue;
    if (Array.isArray(parsed.messages)) {
      messages.push(...parsed.messages.map(object).filter((item): item is JsonObject => item !== undefined));
    } else {
      messages.push(parsed);
    }
  }
  const responses = new Map<string, JsonObject>();
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const callId = nonEmptyString(message.tool_call_id);
    if (callId !== undefined) responses.set(callId, message);
  }
  const events: unknown[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
    for (const rawCall of message.tool_calls) {
      const call = object(rawCall);
      const fn = object(call?.function);
      const tool = hermesAceTool(fn?.name);
      if (tool === undefined) continue;
      const callId = nonEmptyString(call?.id);
      const response = callId === undefined ? undefined : responses.get(callId);
      const result = response === undefined ? undefined : hermesToolResult(response.content);
      events.push({
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          server: 'ace',
          tool,
          status: response === undefined ? 'failed' : 'completed',
          error: response === undefined ? 'missing Hermes tool response' : null,
          ...(result === undefined ? {} : { result }),
        },
      });
    }
  }
  return events;
};

const agentEvidenceEvents = async (
  directory: string,
): Promise<{ readonly path: string; readonly events: readonly unknown[] }> => {
  const agentDir = join(directory, 'agent');
  const hermesPath = join(agentDir, 'hermes-session.jsonl');
  if (existsSync(hermesPath)) return { path: hermesPath, events: await hermesSessionEvents(hermesPath) };
  const codexPath = join(agentDir, 'codex.txt');
  if (!existsSync(codexPath)) throw new Error(`BLOCKED: missing Hermes/Codex agent evidence under ${agentDir}`);
  const events = (await readFile(codexPath, 'utf8')).split('\n').flatMap((line) => {
    if (line.trim().length === 0) return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
  return { path: codexPath, events };
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
  const agentEvidence = await agentEvidenceEvents(directory);
  const parsedEvents = agentEvidence.events;
  const observedAceCalls = parsedEvents.filter(isObservedAceContextEvent).length;
  const observedAceToolCalls = parsedEvents.filter(isObservedAceToolEvent).length;
  const successfulAceCalls = parsedEvents.filter(isSuccessfulAceContextEvent).length;
  const successfulAceToolCalls = parsedEvents.filter(isSuccessfulAceToolEvent).length;
  const successfulRequestIds = parsedEvents
    .map(successfulAceContextRequestId)
    .filter((value): value is string => value !== undefined);
  // ace_context carries the provider requestId. ace_expand is an exact local
  // artifact read and intentionally has no new provider requestId, so it is
  // counted but cannot silently establish provider correlation.
  if (successfulRequestIds.length !== successfulAceCalls) {
    throw new Error(`BLOCKED: successful ACE calls are missing request correlation: ${agentEvidence.path}`);
  }
  const successfulEvents = parsedEvents.filter(isSuccessfulAceContextEvent);
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
    observedAceToolCalls,
    successfulAceToolCalls,
    rawInputTokens: integerOrNull(agentResult?.n_input_tokens),
    rawOutputTokens: integerOrNull(agentResult?.n_output_tokens),
    cachedInputTokens: integerOrNull(agentResult?.n_cache_tokens),
    // Current Harbor agent traces do not carry a native-read counter. Never
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
