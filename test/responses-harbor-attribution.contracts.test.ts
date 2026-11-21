import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const revision = 'a'.repeat(40);
const digest = (character: string): string => character.repeat(64);

const taskManifest = {
  schemaVersion: 1,
  selection: 'smoke',
  dataset: { id: 'scale-ai/swe-atlas-qna', revision, rawSha256: digest('b') },
  tasks: [{ id: 'task-1', sourceRevision: revision, sourceDigest: digest('c'), taskDigest: digest('d') }],
  holdout: [],
};

const experimentFor = (taskManifestSha256: string) => ({
  schemaVersion: 1,
  runId: 'c08-synthetic-attribution-contract',
  sourceCommit: revision,
  taskManifestSha256,
  agent: 'hermes',
  agentVersion: '0.22.3',
  model: 'openai-codex/gpt-5.6-luna',
  reasoningEffort: 'high',
  harborVersion: '0.24.0',
  taskImages: [{ reference: 'registry.example/task:1', digest: `sha256:${digest('e')}` }],
  agentAdapterSha256: digest('1'),
  aceContextBridgeSha256: digest('2'),
  contextPluginSha256: digest('3'),
  seed: 'c08-seed',
  mode: 'cold',
  nConcurrentTrials: 1,
  nAttempts: 1,
  authenticationRoute: 'Hermes openai-codex OAuth',
});

const writeTrial = (
  root: string,
  name: string,
  agentResult: Readonly<Record<string, number>>,
  projectionRequestId?: string,
): string => {
  const directory = join(root, name);
  mkdirSync(join(directory, 'agent'), { recursive: true });
  writeFileSync(join(directory, 'result.json'), JSON.stringify({
    trial_id: `${name}-trial`,
    task_name: 'task-1',
    started_at: '2026-11-20T10:00:00.000Z',
    finished_at: '2026-11-20T10:01:00.000Z',
    verifier_result: { rewards: { reward: 1 } },
    exception_info: null,
    agent_result: agentResult,
  }));
  if (projectionRequestId !== undefined) {
    writeFileSync(join(directory, 'agent', 'ace-responses-projection.jsonl'), `${JSON.stringify({
      schemaVersion: 'ace.context.v3',
      requestId: projectionRequestId,
      decision: { kind: 'PREPARED' },
      baseBodySha256: digest('6'),
      projectedBodySha256: digest('7'),
      bodyBase64: 'e30=',
      reasonCode: 'VERIFIED_CONTEXT_ADDED',
    })}\n`);
  }
  return directory;
};

