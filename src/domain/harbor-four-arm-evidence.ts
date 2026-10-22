import { domainError, type DomainError } from './errors.js';
import type { HarborFourArmName, HarborFourArmReportArm } from './harbor-four-arm.js';
import { err, ok, type Result } from './result.js';

export interface HarborFourArmTrialObservation {
  readonly arm: HarborFourArmName;
  readonly trialId: string;
  readonly taskName: string;
  readonly success: boolean;
  /** Null means the raw Harbor result did not expose timeout state. */
  readonly timedOut: boolean | null;
  readonly observedAceCalls: number;
  readonly successfulAceCalls: number;
  readonly rawInputTokens: number | null;
  readonly rawOutputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly nativeFileReads: number | null;
  readonly uniqueContextBytes: number | null;
  readonly newContextBytes: number | null;
  readonly reusedContextBytes: number | null;
  readonly duplicateContextAvoided: number | null;
  readonly latencyMs: number | null;
  /** Request IDs from independently parsed successful ACE MCP responses. */
  readonly successfulRequestIds: readonly string[];
  /** Evidence receipt IDs returned by the successful ACE responses. */
  readonly evidenceReceiptIds: readonly string[];
  /** Receipt IDs explicitly observed as reused by this trial. */
  readonly reusedReceiptIds: readonly string[];
}

export interface HarborFourArmArmEvidence {
  readonly arm: HarborFourArmName;
  readonly status: 'verified' | 'unknown';
  readonly releaseEligible: boolean;
  readonly unknownFields: readonly string[];
  readonly trials: number;
  readonly successes: number;
  readonly failureCount: number;
  readonly timeoutCount: number | null;
  readonly taskNames: readonly string[];
  readonly rawInputTokens: number | null;
  readonly rawOutputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly observedAceCalls: number;
  readonly successfulAceCalls: number;
  readonly nativeFileReads: number | null;
  readonly uniqueContextBytes: number | null;
  readonly newContextBytes: number | null;
  readonly reusedContextBytes: number | null;
  readonly duplicateContextAvoided: number | null;
  readonly latencyP95Ms: number | null;
}

export interface HarborFourArmEvidenceSummary {
  readonly status: 'verified' | 'unknown';
  readonly releaseEligible: boolean;
  readonly arms: Readonly<Record<HarborFourArmName, HarborFourArmArmEvidence>>;
}

const armNames: readonly HarborFourArmName[] = ['native', 'dense', 'hybrid', 'hybrid-delta'];
const integer = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0;
const nullableInteger = (value: unknown): value is number | null => value === null || integer(value);
const nullableDuration = (value: unknown): value is number | null => value === null
  || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const nonEmpty = (value: string): boolean => value.trim().length > 0;
const p95 = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
};

const invalid = (path: string, message: string): Result<never, DomainError> =>
  err(domainError('INVALID_BENCHMARK', path, message));

const sumKnown = (
  observations: readonly HarborFourArmTrialObservation[],
  field: keyof Pick<HarborFourArmTrialObservation,
  'rawInputTokens' | 'rawOutputTokens' | 'cachedInputTokens' | 'nativeFileReads'
  | 'uniqueContextBytes' | 'newContextBytes' | 'reusedContextBytes' | 'duplicateContextAvoided'>,
): number | null => {
  const values = observations.map((observation) => observation[field]);
  return values.every((value): value is number => typeof value === 'number')
    ? values.reduce((total, value) => total + value, 0)
    : null;
};

const compareDeclared = (
  declared: number | null,
  actual: number | null,
  field: string,
  unknownFields: string[],
): Result<void, DomainError> => {
  if (declared === null) {
    unknownFields.push(`${field}.aggregate`);
    return ok(undefined);
  }
  if (actual === null) {
    unknownFields.push(`${field}.trials`);
    return ok(undefined);
  }
  return declared === actual
    ? ok(undefined)
    : invalid(`harbor_trial_evidence.${field}`, `declared aggregate does not match raw trial sum (${declared} !== ${actual})`);
};

