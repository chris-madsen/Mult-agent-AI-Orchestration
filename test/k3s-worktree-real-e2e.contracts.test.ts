import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('real k3s worktree runner uses pinned disposable client and safe evidence only', async () => {
  const source = await readFile('scripts/k3s-worktree-real-e2e.mjs', 'utf8');
  assert.match(source, /curlimages\/curl@sha256:[a-f0-9]{64}/u);
  for (const id of ['K3S-01', 'K3S-02', 'K3S-03', 'K3S-04', 'K3S-05', 'K3S-06', 'K3S-07', 'K3S-08', 'K3S-09', 'K3S-10']) {
    assert.match(source, new RegExp(`id: '${id}'`, 'u'));
  }
  assert.match(source, /'delete', 'secret'/u);
  assert.match(source, /deletePod/u);
  assert.doesNotMatch(source, /hostPath/u);
  assert.doesNotMatch(source, /console\.log\(.*(?:bytesBase64|source)/isu);
});
