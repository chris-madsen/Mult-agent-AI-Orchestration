import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeGitHistoryPort } from '../src/adapters/git-history.js';

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();

test('Git history provider returns direct commit evidence ranked by message/path terms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-git-history-'));
  try {
    git(root, ['init']);
    git(root, ['config', 'user.email', 'ace@example.invalid']);
    git(root, ['config', 'user.name', 'ACE Test']);

    await writeFile(join(root, 'payment.ts'), 'export const retryPayment = () => true;\n', 'utf8');
    git(root, ['add', 'payment.ts']);
    git(root, ['commit', '-m', 'Add payment retry policy']);
    const paymentSha = git(root, ['rev-parse', 'HEAD']);

    await writeFile(join(root, 'config.ts'), "export const key = 'ACE_QDRANT_COLLECTION';\n", 'utf8');
    git(root, ['add', 'config.ts']);
    git(root, ['commit', '-m', 'Wire Qdrant collection configuration']);

    const port = makeGitHistoryPort();
    const result = await Effect.runPromise(port.search({
      rootPath: root,
      query: 'почему payment retry изменили',
      limit: 3,
      requestId: 'history-test',
    }));

    assert.equal(result._tag, 'Ok');
    if (result._tag === 'Err') throw new Error(result.error.message);
    assert.ok(result.value.length >= 1);
    assert.equal(result.value[0]?.source, 'history');
    assert.equal(result.value[0]?.proofClass, 'direct');
    assert.equal(result.value[0]?.citation, `git:${paymentSha}`);
    assert.equal(result.value[0]?.sourceRevision, paymentSha);
    assert.match(result.value[0]?.content ?? '', /Add payment retry policy/u);
    assert.match(result.value[0]?.content ?? '', /payment\.ts/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Git history provider fails closed for an invalid repo even when temp dir has a Git ancestor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-no-git-history-'));
  try {
    // Explicit invalid .git sentinel blocks ancestor discovery if TMPDIR
    // happens to be inside the project checkout on the test runner.
    await writeFile(join(root, '.git'), 'invalid git metadata\\n', 'utf8');
    const result = await Effect.runPromise(makeGitHistoryPort().search({
      rootPath: root,
      query: 'why retry',
      limit: 5,
    }));
    assert.equal(result._tag, 'Err');
    if (result._tag === 'Err') {
      assert.equal(result.error.code, 'EXTERNAL_UNAVAILABLE');
      assert.equal(result.error.path, 'git_history');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