/**
 * A Harbor result must correspond to the exact frozen job trial in the exact
 * order, not merely agree with a user-supplied aggregate report. Harbor may
 * emit the frozen task ID or the exact job path as the task_name.
 */
export const bindHarborTrialsToFrozenTasks = (
  frozenTaskOrder: readonly string[],
  frozenBindings: readonly { readonly id: string; readonly path: string }[],
  observations: readonly HarborFourArmTrialObservation[],
): Result<readonly HarborFourArmTrialObservation[], DomainError> => {
  if (observations.length !== frozenTaskOrder.length || frozenBindings.length === 0) {
    return invalid('harbor_trial_evidence.frozen_tasks', 'raw trials must match the number of frozen job tasks');
  }
  const idToPath = new Map(frozenBindings.map((binding) => [binding.id, binding.path]));
  if (idToPath.size !== frozenBindings.length
    || new Set(frozenBindings.map((binding) => binding.path)).size !== frozenBindings.length
    || frozenTaskOrder.some((task) => !frozenBindings.some((binding) => binding.path === task))) {
    return invalid('harbor_trial_evidence.frozen_tasks', 'frozen task identity mapping is ambiguous or incomplete');
  }
  const normalized: HarborFourArmTrialObservation[] = [];
  for (const [index, trial] of observations.entries()) {
    const expected = frozenTaskOrder[index];
    const actual = idToPath.get(trial.taskName) ?? trial.taskName;
    if (expected === undefined || actual !== expected) {
      return invalid(
        `harbor_trial_evidence.frozen_tasks[${index}]`,
        'raw Harbor trial task identity/order is not bound to the frozen job',
      );
    }
    normalized.push({ ...trial, taskName: expected });
  }
  return ok(normalized);
};

