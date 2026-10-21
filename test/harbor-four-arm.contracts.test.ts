import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateHarborFourArmDesign,
  validateHarborFourArmReport,
} from '../src/domain/harbor-four-arm.js';

const taskPaths = [
  'benchmarks/ace/task-a',
  'benchmarks/ace/task-b',
  'benchmarks/ace/task-c',
  'external/task-a',
  'external/task-b',
  'external/task-c',
].flatMap((path) => [path, path, path, path, path]);

const job = (config?: string, extraInstructions: readonly string[] = []) => ({
  tasks: taskPaths.map((path) => ({ path })),
  agents: [{
    name: 'codex',
    model_name: 'gpt-5.6-luna',
    env: { CODEX_FORCE_AUTH_JSON: '1' },
    kwargs: { reasoning_effort: 'high', ...(config === undefined ? {} : { config }) },
  }],
  ...(extraInstructions.length === 0 ? {} : { extra_instructions: extraInstructions }),
});

const arm = (aceObservedCalls: number, reusedContextBytes = 0) => ({
  trials: taskPaths.length,
  successes: taskPaths.length,
  taskNames: taskPaths,
  rawInputTokens: 100,
  rawOutputTokens: 20,
  cachedInputTokens: 0,
  aceObservedCalls,
  nativeFileReads: 10,
  uniqueContextBytes: 1000,
  newContextBytes: 800,
  reusedContextBytes,
  duplicateContextAvoided: reusedContextBytes,
  latencyP95Ms: 100,
  failureCount: 0,
  timeoutCount: 0,
});

test('four-arm Harbor design pins one workload, model, reasoning and five serial repeats', () => {
  const result = validateHarborFourArmDesign(
    job(),
    job('four-arm-dense-codex-config.toml'),
    job('four-arm-hybrid-codex-config.toml'),
    job('four-arm-hybrid-delta-codex-config.toml'),
    { repositoryIds: ['ace', 'external'] },
  );
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.equal(result.value.distinctTaskCount, 6);
    assert.deepEqual(result.value.tasksPerRepository, { ace: 15, external: 15 });
  }
});

test('four-arm design rejects forced ACE prompts and non-repeatable workloads', () => {
  const forced = validateHarborFourArmDesign(
    job(),
    job('four-arm-dense-codex-config.toml'),
    job('four-arm-hybrid-codex-config.toml'),
    job('four-arm-hybrid-delta-codex-config.toml', ['Before editing, must call ace_context.']),
    { repositoryIds: ['ace', 'external'] },
  );
  assert.equal(forced._tag, 'Err');

  const tooFew = validateHarborFourArmDesign(
    { ...job(), tasks: taskPaths.slice(0, -1).map((path) => ({ path })) },
    job('four-arm-dense-codex-config.toml'),
    job('four-arm-hybrid-codex-config.toml'),
    job('four-arm-hybrid-delta-codex-config.toml'),
    { repositoryIds: ['ace', 'external'] },
  );
  assert.equal(tooFew._tag, 'Err');
});

test('four-arm Harbor report rejects savings without real ACE calls or observed receipts', () => {
  const base = {
    schemaVersion: 1 as const,
    holdoutSha256: 'a'.repeat(64),
    qualityNonInferior: true,
    rawTracePaths: ['trace.jsonl'],
    usageEventPaths: ['usage.jsonl'],
    failedRunPaths: ['failed.jsonl'],
    costTelemetryComplete: true,
    arms: {
      native: arm(0),
      dense: arm(0),
      hybrid: arm(1),
      'hybrid-delta': arm(1, 100),
    },
  };
  assert.equal(validateHarborFourArmReport(base)._tag, 'Err');
  const accepted = validateHarborFourArmReport({
    ...base,
    arms: {
      native: arm(0),
      dense: arm(1),
      hybrid: arm(1),
      'hybrid-delta': arm(1, 100),
    },
  });
  assert.equal(accepted._tag, 'Ok');
});
