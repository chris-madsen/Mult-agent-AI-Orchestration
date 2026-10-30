import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = (name: string): Promise<string> => readFile(`scripts/${name}`, 'utf8');

test('real provider runner bounds child cleanup and exposes the source-root boundary', async () => {
  const source = await script('real-provider-e2e.mjs');
  assert.match(source, /ACE_SOURCE_ROOT/iu);
  assert.match(source, /const terminateChild = async/iu);
  assert.match(source, /child\.kill\('SIGKILL'\)/u);
  assert.match(source, /RUNNER_TIMEOUT/u);
  assert.match(source, /ACE_RETRIEVAL_STRATEGY.*\|\| 'dense'/u);
});

test('Git-dependent provider runners separate source and runtime roots', async () => {
  for (const name of [
    'real-provider-restart-e2e.mjs',
    'qdrant-snapshot-crash-e2e.mjs',
    'qdrant-snapshot-concurrency-e2e.mjs',
  ]) {
    const source = await script(name);
    assert.match(source, /ACE_SOURCE_ROOT/iu, name);
    assert.match(source, /ACE_RETRIEVAL_STRATEGY.*\|\| 'dense'/u, name);
    if (name !== 'real-provider-restart-e2e.mjs') {
      assert.match(source, /ACE_SOURCE_ROOT must be a Git worktree/u, name);
    }
  }
});
