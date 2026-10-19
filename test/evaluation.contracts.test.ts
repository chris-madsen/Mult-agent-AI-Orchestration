import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Result } from '../src/domain/result.js';
import { normalizeCodexJsonEvent } from '../src/adapters/codex-usage-events.js';
import { freezeSuiteWithSha256, makeComparisonReportWithSha256 } from '../src/adapters/evaluation-fingerprint.js';
import {
  renderComparisonReportArtifacts,
  writeComparisonReportArtifacts,
} from '../src/adapters/evaluation-report-artifacts.js';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  known,
  makeBenchmarkRun,
  makeEvaluationSuite,
  makeTaskId,
  normalizeUsageLedger,
  normalizeUsageSample,
  transitionBenchmarkRun,
  unsupportedExternalUsage,
  type BenchmarkRun,
  type QualityOutcome,
  type UsageEventInput,
} from '../src/domain/evaluation.js';

const mustOk = <Value, ErrorValue>(result: Result<Value, ErrorValue>): Value => {
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error as string);
  return result.value;
};

const mustErr = <Value, ErrorValue>(result: Result<Value, ErrorValue>): ErrorValue => {
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Ok') throw new Error('expected Err');
  return result.error;
};

const suite = () => mustOk(makeEvaluationSuite({
  suiteId: 'typescript-foundation',
  suiteVersion: 1,
  taskManifests: [{
    taskId: mustOk(makeTaskId('task-retry')),
    taskVersion: '1',
    repoBaseCommit: 'commit-a',
    taskInputDigest: 'input-digest-a',
    qualityCommands: ['npm test'],
  }],
  holdout: true,
  qualityRubric: 'all explicit and hidden checks pass',
  comparatorSet: ['native-codex', 'ace-harness'],
  environmentRules: ['isolated-worktree', 'network-disabled'],
}));

const frozenSuite = () => mustOk(freezeSuiteWithSha256(suite()));

const run = (id = 'run-1'): BenchmarkRun => mustOk(makeBenchmarkRun({
  runId: id,
  suite: frozenSuite(),
  taskId: 'task-retry',
  agentConfigId: 'native-codex',
  repoBaseCommit: 'commit-a',
}));

const quality = (status: QualityOutcome['status']): QualityOutcome => ({
  status,
  passedChecks: status === 'passed' ? 3 : 2,
  failedChecks: status === 'failed' ? 1 : 0,
  hiddenChecks: known(status === 'unknown' ? 0 : 3),
  ...(status === 'failed' ? { failureReason: 'hidden regression' } : {}),
});

const usageInput = (overrides: Partial<UsageEventInput> = {}): UsageEventInput => ({
  eventId: 'event-1',
  provider: 'codex',
  eventSource: 'codex.exec.json',
  counterKind: 'delta',
  sequence: 1,
  rawEvent: {
    type: 'turn.completed',
    usage: {
      input_tokens: 100,
      cached_input_tokens: 80,
      output_tokens: 20,
      reasoning_output_tokens: 10,
    },
    vendor_extension: { trace: 'retained' },
  },
  ...overrides,
});

test('EVC-01 frozen suites are fingerprinted and cannot be mutated in place', () => {
  const draft = suite();
  const frozen = frozenSuite();
  assert.equal(draft.frozen, false);
  assert.equal(frozen.frozen, true);
  assert.match(frozen.suiteFingerprint ?? '', /^[a-f0-9]{64}$/u);
  const rejected = mustErr((() => {
    const task = draft.taskManifests[0];
    if (task === undefined) throw new Error('fixture task missing');
    return makeEvaluationSuite({ ...draft, taskManifests: [task, task] });
  })());
  assert.equal(rejected.code, 'INVALID_BENCHMARK');
});

