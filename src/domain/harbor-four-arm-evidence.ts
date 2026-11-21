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
  /** Historical four-arm contract: ace_context calls only. */
  readonly observedAceCalls: number;
  readonly successfulAceCalls: number;
  /** Optional total user-facing ACE calls, including ace_expand. */
  readonly observedAceToolCalls?: number;
  readonly successfulAceToolCalls?: number;
  /** Automatic Bifröst/Gateway projections, distinct from model-invoked ACE tool calls. */
  readonly gatewayProjectionRequestIds?: readonly string[];
  readonly rawInputTokens: number | null;
  readonly rawOutputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly nativeFileReads: number | null;
  readonly uniqueContextBytes: number | null;
  readonly newContextBytes: number | null;
  readonly reusedContextBytes: number | null;
  readonly duplicateContextAvoided: number | null;
  readonly latencyMs: number | null;
  /** Request IDs from independently parsed successful ACE context extension responses. */
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
      || observation.successfulAceCalls > observation.observedAceCalls
      || observation.observedAceToolCalls !== undefined
        && (!integer(observation.observedAceToolCalls) || observation.observedAceToolCalls < observation.observedAceCalls)
      || observation.successfulAceToolCalls !== undefined
        && (!integer(observation.successfulAceToolCalls)
          || observation.successfulAceToolCalls < observation.successfulAceCalls
          || observation.successfulAceToolCalls > (observation.observedAceToolCalls ?? observation.observedAceCalls))
      || observation.timedOut !== null
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
  // Automatic Gateway projection IDs are neither model tool calls nor final
  // provider-wire certification. They must still be unique across trials and
  // absent from the native baseline to prevent replayed local diagnostics.
  const globalProjectionRequestIds = new Set<string>();
  for (const observation of observations) {
    const projectionIds = observation.gatewayProjectionRequestIds ?? [];
    if (observation.arm === 'native' && projectionIds.length > 0) {
      return invalid('harbor_trial_evidence.gatewayProjectionRequestIds', 'native baseline contains Gateway projections');
    }
    if (new Set(projectionIds).size !== projectionIds.length) {
      return invalid('harbor_trial_evidence.gatewayProjectionRequestIds', 'duplicate Gateway projection ID within one trial');
    }
    for (const requestId of projectionIds) {
      if (!nonEmpty(requestId) || globalProjectionRequestIds.has(requestId)) {
        return invalid('harbor_trial_evidence.gatewayProjectionRequestIds', 'Gateway projection ID is missing or replayed across trials/arms');
      }
      globalProjectionRequestIds.add(requestId);
    }
  }
  // Request IDs identify individual Gateway calls. Replaying the same successful
  // transcript in another trial/arm must never count as independent evidence.
  const globalRequestIds = new Set<string>();
  for (const observation of observations) {
    for (const requestId of observation.successfulRequestIds) {
      if (globalRequestIds.has(requestId)) {
        return invalid('harbor_trial_evidence.successfulRequestIds', 'a successful Gateway request ID is repeated across trials/arms');
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


/**
 * AR10 uses the existing Harbor raw-trace, usage and failure evidence paths as
 * an INTERNAL observation ledger. A hash or caller quality flag is not a
 * provider attestation. C07/C08 still own external final-wire acceptance.
 */
export type HarborFourArmLedgerKind = 'attempt' | 'usage' | 'failure';
export type HarborFourArmLedgerOutcome = 'completed' | 'failed' | 'timeout' | 'unknown';

interface HarborFourArmLedgerBase {
  readonly schemaVersion: 'ace.harbor.attempt-ledger.v1';
  readonly kind: HarborFourArmLedgerKind;
  readonly arm: HarborFourArmName;
  readonly trialId: string;
  readonly taskName: string;
  readonly attemptId: string;
  readonly modelIdentity: string;
  readonly providerIdentity: string;
  readonly runtimeImageIdentity: string;
}

export interface HarborFourArmAttemptEvent extends HarborFourArmLedgerBase {
  readonly kind: 'attempt';
  readonly outcome: HarborFourArmLedgerOutcome;
}

export interface HarborFourArmUsageEvent extends HarborFourArmLedgerBase {
  readonly kind: 'usage';
  /** Null means provider telemetry was not available, not zero usage. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Cached input and reasoning output are subsets, not additive costs. */
  readonly cachedInputTokens: number | null;
  readonly reasoningOutputTokens: number | null;
}

export interface HarborFourArmFailureEvent extends HarborFourArmLedgerBase {
  readonly kind: 'failure';
  readonly code: string;
}

export type HarborFourArmAttemptLedgerEvent =
  | HarborFourArmAttemptEvent | HarborFourArmUsageEvent | HarborFourArmFailureEvent;

const ledgerRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;

const nullableToken = (value: unknown): value is number | null =>
  value === null || integer(value);

export const parseHarborFourArmAttemptLedgerEvent = (
  value: unknown,
  expectedKind: HarborFourArmLedgerKind,
): Result<HarborFourArmAttemptLedgerEvent, DomainError> => {
  const raw = ledgerRecord(value);
  const kind = raw?.kind;
  if (raw?.schemaVersion !== 'ace.harbor.attempt-ledger.v1' || kind !== expectedKind
    || !armNames.includes(raw.arm as HarborFourArmName)
    || typeof raw.trialId !== 'string' || !nonEmpty(raw.trialId)
    || typeof raw.taskName !== 'string' || !nonEmpty(raw.taskName)
    || typeof raw.attemptId !== 'string' || !nonEmpty(raw.attemptId)
    || typeof raw.modelIdentity !== 'string' || !nonEmpty(raw.modelIdentity)
    || typeof raw.providerIdentity !== 'string' || !nonEmpty(raw.providerIdentity)
    || typeof raw.runtimeImageIdentity !== 'string' || !nonEmpty(raw.runtimeImageIdentity)) {
    return invalid('harbor_attempt_ledger', 'event schema, type or frozen identity is missing or invalid');
  }
  const base = {
    schemaVersion: 'ace.harbor.attempt-ledger.v1' as const,
    arm: raw.arm as HarborFourArmName,
    trialId: raw.trialId,
    taskName: raw.taskName,
    attemptId: raw.attemptId,
    modelIdentity: raw.modelIdentity,
    providerIdentity: raw.providerIdentity,
    runtimeImageIdentity: raw.runtimeImageIdentity,
  };
  if (kind === 'attempt') {
    if (!['completed', 'failed', 'timeout', 'unknown'].includes(String(raw.outcome))) {
      return invalid('harbor_attempt_ledger.outcome', 'attempt outcome is unsupported');
    }
    return ok({ ...base, kind, outcome: raw.outcome as HarborFourArmLedgerOutcome });
  }
  if (kind === 'failure') {
    if (typeof raw.code !== 'string' || !nonEmpty(raw.code)) {
      return invalid('harbor_attempt_ledger.failure', 'failure code must be present');
    }
    return ok({ ...base, kind, code: raw.code });
  }
  const inputTokens = raw.inputTokens ?? null;
  const outputTokens = raw.outputTokens ?? null;
  const cachedInputTokens = raw.cachedInputTokens ?? null;
  const reasoningOutputTokens = raw.reasoningOutputTokens ?? null;
  if (!nullableToken(inputTokens) || !nullableToken(outputTokens)
    || !nullableToken(cachedInputTokens) || !nullableToken(reasoningOutputTokens)
    || cachedInputTokens !== null && inputTokens !== null && cachedInputTokens > inputTokens
    || reasoningOutputTokens !== null && outputTokens !== null && reasoningOutputTokens > outputTokens) {
    return invalid('harbor_attempt_ledger.usage', 'usage counters must be safe integers with valid cached/reasoning subsets');
  }
  return ok({ ...base, kind: 'usage', inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens });
};

export interface HarborFourArmLedgerTotals {
  readonly attemptCount: number;
  readonly failedAttemptCount: number;
  readonly acceptedTasks: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly reasoningOutputTokens: number | null;
}

export interface HarborFourArmLedgerSummary {
  readonly status: 'verified' | 'unknown';
  readonly unknownFields: readonly string[];
  readonly arms: Readonly<Record<HarborFourArmName, HarborFourArmLedgerTotals>>;
}

export interface HarborFourArmFrozenProviderIdentity {
  readonly modelIdentity: string;
  readonly providerIdentity: string;
  readonly runtimeImageIdentity: string;
}

const ledgerKey = (arm: string, trialId: string): string => JSON.stringify([arm, trialId]);
const eventIdentityMatches = (
  left: HarborFourArmAttemptLedgerEvent,
  right: HarborFourArmAttemptLedgerEvent,
): boolean => left.arm === right.arm && left.trialId === right.trialId
  && left.taskName === right.taskName && left.modelIdentity === right.modelIdentity
  && left.providerIdentity === right.providerIdentity && left.runtimeImageIdentity === right.runtimeImageIdentity;

/**
 * Reconcile every provider attempt, usage and failure with the independent
 * Harbor trial outcome and frozen task/model/provider/runtime identity. A
 * timeout, retry or failed attempt is part of total token economics. Any
 * missing usage makes the whole affected arm UNKNOWN, never artificially 0.
 */
export const reconcileHarborFourArmAttemptLedger = (
  observations: readonly HarborFourArmTrialObservation[],
  events: readonly HarborFourArmAttemptLedgerEvent[],
  identity: HarborFourArmFrozenProviderIdentity,
): Result<HarborFourArmLedgerSummary, DomainError> => {
  if (![identity.modelIdentity, identity.providerIdentity, identity.runtimeImageIdentity].every(nonEmpty)) {
    return invalid('harbor_attempt_ledger.identity', 'frozen model/provider/runtime identity is required');
  }
  const trials = new Map<string, HarborFourArmTrialObservation>();
  for (const trial of observations) {
    const key = ledgerKey(trial.arm, trial.trialId);
    if (trials.has(key)) return invalid('harbor_attempt_ledger.trials', 'duplicate raw Harbor trial identity');
    trials.set(key, trial);
  }
  const attempts = new Map<string, HarborFourArmAttemptEvent>();
  const usages = new Map<string, HarborFourArmUsageEvent>();
  const failures = new Map<string, HarborFourArmFailureEvent>();
  for (const event of events) {
    const trial = trials.get(ledgerKey(event.arm, event.trialId));
    if (trial === undefined || trial.taskName !== event.taskName
      || event.modelIdentity !== identity.modelIdentity
      || event.providerIdentity !== identity.providerIdentity
      || event.runtimeImageIdentity !== identity.runtimeImageIdentity) {
      return invalid('harbor_attempt_ledger.identity', 'attempt event is not bound to the exact frozen arm, task, trial, model, provider and image');
    }
    const destination = event.kind === 'attempt' ? attempts : event.kind === 'usage' ? usages : failures;
    if (destination.has(event.attemptId)) {
      return invalid('harbor_attempt_ledger.duplicate', 'duplicate attempt/usage/failure event for one physical attempt');
    }
    if (event.kind === 'attempt') attempts.set(event.attemptId, event);
    else if (event.kind === 'usage') usages.set(event.attemptId, event);
    else failures.set(event.attemptId, event);
  }
  for (const event of [...usages.values(), ...failures.values()]) {
    const attempt = attempts.get(event.attemptId);
    if (attempt === undefined || !eventIdentityMatches(attempt, event)) {
      return invalid('harbor_attempt_ledger.orphan', 'usage or failure does not match one recorded attempt');
    }
  }
  const unknownFields: string[] = [];
  const totals = new Map<HarborFourArmName, HarborFourArmLedgerTotals>();
  for (const arm of armNames) {
    const armTrials = observations.filter((trial) => trial.arm === arm);
    let inputSum = 0;
    let outputSum = 0;
    let cacheSum = 0;
    let reasoningSum = 0;
    let inputKnown = true;
    let outputKnown = true;
    let cacheKnown = true;
    let reasoningKnown = true;
    let failedAttemptCount = 0;
    let attemptCount = 0;
    for (const trial of armTrials) {
      const trialAttempts = [...attempts.values()].filter((event) =>
        event.arm === arm && event.trialId === trial.trialId);
      const where = arm + '.' + trial.trialId;
      if (trialAttempts.length === 0) unknownFields.push(where + '.attempts');
      let trialInput = 0;
      let trialOutput = 0;
      let trialCached = 0;
      let trialInputKnown = trialAttempts.length > 0;
      let trialOutputKnown = trialAttempts.length > 0;
      let trialCachedKnown = trialAttempts.length > 0;
      // A missing or UNKNOWN provider outcome must stay UNKNOWN even when
      // Harbor's independent verifier accepted the task. Only definitive
      // failed/timeout outcomes contradict that independent success.
      if (trial.success && trialAttempts.length > 0
        && trialAttempts.every((event) => event.outcome === 'failed' || event.outcome === 'timeout')) {
        return invalid('harbor_attempt_ledger.outcome', 'accepted trial contradicts observed physical attempt outcomes');
      }
      for (const attempt of trialAttempts) {
        attemptCount += 1;
        const failure = failures.get(attempt.attemptId);
        if (attempt.outcome === 'completed' && failure !== undefined) {
          return invalid('harbor_attempt_ledger.failure', 'completed attempt has an incompatible failure record');
        }
        if (attempt.outcome === 'failed' || attempt.outcome === 'timeout') {
          failedAttemptCount += 1;
          if (failure === undefined) unknownFields.push(where + '.failure.' + attempt.attemptId);
        } else if (attempt.outcome === 'unknown') {
          unknownFields.push(where + '.outcome.' + attempt.attemptId);
        }
        const usage = usages.get(attempt.attemptId);
        if (usage === undefined) {
          unknownFields.push(where + '.usage.' + attempt.attemptId);
          trialInputKnown = false;
          trialOutputKnown = false;
          trialCachedKnown = false;
          reasoningKnown = false;
          continue;
        }
        if (usage.inputTokens === null) {
          trialInputKnown = false;
          unknownFields.push(where + '.inputTokens.' + attempt.attemptId);
        } else {
          trialInput += usage.inputTokens;
          if (!Number.isSafeInteger(trialInput)) {
            return invalid('harbor_attempt_ledger.usage', 'per-trial input token sum exceeds safe integer precision');
          }
        }
        if (usage.outputTokens === null) {
          trialOutputKnown = false;
          unknownFields.push(where + '.outputTokens.' + attempt.attemptId);
        } else {
          trialOutput += usage.outputTokens;
          if (!Number.isSafeInteger(trialOutput)) {
            return invalid('harbor_attempt_ledger.usage', 'per-trial output token sum exceeds safe integer precision');
          }
        }
        if (usage.cachedInputTokens === null) {
          trialCachedKnown = false;
          unknownFields.push(where + '.cachedInputTokens.' + attempt.attemptId);
        } else {
          trialCached += usage.cachedInputTokens;
          if (!Number.isSafeInteger(trialCached)) {
            return invalid('harbor_attempt_ledger.usage', 'per-trial cached token sum exceeds safe integer precision');
          }
        }
        if (usage.reasoningOutputTokens === null) {
          reasoningKnown = false;
          unknownFields.push(where + '.reasoningOutputTokens.' + attempt.attemptId);
        } else {
          reasoningSum += usage.reasoningOutputTokens;
          if (!Number.isSafeInteger(reasoningSum)) {
            return invalid('harbor_attempt_ledger.usage', 'reasoning token sum exceeds safe integer precision');
          }
        }
      }
      const check = (
        field: 'inputTokens' | 'outputTokens' | 'cachedInputTokens',
        measured: number,
        complete: boolean,
        reported: number | null,
      ): Result<void, DomainError> => {
        if (!complete || reported === null) {
          unknownFields.push(where + '.' + field + '.harbor');
          return ok(undefined);
        }
        return measured === reported
          ? ok(undefined)
          : invalid('harbor_attempt_ledger.' + where + '.' + field, 'attempt usage disagrees with the independent Harbor trial');
      };
      const a = check('inputTokens', trialInput, trialInputKnown, trial.rawInputTokens);
      if (a._tag === 'Err') return a;
      const b = check('outputTokens', trialOutput, trialOutputKnown, trial.rawOutputTokens);
      if (b._tag === 'Err') return b;
      const c = check('cachedInputTokens', trialCached, trialCachedKnown, trial.cachedInputTokens);
      if (c._tag === 'Err') return c;
      inputKnown = inputKnown && trialInputKnown && trial.rawInputTokens !== null;
      outputKnown = outputKnown && trialOutputKnown && trial.rawOutputTokens !== null;
      cacheKnown = cacheKnown && trialCachedKnown && trial.cachedInputTokens !== null;
      inputSum += trialInput;
      outputSum += trialOutput;
      cacheSum += trialCached;
      if (![inputSum, outputSum, cacheSum].every(Number.isSafeInteger)) {
        return invalid('harbor_attempt_ledger.usage', 'per-arm token sum exceeds safe integer precision');
      }
    }
    if (armTrials.length === 0) {
      unknownFields.push(arm + '.missing_trials');
      inputKnown = false;
      outputKnown = false;
      cacheKnown = false;
      reasoningKnown = false;
    }
    totals.set(arm, {
      attemptCount,
      failedAttemptCount,
      acceptedTasks: armTrials.filter((trial) => trial.success).length,
      inputTokens: inputKnown ? inputSum : null,
      outputTokens: outputKnown ? outputSum : null,
      cachedInputTokens: cacheKnown ? cacheSum : null,
      reasoningOutputTokens: reasoningKnown ? reasoningSum : null,
    });
  }
  const arms = {
    native: totals.get('native') as HarborFourArmLedgerTotals,
    dense: totals.get('dense') as HarborFourArmLedgerTotals,
    hybrid: totals.get('hybrid') as HarborFourArmLedgerTotals,
    'hybrid-delta': totals.get('hybrid-delta') as HarborFourArmLedgerTotals,
  };
  const fields = [...new Set(unknownFields)];
  return ok({ status: fields.length === 0 ? 'verified' : 'unknown', unknownFields: fields, arms });
};
