import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { stagePinnedTaskImageOverlay } from '../scripts/feedback-task-image-overlay.js';

test('fast feedback runner is bounded and fail-closed', async () => {
  const runner = await readFile('scripts/run-fast-feedback-loop.ts', 'utf8');
  assert.match(runner, /maxRuntimeSec = Number\(parsed\['--max-runtime-sec'\] \?\? '150'\)/u);
  assert.match(runner, /maxRuntimeSec > 180/u);
  assert.match(runner, /status: 'TIMEOUT'/u);
  assert.match(runner, /status: 'BLOCKED'/u);
  assert.match(runner, /raw-agent-native/u);
  assert.match(runner, /expected exactly one Harbor aggregate result/u);
  assert.match(runner, /Promise\.all\(\[/u);
  assert.doesNotMatch(runner, /npm ci|hermes plugins enable|install\.sh/u);
  assert.doesNotMatch(runner, /OPENAI_API_KEY|OPENROUTER_API_KEY/u);
  assert.match(runner, /deadline = Date\.now\(\) \+ args\.maxRuntimeSec \* 1000/u);
  assert.match(runner, /timeoutMs: Math\.min\(timeoutMs, remaining\)/u);
  assert.match(runner, /reportPath = join\(args\.output, 'report\.md'\)/u);
  assert.match(runner, /report\.status !== 'PASS'/u);
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
  const verifier = await readFile('benchmarks/harbor/ace-local-smoke-paired/tests/test.sh', 'utf8');
  assert.match(freezer, /local\/ace-suite/u);
  assert.match(freezer, /git.*ls-tree|ls-tree/u);
  assert.match(freezer, /must remain outside the source checkout/u);
  assert.match(jobs, /--task-image <reference>/u);
  assert.match(jobs, /contradicts task\.toml docker_image/u);
  assert.match(jobs, /taskImageOverride/u);
  assert.match(task, /docker_image = "ace-local-hermes:ace-local-smoke-paired-fast@sha256:/u);
  assert.match(verifier, /codex\.txt.*hermes\.txt/u);
});

test('fast runner preserves ACE_NOT_USED as a non-savings diagnostic outcome', async () => {
  const runner = await readFile('scripts/run-fast-feedback-loop.ts', 'utf8');
  const domain = await readFile('src/domain/feedback-loop-experiment.ts', 'utf8');
  assert.match(runner, /metricsStatus/u);
  assert.match(domain, /ACE_NOT_USED/u);
});

test('local freeze reads committed [task] identity and cannot write through an output symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-local-feedback-freeze-'));
  const source = join(root, 'source');
  const taskDir = join(source, 'tasks', 'fixture');
  await mkdir(taskDir, { recursive: true });
  await writeFile(join(taskDir, 'task.toml'), [
    '[metadata]', 'name = "wrong-section"', '[task]', 'name = "ace/correct-fixture"', '',
  ].join('\n'), 'utf8');
  const git = (args: string[]): void => {
    const result = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init', '-q']);
  git(['add', '.']);
  git(['-c', 'user.name=ACE Test', '-c', 'user.email=ace@example.invalid', 'commit', '-qm', 'fixture']);
  const external = join(root, 'external');
  await mkdir(external, { recursive: true });
  const freeze = (output: string) => spawnSync(resolve('node_modules/.bin/tsx'), [
    'scripts/freeze-local-feedback-task.ts', '--source-root', source,
    '--task-path', 'tasks/fixture', '--output', output,
  ], { cwd: resolve('.'), encoding: 'utf8', timeout: 30_000 });
  const successOutput = join(external, 'good');
  const success = freeze(successOutput);
  assert.equal(success.status, 0, success.stderr);
  const manifest = JSON.parse(await readFile(join(successOutput, 'task-manifest.json'), 'utf8')) as {
    tasks: { id: string }[];
  };
  assert.equal(manifest.tasks[0]?.id, 'ace/correct-fixture');

  const hidden = join(source, '.git', 'trap');
  await mkdir(hidden);
  const alias = join(external, 'alias');
  await symlink(hidden, alias, 'dir');
  const blocked = freeze(alias);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /resolves into the source checkout/u);
  assert.equal(existsSync(join(hidden, 'task-manifest.json')), false);
  assert.equal(existsSync(join(hidden, 'manifest.json')), false);
});

test('fast report external mode is restricted to its own run output', () => {
  const result = spawnSync(resolve('node_modules/.bin/tsx'), [
    'scripts/render-feedback-summary.ts',
    '/tmp/feedback-run/reconciled',
    '/tmp/other-run/report.md',
    '--external-output',
  ], { cwd: resolve('.'), encoding: 'utf8', timeout: 30_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /external feedback report must be the sibling report.md/u);
});

test('pinned-image task overlay selects prebuilt image without touching frozen task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-harbor-image-overlay-'));
  const task = join(root, 'source-task');
  const overlay = join(root, 'generated-task');
  await mkdir(join(task, 'environment'), { recursive: true });
  const original = '[task]\nname = "ace/test"\n[environment]\nnetwork_mode = "public"\n';
  await writeFile(join(task, 'task.toml'), original, 'utf8');
  await writeFile(join(task, 'environment', 'Dockerfile'), 'FROM scratch\n', 'utf8');
  const digest = 'sha256:' + 'a'.repeat(64);
  const result = await stagePinnedTaskImageOverlay(task, overlay, 'ace-image:cached', digest);
  const generated = await readFile(join(overlay, 'task.toml'), 'utf8');
  assert.match(generated, new RegExp(`docker_image = "ace-image:cached@${digest}"`, 'u'));
  assert.equal(existsSync(join(overlay, 'environment', 'Dockerfile')), false);
  assert.equal(await readFile(join(task, 'task.toml'), 'utf8'), original);
  assert.equal(existsSync(join(task, 'environment', 'Dockerfile')), true);
  assert.notEqual(result.sourceTaskTomlSha256, result.effectiveTaskTomlSha256);
  const localOverlay = join(root, 'local-id-overlay');
  const local = await stagePinnedTaskImageOverlay(task, localOverlay, 'ace-image:cached', digest, digest);
  assert.equal(local.image, digest);
  assert.match(await readFile(join(localOverlay, 'task.toml'), 'utf8'), /docker_image = "sha256:[a-f0-9]{64}"/u);
  await assert.rejects(
    stagePinnedTaskImageOverlay(task, overlay, 'ace-image:cached', digest),
    /runtime task overlay already exists/u,
  );
});