test('EVC-02 BenchmarkRun FSM retains aborted runs and rejects illegal transitions', () => {
  const prepared = run();
  const running = mustOk(transitionBenchmarkRun(prepared, {
    type: 'environment_ready',
    fingerprint: 'env-a',
    startedAtMs: 1_700_000_000_000,
  }));
  const aborted = mustOk(transitionBenchmarkRun(running, {
    type: 'aborted',
    endedAtMs: 1_700_000_000_100,
    reason: 'timeout',
  }));
  const grading = mustOk(transitionBenchmarkRun(aborted, { type: 'start_grading' }));
  const incomplete = mustOk(transitionBenchmarkRun(grading, {
    type: 'record_incomplete',
    quality: quality('unknown'),
    reason: 'provider usage unavailable',
  }));
  assert.equal(incomplete.state, 'RecordedIncomplete');
  assert.equal(incomplete.failureReason, 'provider usage unavailable');
  assert.equal(mustErr(transitionBenchmarkRun(incomplete, { type: 'start_grading' })).code, 'INVALID_BENCHMARK');
});

test('EVC-03 delta usage does not double count cached or reasoning subsets', () => {
  const sample = mustOk(normalizeUsageSample(usageInput()));
  const ledger = mustOk(normalizeUsageLedger([sample]));
  assert.equal(ledger.status, 'measured');
  assert.deepEqual(ledger.totals.inputTokens, { status: 'known', value: 100 });
  assert.deepEqual(ledger.totals.cachedInputTokens, { status: 'known', value: 80 });
  assert.deepEqual(ledger.totals.uncachedInputTokens, { status: 'known', value: 20 });
  assert.deepEqual(ledger.totals.outputTokens, { status: 'known', value: 20 });
  assert.deepEqual(ledger.totals.totalTokens, { status: 'known', value: 120 });
  assert.deepEqual(ledger.totals.reasoningOutputTokens, { status: 'known', value: 10 });
  assert.deepEqual(sample.unknownFields.vendor_extension, { trace: 'retained' });
  assert.deepEqual(sample.rawEvent, usageInput().rawEvent);
});

test('EVC-03b provider decimal cost is measured without weakening integer token counters', () => {
  const sample = mustOk(normalizeUsageSample(usageInput({ rawEvent: {
    usage: { input_tokens: 100, output_tokens: 20 },
    cost_usd: 0.00367496,
  } })));
  assert.deepEqual(sample.costUsd, { status: 'known', value: 0.00367496 });
  assert.equal(mustErr(normalizeUsageSample(usageInput({ rawEvent: {
    usage: { input_tokens: 100.5, output_tokens: 20 },
  } }))).code, 'INVALID_USAGE');
});

test('EVC-04 cumulative usage is differenced and duplicate source events are ignored', () => {
  const first = mustOk(normalizeUsageSample(usageInput({
    eventId: 'event-1',
    counterKind: 'cumulative',
    sequence: 1,
    rawEvent: { usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 } },
  })));
  const second = mustOk(normalizeUsageSample(usageInput({
    eventId: 'event-2',
    counterKind: 'cumulative',
    sequence: 2,
    rawEvent: { usage: { input_tokens: 150, cached_input_tokens: 90, output_tokens: 25 } },
  })));
  const duplicate = mustOk(normalizeUsageSample(usageInput({ eventId: 'event-2', counterKind: 'cumulative', sequence: 3 })));
  const ledger = mustOk(normalizeUsageLedger([second, duplicate, first]));
  assert.deepEqual(ledger.totals.inputTokens, { status: 'known', value: 150 });
  assert.deepEqual(ledger.totals.outputTokens, { status: 'known', value: 25 });
  assert.deepEqual(ledger.totals.cachedInputTokens, { status: 'known', value: 90 });
  assert.deepEqual(ledger.deduplicatedEventIds, ['event-2']);
});

test('EVC-05 unavailable usage is unknown rather than fabricated zero', () => {
  const sample = mustOk(normalizeUsageSample(usageInput({
    eventId: 'failed-run',
    rawEvent: { type: 'run.failed', failure: 'timeout' },
  })));
  const ledger = mustOk(normalizeUsageLedger([sample]));
  assert.equal(ledger.status, 'measurement_unavailable');
  assert.deepEqual(ledger.totals.totalTokens, { status: 'unknown', reason: 'input_or_output_unavailable' });
  assert.notDeepEqual(ledger.totals.totalTokens, { status: 'known', value: 0 });
});

