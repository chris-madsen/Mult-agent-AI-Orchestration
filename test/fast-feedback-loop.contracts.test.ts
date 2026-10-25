import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('fast feedback runner is bounded and fail-closed', async () => {
  const runner = await readFile('scripts/run-fast-feedback-loop.ts', 'utf8');
  assert.match(runner, /maxRuntimeSec = Number\(parsed\['--max-runtime-sec'\] \?\? '150'\)/u);
  assert.match(runner, /maxRuntimeSec > 180/u);
  assert.match(runner, /status: 'TIMEOUT'/u);
  assert.match(runner, /status: 'BLOCKED'/u);
  assert.match(runner, /raw-agent-native/u);
  assert.match(runner, /expected exactly one Harbor aggregate result/u);
  assert.doesNotMatch(runner, /npm ci|hermes plugins enable|install\.sh/u);
  assert.doesNotMatch(runner, /OPENAI_API_KEY|OPENROUTER_API_KEY/u);
});

test('fast feedback runner rejects a budget above three minutes before touching runtime inputs', () => {
  const run = spawnSync(resolve('node_modules/.bin/tsx'), [
    'scripts/run-fast-feedback-loop.ts',
    '--source-root', '/tmp/source',
    '--task-path', 'benchmarks/harbor/ace-local-smoke-paired',
    '--ace-runtime-bundle', '/tmp/runtime',
    '--task-image', 'ace-local-hermes:cached',
    '--task-image-digest', 'ace-local-hermes:cached=sha256:' + 'a'.repeat(64),
    '--model', 'gpt-5.6-luna',
    '--reasoning', 'low',
    '--output', '/tmp/fast-feedback-test',
    '--max-runtime-sec', '181',
  ], { cwd: resolve('.'), encoding: 'utf8', timeout: 30_000 });
  assert.notEqual(run.status, 0);
  assert.match(`${run.stdout}\n${run.stderr}`, /between 1 and 180/u);
});

test('local task freezing and image override keep provenance explicit', async () => {
  const freezer = await readFile('scripts/freeze-local-feedback-task.ts', 'utf8');
  const jobs = await readFile('scripts/prepare-harbor-feedback-jobs.ts', 'utf8');
  const task = await readFile('benchmarks/harbor/ace-local-smoke-paired/task.toml', 'utf8');
  assert.match(freezer, /local\/ace-suite/u);
  assert.match(freezer, /git.*ls-tree|ls-tree/u);
  assert.match(freezer, /must remain outside the source checkout/u);
  assert.match(jobs, /--task-image <reference>/u);
  assert.match(jobs, /contradicts task\.toml docker_image/u);
  assert.match(jobs, /taskImageOverride/u);
  assert.match(task, /docker_image = "ace-local-hermes:ace-retrieval-impact@sha256:/u);
});

test('fast runner preserves ACE_NOT_USED as a non-savings diagnostic outcome', async () => {
  const runner = await readFile('scripts/run-fast-feedback-loop.ts', 'utf8');
  const domain = await readFile('src/domain/feedback-loop-experiment.ts', 'utf8');
  assert.match(runner, /metricsStatus/u);
  assert.match(domain, /ACE_NOT_USED/u);
});
