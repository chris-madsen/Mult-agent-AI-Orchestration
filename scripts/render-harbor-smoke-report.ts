import { mkdir } from 'node:fs/promises';
import { makeComparisonReportWithSha256, freezeSuiteWithSha256 } from '../src/adapters/evaluation-fingerprint.js';
import { writeComparisonReportArtifacts } from '../src/adapters/evaluation-report-artifacts.js';
import {
  makeEvaluationSuite,
  makeBenchmarkRun,
  normalizeUsageLedger,
  normalizeUsageSample,
  transitionBenchmarkRun,
  type BenchmarkRun,
  type EvaluationSuite,
  type UsageLedger,
} from '../src/domain/evaluation.js';
import { isErr, type Result } from '../src/domain/result.js';

const unwrap = <Value>(result: Result<Value, { readonly message: string }>): Value => {
  if (isErr(result)) throw new Error(result.error.message);
  return result.value;
};

const suite = (): EvaluationSuite => {
  const created = unwrap(makeEvaluationSuite({
    suiteId: 'ace-harness-local-smoke',
    suiteVersion: 1,
    holdout: true,
    qualityRubric: 'Exact fixture replacement and verifier reward 1.0.',
    comparatorSet: ['native-codex'],
    environmentRules: ['docker-delete=true', 'oauth-auth-json', 'failed-artifacts-retained'],
    taskManifests: [{
      taskId: 'ace-local-smoke',
      taskVersion: '1.0.0',
      repoBaseCommit: 'fixture-only',
      taskInputDigest: 'e2ff728211719f1b6de78ddea92c738ea501d2db97641d4982aa5aabf77fa1eb',
      qualityCommands: ['test -f /workspace/fixture.txt', 'test exact fixture bytes'],
    }],
  }));
  return unwrap(freezeSuiteWithSha256(created));
};

const runBase = (suiteValue: EvaluationSuite, runId: string, agentConfigId: string): BenchmarkRun => {
  const prepared = unwrap(makeBenchmarkRun({ runId, suite: suiteValue, taskId: 'ace-local-smoke', agentConfigId, repoBaseCommit: 'fixture-only' }));
  return unwrap(transitionBenchmarkRun(prepared, { type: 'environment_ready', fingerprint: 'docker-ubuntu-24.04', startedAtMs: 1_797_000_000_001 }));
};

const measuredUsage = (): UsageLedger => {
  const sample = unwrap(normalizeUsageSample({
    eventId: 'harbor-oauth-turn-completed',
    provider: 'codex',
    eventSource: 'harbor/ace-local-smoke-oauth',
    counterKind: 'delta',
    sequence: 1,
    rawEvent: { usage: { input_tokens: 59674, cached_input_tokens: 50048, output_tokens: 624, reasoning_output_tokens: 177 }, cost_usd: 0.00367496 },
  }));
  return unwrap(normalizeUsageLedger([sample]));
};

const complete = (run: BenchmarkRun, usage: UsageLedger): BenchmarkRun => {
  const finished = unwrap(transitionBenchmarkRun(run, { type: 'agent_finished', endedAtMs: 1_797_000_000_100 }));
  const grading = unwrap(transitionBenchmarkRun(finished, { type: 'start_grading' }));
  return unwrap(transitionBenchmarkRun(grading, {
    type: 'record',
    quality: { status: 'passed', passedChecks: 1, failedChecks: 0, hiddenChecks: { status: 'known', value: 1 } },
    usage,
  }));
};

const incomplete = (run: BenchmarkRun): BenchmarkRun => {
  const aborted = unwrap(transitionBenchmarkRun(run, { type: 'aborted', endedAtMs: 1_797_000_000_101, reason: 'AgentAuthenticationError; retained failed run' }));
  const grading = unwrap(transitionBenchmarkRun(aborted, { type: 'start_grading' }));
  return unwrap(transitionBenchmarkRun(grading, {
    type: 'record_incomplete',
    quality: { status: 'unknown', passedChecks: 0, failedChecks: 0, hiddenChecks: { status: 'unknown', reason: 'agent authentication failed before verifier' } },
    reason: 'No reward; authentication failed before task execution',
  }));
};

const main = async (): Promise<void> => {
  const frozen = suite();
  const report = unwrap(makeComparisonReportWithSha256({
    reportId: 'ace-local-smoke-baseline',
    suite: frozen,
    runs: [
      complete(runBase(frozen, 'harbor-oauth-success', 'native-codex'), measuredUsage()),
      incomplete(runBase(frozen, 'harbor-api-key-failure', 'native-codex'),),
    ],
    limitations: [
      'One successful smoke task is not a baseline-vs-ACE comparison.',
      'The failed API-key run is retained as an incomplete run and contributes no success.',
      'No 5x claim is permitted; the repeated native-vs-ACE holdout report is retained separately because the baseline smoke is a different historical run.',
    ],
    releasedAtMs: 1_797_000_000_200,
  }));
  await mkdir('benchmarks/reports', { recursive: true });
  const written = unwrap(await writeComparisonReportArtifacts('benchmarks/reports', report));
  process.stdout.write(`${JSON.stringify({ report: written.markdownPath, evidenceHash: report.evidenceHash, totalRuns: report.totalRuns, successfulRuns: report.successfulRuns })}\n`);
};

await main();