test('C08 feedback collector and renderer keep unsigned delivery, missing costs, and ratios diagnostic', () => {
  const root = mkdtempSync(join(tmpdir(), 'ace-c08-harbor-attribution-'));
  try {
    const taskManifestPath = join(root, 'task-manifest.json');
    const taskManifestBytes = Buffer.from(`${JSON.stringify(taskManifest, null, 2)}\n`);
    writeFileSync(taskManifestPath, taskManifestBytes);
    const experimentPath = join(root, 'experiment-manifest.json');
    writeFileSync(experimentPath, `${JSON.stringify(experimentFor(sha256(taskManifestBytes)), null, 2)}\n`);

    const nativeRoot = join(root, 'native');
    const aceRoot = join(root, 'ace');
    mkdirSync(nativeRoot);
    mkdirSync(aceRoot);
    writeTrial(nativeRoot, 'native-trial', {
      n_input_tokens: 100,
      n_cache_tokens: 20,
      n_output_tokens: 30,
      n_reasoning_tokens: 7,
      cost_usd: 0.01,
    });
    const projectionRequestId = `ace-${'8'.repeat(32)}`;
    writeTrial(aceRoot, 'ace-trial', {
      n_input_tokens: 40,
      n_cache_tokens: 10,
      n_output_tokens: 15,
      n_reasoning_tokens: 5,
      cost_usd: 0.005,
    }, projectionRequestId);
    const nativeAggregate = join(nativeRoot, 'aggregate.json');
    const aceAggregate = join(aceRoot, 'aggregate.json');
    writeFileSync(nativeAggregate, JSON.stringify({ n_total_trials: 1 }));
    writeFileSync(aceAggregate, JSON.stringify({ n_total_trials: 1 }));

    const runDirectory = join(root, 'run');
    const collect = spawnSync(process.execPath, [
      '--import', 'tsx',
      'scripts/collect-feedback-loop.ts',
      taskManifestPath,
      experimentPath,
      nativeAggregate,
      aceAggregate,
      runDirectory,
    ], { cwd: resolve('.'), encoding: 'utf8', timeout: 60_000 });
    assert.equal(collect.status, 0, collect.stderr);
    assert.match(collect.stdout, /"acceptance":"diagnostic-only"/u);
    assert.match(collect.stdout, /"fiveXClaimAllowed":false/u);

    const metrics = JSON.parse(readFileSync(join(runDirectory, 'metrics.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(metrics.status, 'UNKNOWN');
    assert.equal(metrics.nativeTotalTokens, 130);
    assert.equal(metrics.aceTotalTokens, 55);
    assert.equal(metrics.nativeCachedInputTokens, 20);
    assert.equal(metrics.aceCachedInputTokens, 10);
    assert.equal(metrics.nativeReasoningOutputTokens, 7);
    assert.equal(metrics.aceReasoningOutputTokens, 5);
    assert.equal(metrics.tokenRatio, null, 'projection and retrieval traces cannot attribute model-bound savings');
    assert.equal(metrics.aceCorrelatedCalls, 0);

    const runManifest = JSON.parse(readFileSync(join(runDirectory, 'manifest.json'), 'utf8')) as {
      readonly acceptance: { readonly status: string; readonly fiveXClaimAllowed: boolean; readonly blockers: readonly string[] };
      readonly agentLoopEvidence: { readonly path: string; readonly sha256: string; readonly status: string };
      readonly rawArtifactHashes: readonly { readonly path: string; readonly sha256: string }[];
      readonly nativeResponsesEvidence: { readonly finalWireEvidenceStatus: string; readonly streamReceiptCount: number };
      readonly costTelemetry: {
        readonly nonModelExternalAndInfrastructure: { readonly status: string; readonly amountUsd: number | null };
        readonly totalExternal: { readonly status: string; readonly amountUsd: number | null };
      };
    };
    assert.equal(runManifest.acceptance.status, 'diagnostic-only');
    assert.equal(runManifest.acceptance.fiveXClaimAllowed, false);
    assert.equal(runManifest.agentLoopEvidence.status, 'NOT_RUN');
    assert.ok(runManifest.rawArtifactHashes.some((artifact) => artifact.path === runManifest.agentLoopEvidence.path
      && artifact.sha256 === runManifest.agentLoopEvidence.sha256));
    assert.equal(runManifest.nativeResponsesEvidence.finalWireEvidenceStatus, 'NOT_RUN');
    assert.equal(runManifest.nativeResponsesEvidence.streamReceiptCount, 0);
    assert.deepEqual(runManifest.costTelemetry.nonModelExternalAndInfrastructure, { status: 'unknown', amountUsd: null });
    assert.deepEqual(runManifest.costTelemetry.totalExternal, { status: 'unknown', amountUsd: null });
    assert.ok(runManifest.acceptance.blockers.includes('NON_MODEL_EXTERNAL_COSTS_UNKNOWN'));

    const summaryPath = join(root, 'report.md');
    const render = () => spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/render-feedback-summary.ts', runDirectory, summaryPath, '--external-output',
    ], { cwd: resolve('.'), encoding: 'utf8', timeout: 60_000 });
    const rendered = render();
    assert.equal(rendered.status, 0, rendered.stderr);
    const summary = readFileSync(summaryPath, 'utf8');
    assert.match(summary, /DBC-12 acceptance: diagnostic-only/u);
    assert.match(summary, /Fivefold claim: NOT_ALLOWED/u);
    assert.match(summary, /Final-wire evidence: NOT_RUN/u);
    assert.match(summary, /Non-model external\/infrastructure cost: UNKNOWN/u);
    assert.match(summary, /Token totals are provider input plus output/u);
    assert.match(summary, /Native reasoning subset/u);

    const forgedManifest = JSON.parse(readFileSync(join(runDirectory, 'manifest.json'), 'utf8')) as Record<string, any>;
    forgedManifest.acceptance.status = 'measured-not-necessarily-5x';
    forgedManifest.acceptance.fiveXClaimAllowed = true;
    writeFileSync(join(runDirectory, 'manifest.json'), `${JSON.stringify(forgedManifest, null, 2)}\n`);
    const forgedRender = render();
    assert.notEqual(forgedRender.status, 0);
    assert.match(forgedRender.stderr, /does not match independently recomputed evidence/u);

    writeFileSync(join(aceRoot, 'ace-trial', 'result.json'), JSON.stringify({
      trial_id: 'ace-trial-trial',
      task_name: 'task-1',
      started_at: '2026-11-20T10:00:00.000Z',
      finished_at: '2026-11-20T10:01:00.000Z',
      verifier_result: null,
      exception_info: { type: 'VerifierTimeoutError' },
      timed_out: true,
      agent_result: {},
    }));
    const failedCollect = spawnSync(process.execPath, [
      '--import', 'tsx',
      'scripts/collect-feedback-loop.ts',
      taskManifestPath,
      experimentPath,
      nativeAggregate,
      aceAggregate,
      runDirectory,
    ], { cwd: resolve('.'), encoding: 'utf8', timeout: 60_000 });
    assert.equal(failedCollect.status, 2, failedCollect.stderr);
    const failedMetrics = JSON.parse(readFileSync(join(runDirectory, 'metrics.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(failedMetrics.status, 'QUALITY_REGRESSION');
    assert.deepEqual(failedMetrics.qualityRegressionTaskIds, ['task-1']);
    assert.equal(failedMetrics.tokenRatio, null);
    const failedSummary = render();
    assert.equal(failedSummary.status, 0, failedSummary.stderr);
    assert.match(readFileSync(summaryPath, 'utf8'), /DBC-12 acceptance: rejected/u);
    assert.match(readFileSync(summaryPath, 'utf8'), /Fivefold claim: NOT_ALLOWED/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
