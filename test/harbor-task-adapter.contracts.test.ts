import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeHarborJobConfig, resetHarborWorktree, retainHarborArtifacts } from '../src/adapters/harbor-task-adapter.js';
import type { CommandPort } from '../src/adapters/harbor-runner.js';
import { ok } from '../src/domain/result.js';

test('Harbor adapter builds isolated pinned Codex job config', () => {
  const result = makeHarborJobConfig({ taskPath: 'benchmarks/harbor/ace-local-smoke', taskName: 'ace-local-smoke', version: '1.0.0', language: 'devops', repoBaseCommit: 'fixture' }, { jobName: 'smoke', modelName: 'gpt-5.6-luna', reasoningEffort: 'high', jobsDir: 'artifacts/harbor', codexConfigPath: 'benchmarks/harbor/ace-codex-config.toml' });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.environment.delete, true);
  assert.equal(result.value.agents[0]?.model_name, 'gpt-5.6-luna');
  assert.equal(result.value.agents[0]?.kwargs.config, 'benchmarks/harbor/ace-codex-config.toml');
  assert.equal(makeHarborJobConfig({ taskPath: '../escape', taskName: 'bad', version: '1', language: 'devops', repoBaseCommit: 'x' }, { jobName: 'x', modelName: 'm', reasoningEffort: 'low', jobsDir: 'artifacts' })._tag, 'Err');
  assert.equal(makeHarborJobConfig({ taskPath: 'task', taskName: 'bad', version: '1', language: 'devops', repoBaseCommit: 'x' }, { jobName: 'x', modelName: 'm', reasoningEffort: 'low', jobsDir: 'artifacts', codexConfigPath: '../escape.toml' })._tag, 'Err');
});

test('local ACE task verifiers accept Hermes agent logs without weakening Codex compatibility', async () => {
  for (const task of ['ace-retrieval-impact', 'ace-cloud-policy-impact', 'ace-shared-archive-impact']) {
    const script = await readFile(join('benchmarks/harbor', task, 'tests', 'test.sh'), 'utf8');
    assert.match(script, /codex\.txt.*hermes\.txt/u);
  }
});

test('Harbor reset is restricted to child worktrees and uses non-shell git commands', async () => {
  const calls: string[][] = [];
  const command: CommandPort = { run: async (_executable, args) => { calls.push([...args]); return ok({ exitCode: 0, stdout: '', stderr: '' }); } };
  const root = await mkdtemp(join(tmpdir(), 'ace-harbor-root-'));
  const child = await mkdtemp(join(root, 'worktree-'));
  assert.equal((await resetHarborWorktree(command, child, root, 'abc123'))._tag, 'Ok');
  assert.deepEqual(calls, [['-C', child, 'reset', '--hard', 'abc123'], ['-C', child, 'clean', '-ffdx']]);
  assert.equal((await resetHarborWorktree(command, root, root, 'abc123'))._tag, 'Err');
});

test('Harbor artifact retention writes a digest manifest and preserves bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-harbor-artifacts-'));
  await writeFile(join(root, 'trial.log'), 'failed run is evidence\n', 'utf8');
  const manifestPath = join(root, 'retained', 'manifest.json');
  const result = await retainHarborArtifacts('smoke', root, ['trial.log'], manifestPath);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.retained[0]?.sizeBytes, 23);
  assert.match(await readFile(manifestPath, 'utf8'), /trial\.log/);
});