test('EVC-06 invalid usage subset relationships fail before ledger aggregation', () => {
  const cachedTooHigh = normalizeUsageSample(usageInput({
    rawEvent: { usage: { input_tokens: 10, cached_input_tokens: 11, output_tokens: 1 } },
  }));
  const reasoningTooHigh = normalizeUsageSample(usageInput({
    rawEvent: { usage: { input_tokens: 10, output_tokens: 1, reasoning_output_tokens: 2 } },
  }));
  assert.equal(mustErr(cachedTooHigh).code, 'INVALID_USAGE');
  assert.equal(mustErr(reasoningTooHigh).code, 'INVALID_USAGE');
});

test('EVC-07 quality failures remain in reports and cannot become accepted success', async () => {
  const baseRun = run('run-wrong-patch');
  const running = mustOk(transitionBenchmarkRun(baseRun, {
    type: 'environment_ready',
    fingerprint: 'env-a',
    startedAtMs: 1_700_000_000_000,
  }));
  const finished = mustOk(transitionBenchmarkRun(running, { type: 'agent_finished', endedAtMs: 1_700_000_000_100 }));
  const grading = mustOk(transitionBenchmarkRun(finished, { type: 'start_grading' }));
  const ledger = mustOk(normalizeUsageLedger([mustOk(normalizeUsageSample(usageInput()))]));
  const recorded = mustOk(transitionBenchmarkRun(grading, { type: 'record', quality: quality('failed'), usage: ledger }));
  const report = mustOk(makeComparisonReportWithSha256({
    reportId: 'report-1',
    suite: frozenSuite(),
    runs: [recorded],
    limitations: ['single run'],
    releasedAtMs: 1_700_000_000_200,
  }));
  assert.equal(report.totalRuns, 1);
  assert.equal(report.successfulRuns, 0);
  assert.deepEqual(report.qualityPassRate, { status: 'known', value: 0 });
  assert.deepEqual(report.completionRate, { status: 'known', value: 1 });
  assert.deepEqual(report.abortedRate, { status: 'known', value: 0 });
  assert.deepEqual(report.incompleteRate, { status: 'known', value: 0 });
  assert.ok(report.limitations.includes('single run'));
  const artifacts = renderComparisonReportArtifacts(report);
  assert.equal(artifacts.length, 3);
  assert.match(artifacts[0]?.content ?? '', /comparison_report/u);
  assert.match(artifacts[1]?.content ?? '', /total_tokens/u);
  assert.match(artifacts[2]?.content ?? '', /Limitations/u);
  const directory = await mkdtemp(join(tmpdir(), 'ace-report-'));
  const written = mustOk(await writeComparisonReportArtifacts(directory, report));
  assert.equal(await readFile(written.jsonlPath, 'utf8'), artifacts[0]?.content);
});

test('EVC-08 external provider usage is explicit when integration is unavailable', () => {
  const unsupported = mustOk(unsupportedExternalUsage('vertex', 'API contract not verified'));
  assert.equal(unsupported.status, 'unsupported');
  assert.deepEqual(unsupported.costUsd, { status: 'unknown', reason: 'unsupported' });
  assert.equal(mustErr(unsupportedExternalUsage('jev', '')).code, 'UNSUPPORTED_PROVIDER');
});

test('EVC-09 Codex JSONL adapter requires a verified event identity and preserves raw data', () => {
  const sample = mustOk(normalizeCodexJsonEvent({
    id: 'turn-1',
    type: 'turn.completed',
    usage: { input_tokens: 4, output_tokens: 2 },
    extension_field: 'preserve-me',
  }, 1, { codexVersion: 'codex-cli 0.148.0-alpha.9', counterKind: 'delta' }));
  assert.equal(sample.provider, 'codex');
  assert.equal(sample.eventSource, 'codex.exec.json:codex-cli 0.148.0-alpha.9');
  assert.equal(sample.rawEvent.extension_field, 'preserve-me');
  assert.equal(mustErr(normalizeCodexJsonEvent({ type: 'turn.completed' }, 1, {
    codexVersion: 'codex-cli 0.148.0-alpha.9',
    counterKind: 'delta',
  })).code, 'USAGE_UNAVAILABLE');
});
