import assert from 'node:assert/strict';
import test from 'node:test';
import type { HarborFourArmName, HarborFourArmReportArm } from '../src/domain/harbor-four-arm.js';
import { bindHarborTrialsToFrozenTasks, reconcileHarborFourArmTrials, type HarborFourArmTrialObservation } from '../src/domain/harbor-four-arm-evidence.js';

const taskNames = ['task-a', 'task-a', 'task-b'];
const armNames: readonly HarborFourArmName[] = ['native', 'dense', 'hybrid', 'hybrid-delta'];

const observation = (
  arm: HarborFourArmName,
  index: number,
  overrides: Partial<HarborFourArmTrialObservation> = {},
): HarborFourArmTrialObservation => ({
  arm,
  trialId: `${arm}-${index}`,
  taskName: taskNames[index] ?? 'task-a',
  success: true,
  timedOut: false,
  observedAceCalls: arm === 'native' ? 0 : 1,
  successfulAceCalls: arm === 'native' ? 0 : 1,
  rawInputTokens: 10,
  rawOutputTokens: 2,
  cachedInputTokens: 1,
  nativeFileReads: 2,
  uniqueContextBytes: 100,
  newContextBytes: 80,
  reusedContextBytes: index === 1 && arm === 'hybrid-delta' ? 20 : 0,
  duplicateContextAvoided: index === 1 && arm === 'hybrid-delta' ? 20 : 0,
  latencyMs: 10 + index,
  successfulRequestIds: arm === 'native' ? [] : [`${arm}-request-${index}`],
  evidenceReceiptIds: arm === 'native' ? [] : [`${arm}-receipt-${index}`],
  reusedReceiptIds: index === 1 && arm === 'hybrid-delta' ? ['hybrid-delta-receipt-0'] : [],
  ...overrides,
});

const expected = (arm: HarborFourArmName, overrides: Partial<HarborFourArmReportArm> = {}): HarborFourArmReportArm => {
  const items = taskNames.map((_, index) => observation(arm, index));
  return {
    trials: items.length,
    successes: items.length,
    taskNames,
    rawInputTokens: 30,
    rawOutputTokens: 6,
    cachedInputTokens: 3,
    aceObservedCalls: arm === 'native' ? 0 : 3,
    nativeFileReads: 6,
    uniqueContextBytes: 300,
    newContextBytes: 240,
    reusedContextBytes: arm === 'hybrid-delta' ? 20 : 0,
    duplicateContextAvoided: arm === 'hybrid-delta' ? 20 : 0,
    latencyP95Ms: 12,
    failureCount: 0,
    timeoutCount: 0,
    ...overrides,
  };
};

const allExpected = (): Readonly<Record<HarborFourArmName, HarborFourArmReportArm>> => ({
  native: expected('native'),
  dense: expected('dense'),
  hybrid: expected('hybrid'),
  'hybrid-delta': expected('hybrid-delta'),
});

const allObservations = (): readonly HarborFourArmTrialObservation[] => armNames.flatMap((arm) =>
  taskNames.map((_, index) => observation(arm, index)));

test('four-arm evidence reconciles raw trials instead of trusting aggregate counters', () => {
  const result = reconcileHarborFourArmTrials(allExpected(), allObservations());
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.equal(result.value.status, 'verified');
    assert.equal(result.value.releaseEligible, true);
    assert.equal(result.value.arms.hybrid.successfulAceCalls, 3);
    assert.equal(result.value.arms['hybrid-delta'].reusedContextBytes, 20);
  }
});

test('forged aggregate success or token counters are rejected', () => {
  const forged = allExpected();
  const result = reconcileHarborFourArmTrials({
    ...forged,
    hybrid: expected('hybrid', { successes: 2 }),
  }, allObservations());
  assert.equal(result._tag, 'Err');

  const forgedTokens = reconcileHarborFourArmTrials({
    ...forged,
    dense: expected('dense', { rawInputTokens: 999 }),
  }, allObservations());
  assert.equal(forgedTokens._tag, 'Err');
});

test('missing per-trial telemetry stays unknown and cannot pass release eligibility', () => {
  const observations = allObservations().map((item) => item.arm === 'hybrid'
    ? { ...item, nativeFileReads: null, latencyMs: null }
    : item);
  const result = reconcileHarborFourArmTrials(allExpected(), observations);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.equal(result.value.status, 'unknown');
    assert.equal(result.value.releaseEligible, false);
    assert.ok(result.value.arms.hybrid.unknownFields.includes('nativeFileReads.trials'));
    assert.ok(result.value.arms.hybrid.unknownFields.includes('latencyP95Ms.trials'));
  }
});

test('receipt reuse must be backed by a prior raw receipt for the same task', () => {
  const observations = allObservations().map((item) => item.arm === 'hybrid-delta' && item.trialId.endsWith('-1')
    ? { ...item, reusedReceiptIds: ['not-present-in-prior-trial'] }
    : item);
  const result = reconcileHarborFourArmTrials(allExpected(), observations);
  assert.equal(result._tag, 'Err');
});

test('native baseline ACE calls are rejected even when aggregate quality is good', () => {
  const observations = allObservations().map((item) => item.arm === 'native'
    ? { ...item, observedAceCalls: 1, successfulAceCalls: 1, successfulRequestIds: ['native-forbidden-request'] }
    : item);
  const result = reconcileHarborFourArmTrials(allExpected(), observations);
  assert.equal(result._tag, 'Err');
});

test('raw Harbor trial task identities must match frozen job paths/ids in the exact order', () => {
  const jobTasks = ['repo/task-a', 'repo/task-a', 'repo/task-b'];
  const bindings = [{ id: 'task-a', path: 'repo/task-a' }, { id: 'task-b', path: 'repo/task-b' }];
  const observed = [
    observation('native', 0),
    observation('native', 1, { taskName: 'repo/task-a' }),
    observation('native', 2),
  ];
  const bound = bindHarborTrialsToFrozenTasks(jobTasks, bindings, observed);
  assert.equal(bound._tag, 'Ok');
  if (bound._tag === 'Ok') assert.deepEqual(bound.value.map((item) => item.taskName), jobTasks);

  const unrelated = bindHarborTrialsToFrozenTasks(jobTasks, bindings, [
    observation('native', 0, { taskName: 'unfrozen-task' }),
    ...observed.slice(1),
  ]);
  assert.equal(unrelated._tag, 'Err');
  const reordered = bindHarborTrialsToFrozenTasks(jobTasks, bindings, [
    observed[2] as HarborFourArmTrialObservation,
    observed[1] as HarborFourArmTrialObservation,
    observed[0] as HarborFourArmTrialObservation,
  ]);
  assert.equal(reordered._tag, 'Err');
});

test('duplicate successful MCP request IDs cannot be replayed across trials or arms', () => {
  const events = allObservations().map((item) => item.arm === 'hybrid' && item.trialId.endsWith('-0')
    ? { ...item, successfulRequestIds: ['dense-request-0'] }
    : item);
  const result = reconcileHarborFourArmTrials(allExpected(), events);
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.path, 'harbor_trial_evidence.successfulRequestIds');
});

test('a successful native trial followed by ACE failure cannot be called quality non-inferior', () => {
  const events = allObservations().map((item) => item.arm === 'hybrid' && item.trialId.endsWith('-0')
    ? { ...item, success: false }
    : item);
  const result = reconcileHarborFourArmTrials(allExpected(), events);
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.path, 'harbor_trial_evidence.hybrid.paired_quality');
});