const reconcileArm = (
  arm: HarborFourArmName,
  expected: HarborFourArmReportArm,
  observations: readonly HarborFourArmTrialObservation[],
): Result<HarborFourArmArmEvidence, DomainError> => {
  if (observations.length !== expected.trials) {
    return invalid(`harbor_trial_evidence.${arm}.trials`, 'raw trial count does not match the declared aggregate');
  }
  if (JSON.stringify(observations.map((item) => item.taskName)) !== JSON.stringify(expected.taskNames)) {
    return invalid(`harbor_trial_evidence.${arm}.task_names`, 'raw trial task order does not match the declared aggregate');
  }
  const seenTrialIds = new Set<string>();
  const seenReceiptsByTask = new Map<string, Set<string>>();
  const unknownFields: string[] = [];
  for (const [index, observation] of observations.entries()) {
    const path = `harbor_trial_evidence.${arm}.trials[${index}]`;
    if (observation.arm !== arm || !nonEmpty(observation.trialId) || seenTrialIds.has(observation.trialId)
      || !nonEmpty(observation.taskName) || !nullableInteger(observation.rawInputTokens)
      || !nullableInteger(observation.rawOutputTokens) || !nullableInteger(observation.cachedInputTokens)
      || !nullableInteger(observation.nativeFileReads) || !nullableInteger(observation.uniqueContextBytes)
      || !nullableInteger(observation.newContextBytes) || !nullableInteger(observation.reusedContextBytes)
      || !nullableInteger(observation.duplicateContextAvoided) || !nullableDuration(observation.latencyMs)
      || !integer(observation.observedAceCalls) || !integer(observation.successfulAceCalls)
      || observation.successfulAceCalls > observation.observedAceCalls || observation.timedOut !== null
        && typeof observation.timedOut !== 'boolean'
      || !Array.isArray(observation.successfulRequestIds) || !observation.successfulRequestIds.every(nonEmpty)
      || new Set(observation.successfulRequestIds).size !== observation.successfulRequestIds.length
      || !Array.isArray(observation.evidenceReceiptIds) || !observation.evidenceReceiptIds.every(nonEmpty)
      || new Set(observation.evidenceReceiptIds).size !== observation.evidenceReceiptIds.length
      || !Array.isArray(observation.reusedReceiptIds) || !observation.reusedReceiptIds.every(nonEmpty)
      || new Set(observation.reusedReceiptIds).size !== observation.reusedReceiptIds.length
      || observation.successfulRequestIds.length !== observation.successfulAceCalls) {
      return invalid(path, 'raw trial observation is malformed or lacks correlated successful ACE receipts');
    }
    if (observation.success && observation.timedOut === true) {
      return invalid(`${path}.timedOut`, 'a successful trial cannot be timed out');
    }
    const priorReceipts = seenReceiptsByTask.get(observation.taskName) ?? new Set<string>();
    if (observation.reusedReceiptIds.some((receiptId) => !priorReceipts.has(receiptId))) {
      return invalid(`${path}.reusedReceiptIds`, 'receipt reuse is not backed by an earlier receipt for the same task');
    }
    for (const receiptId of observation.evidenceReceiptIds) priorReceipts.add(receiptId);
    seenReceiptsByTask.set(observation.taskName, priorReceipts);
    seenTrialIds.add(observation.trialId);
  }
  const successes = observations.filter((item) => item.success).length;
  const failureCount = observations.length - successes;
  if (expected.successes !== successes || expected.failureCount !== failureCount) {
    return invalid(`harbor_trial_evidence.${arm}.outcomes`, 'declared success/failure counters do not match raw trials');
  }
  const timeoutValues = observations.map((item) => item.timedOut);
  const timeoutCount = timeoutValues.every((value): value is boolean => value !== null)
    ? timeoutValues.filter(Boolean).length
    : null;
  if (timeoutCount === null) unknownFields.push('timeoutCount.trials');
  else if (timeoutCount !== expected.timeoutCount) {
    return invalid(`harbor_trial_evidence.${arm}.timeoutCount`, 'declared timeout counter does not match raw trials');
  }
  const observedAceCalls = observations.reduce((total, item) => total + item.observedAceCalls, 0);
  const successfulAceCalls = observations.reduce((total, item) => total + item.successfulAceCalls, 0);
  if (observedAceCalls !== expected.aceObservedCalls) {
    return invalid(`harbor_trial_evidence.${arm}.aceObservedCalls`, 'declared ACE call count does not match raw trial events');
  }
  const measured = {
    rawInputTokens: sumKnown(observations, 'rawInputTokens'),
    rawOutputTokens: sumKnown(observations, 'rawOutputTokens'),
    cachedInputTokens: sumKnown(observations, 'cachedInputTokens'),
    nativeFileReads: sumKnown(observations, 'nativeFileReads'),
    uniqueContextBytes: sumKnown(observations, 'uniqueContextBytes'),
    newContextBytes: sumKnown(observations, 'newContextBytes'),
    reusedContextBytes: sumKnown(observations, 'reusedContextBytes'),
    duplicateContextAvoided: sumKnown(observations, 'duplicateContextAvoided'),
  };
  for (const field of Object.keys(measured) as (keyof typeof measured)[]) {
    const compared = compareDeclared(expected[field], measured[field], field, unknownFields);
    if (compared._tag === 'Err') return compared;
  }
  const latency = p95(observations.map((item) => item.latencyMs).filter((value): value is number => value !== null));
  if (latency === null || observations.some((item) => item.latencyMs === null)) unknownFields.push('latencyP95Ms.trials');
  else if (expected.latencyP95Ms !== latency) {
    return invalid(`harbor_trial_evidence.${arm}.latencyP95Ms`, 'declared latency p95 does not match raw trial timestamps');
  }
  if (arm === 'native' && (observedAceCalls !== 0 || successfulAceCalls !== 0)) {
    return invalid(`harbor_trial_evidence.${arm}.ace`, 'native baseline has observed ACE calls');
  }
  if (arm !== 'native' && observedAceCalls === 0) unknownFields.push('aceObservedCalls.trials');
  if (arm !== 'native' && successfulAceCalls === 0) unknownFields.push('successfulAceCalls.trials');
  const reusedContextBytes = measured.reusedContextBytes;
  const reusedReceiptCount = observations.reduce((total, item) => total + item.reusedReceiptIds.length, 0);
  if (arm === 'hybrid-delta' && (reusedContextBytes === null || reusedReceiptCount === 0)) {
    unknownFields.push('hybrid-delta.receiptReuse');
  }
  const uniqueUnknownFields = [...new Set(unknownFields)];
  const status = uniqueUnknownFields.length === 0 ? 'verified' : 'unknown';
  const releaseEligible = status === 'verified'
    && (arm === 'native' || successfulAceCalls > 0)
    && (arm !== 'hybrid-delta' || reusedContextBytes !== null && reusedContextBytes > 0 && reusedReceiptCount > 0);
  return ok({
    arm,
    status,
    releaseEligible,
    unknownFields: uniqueUnknownFields,
    trials: observations.length,
    successes,
    failureCount,
    timeoutCount,
    taskNames: observations.map((item) => item.taskName),
    ...measured,
    observedAceCalls,
    successfulAceCalls,
    latencyP95Ms: latency,
  });
};

export const reconcileHarborFourArmTrials = (
  expected: Readonly<Record<HarborFourArmName, HarborFourArmReportArm>>,
  observations: readonly HarborFourArmTrialObservation[],
): Result<HarborFourArmEvidenceSummary, DomainError> => {
  const byArm = new Map<HarborFourArmName, HarborFourArmTrialObservation[]>();
  for (const name of armNames) byArm.set(name, []);
  for (const observation of observations) {
    const arm = byArm.get(observation.arm);
    if (arm === undefined) return invalid('harbor_trial_evidence.arm', 'unknown Harbor arm in raw observations');
    arm.push(observation);
  }
  // Request IDs identify individual MCP calls. Replaying the same successful
  // transcript in another trial/arm must never count as independent evidence.
  const globalRequestIds = new Set<string>();
  for (const observation of observations) {
    for (const requestId of observation.successfulRequestIds) {
      if (globalRequestIds.has(requestId)) {
        return invalid('harbor_trial_evidence.successfulRequestIds', 'a successful MCP request ID is repeated across trials/arms');
      }
      globalRequestIds.add(requestId);
    }
  }
  // Aggregate qualityNonInferior is only a declaration. Require at minimum
  // that a successful native trial does not fail under any ACE strategy for
  // the identical frozen task/attempt; no aggregate can override that loss.
  const nativeTrials = byArm.get('native') ?? [];
  for (const name of armNames) {
    if (name === 'native') continue;
    const candidateTrials = byArm.get(name) ?? [];
    if (candidateTrials.some((trial, index) => nativeTrials[index]?.success === true && !trial.success)) {
      return invalid(`harbor_trial_evidence.${name}.paired_quality`,
        'a task/attempt that succeeded natively failed with ACE; quality non-inferiority is not established');
    }
  }
  const reconciled = new Map<HarborFourArmName, HarborFourArmArmEvidence>();
  for (const name of armNames) {
    const result = reconcileArm(name, expected[name], byArm.get(name) ?? []);
    if (result._tag === 'Err') return result;
    reconciled.set(name, result.value);
  }
  const arms = {
    native: reconciled.get('native') as HarborFourArmArmEvidence,
    dense: reconciled.get('dense') as HarborFourArmArmEvidence,
    hybrid: reconciled.get('hybrid') as HarborFourArmArmEvidence,
    'hybrid-delta': reconciled.get('hybrid-delta') as HarborFourArmArmEvidence,
  };
  const releaseEligible = armNames.every((name) => arms[name].releaseEligible);
  return ok({
    status: releaseEligible ? 'verified' : 'unknown',
    releaseEligible,
    arms,
  });
};
