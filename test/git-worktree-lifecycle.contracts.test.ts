import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(repoRoot, 'scripts/git-worktree-lifecycle.mjs');

const gitResult = (cwd: string, args: string[]) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result;
};

const git = (cwd: string, args: string[]): string => {
  const result = gitResult(cwd, args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
};

const createRepository = async (): Promise<{ root: string; origin: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'ace-worktree-lifecycle-'));
  const origin = join(root, 'origin.git');
  const checkout = join(root, 'checkout');
  execFileSync('git', ['init', '--bare', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-b', 'main', checkout], { encoding: 'utf8' });
  for (const [key, value] of [['user.name', 'Lifecycle Test'], ['user.email', 'lifecycle@example.test']]) {
    git(checkout, ['config', key, value]);
  }
  await writeFile(join(checkout, 'README.md'), 'fixture\n');
  git(checkout, ['add', 'README.md']);
  git(checkout, ['commit', '-m', 'fixture']);
  git(checkout, ['remote', 'add', 'origin', origin]);
  git(checkout, ['push', '-u', 'origin', 'main']);
  return { root, origin };
};

const runCli = (cwd: string, args: string[], pullRequests: unknown[] = []) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ACE_WORKTREE_LIFECYCLE_PR_JSON: JSON.stringify(pullRequests) },
  });
  let json: any = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // Text/error assertions use stdout/stderr directly.
  }
  return { ...result, json };
};

const branchPr = (
  branch: string,
  state: 'OPEN' | 'MERGED' = 'OPEN',
  headRefOid: string | null = null,
) => ({
  number: state === 'OPEN' ? 101 : 102,
  title: 'fixture PR',
  headRefName: branch,
  baseRefName: 'main',
  state,
  mergedAt: state === 'MERGED' ? '2026-11-01T00:00:00Z' : null,
  headRefOid,
});

test('audit is read-only and start reuses the deterministic task worktree', async (t) => {
  const fixture = await createRepository();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const checkout = join(fixture.root, 'checkout');
  const worktree = join(fixture.root, 'retrieval-gates');

  const before = git(checkout, ['worktree', 'list', '--porcelain']);
  const audit = runCli(checkout, ['audit', '--json']);
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(audit.json.worktrees.length, 1);
  assert.equal(audit.json.worktrees[0].status, 'legacy-unclassified');
  assert.equal(git(checkout, ['worktree', 'list', '--porcelain']), before);

  const start = runCli(checkout, ['start', '--task-id', 'retrieval-gates', '--path', worktree, '--owner', 'test-owner', '--json']);
  assert.equal(start.status, 0, start.stderr);
  assert.equal(start.json.action, 'create');
  assert.equal(start.json.record.branch, 'codex/retrieval-gates');
  assert.equal(start.json.record.worktreePath, worktree);

  const reuse = runCli(checkout, ['preflight', '--task-id', 'retrieval-gates', '--json']);
  assert.equal(reuse.status, 0, reuse.stderr);
  assert.equal(reuse.json.action, 'reuse');
  assert.equal(reuse.json.worktreePath, worktree);

  const registeredAudit = runCli(checkout, ['audit', '--json'], [branchPr('codex/retrieval-gates')]);
  assert.equal(registeredAudit.status, 0, registeredAudit.stderr);
  const registered = registeredAudit.json.worktrees.find((item: any) => item.path === worktree);
  assert.equal(registered.status, 'pr-open');
  assert.equal(registered.taskId, 'retrieval-gates');
  assert.equal(registered.owner, 'test-owner');
});

test('preflight fails closed for a dirty checkout and an active merge operation', async (t) => {
  const fixture = await createRepository();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const checkout = join(fixture.root, 'checkout');
  await writeFile(join(checkout, 'dirty.txt'), 'local change\n');

  const dirty = runCli(checkout, ['preflight', '--task-id', 'blocked-task', '--json']);
  assert.notEqual(dirty.status, 0);
  assert.equal(dirty.stderr.includes('CURRENT_WORKTREE_NOT_CLEAN'), true);
  await rm(join(checkout, 'dirty.txt'));

  const head = git(checkout, ['rev-parse', 'HEAD']);
  await writeFile(join(checkout, '.git', 'MERGE_HEAD'), `${head}\n`);
  const merge = runCli(checkout, ['preflight', '--task-id', 'merge-task', '--json']);
  assert.notEqual(merge.status, 0);
  assert.equal(merge.stderr.includes('CURRENT_WORKTREE_NOT_CLEAN'), true);
  await rm(join(checkout, '.git', 'MERGE_HEAD'));
});

test('different task IDs that normalize to the same readable slug do not reuse one worktree', async (t) => {
  const fixture = await createRepository();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const checkout = join(fixture.root, 'checkout');
  const firstPath = join(fixture.root, 'feature-slash');
  const secondPath = join(fixture.root, 'feature-dash');

  const first = runCli(checkout, ['start', '--task-id', 'feature/a', '--path', firstPath, '--json']);
  assert.equal(first.status, 0, first.stderr);
  const second = runCli(checkout, ['start', '--task-id', 'feature-a', '--path', secondPath, '--json']);
  assert.equal(second.status, 0, second.stderr);

  assert.notEqual(first.json.record.branch, second.json.record.branch);
  assert.notEqual(first.json.record.worktreePath, second.json.record.worktreePath);
  assert.equal(git(checkout, ['worktree', 'list', '--porcelain']).includes(firstPath), true);
  assert.equal(git(checkout, ['worktree', 'list', '--porcelain']).includes(secondPath), true);
});

test('cleanup refuses a clean branch whose HEAD is newer than the merged PR head', async (t) => {
  const fixture = await createRepository();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const checkout = join(fixture.root, 'checkout');
  const worktree = join(fixture.root, 'reused-after-merge');
  const branch = 'codex/reused-after-merge';

  const start = runCli(checkout, ['start', '--task-id', 'reused-after-merge', '--path', worktree, '--json']);
  assert.equal(start.status, 0, start.stderr);
  await writeFile(join(worktree, 'first.txt'), 'first PR change\n');
  git(worktree, ['add', 'first.txt']);
  git(worktree, ['commit', '-m', 'first PR']);
  const mergedHead = git(worktree, ['rev-parse', 'HEAD']);

  await writeFile(join(worktree, 'second.txt'), 'new work after merge\n');
  git(worktree, ['add', 'second.txt']);
  git(worktree, ['commit', '-m', 'new work after merge']);
  const currentHead = git(worktree, ['rev-parse', 'HEAD']);
  assert.notEqual(currentHead, mergedHead);

  const cleanup = runCli(
    checkout,
    ['cleanup', '--task-id', 'reused-after-merge', '--json'],
    [branchPr(branch, 'MERGED', mergedHead)],
  );
  assert.notEqual(cleanup.status, 0, 'cleanup must fail closed when local HEAD is not the merged PR head');
  assert.equal(git(checkout, ['worktree', 'list', '--porcelain']).includes(worktree), true);
  assert.equal(git(worktree, ['rev-parse', 'HEAD']), currentHead);
});

test('cleanup deletes an exact merged PR branch even when Git ancestry reflects a squash merge', async (t) => {
  const fixture = await createRepository();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const checkout = join(fixture.root, 'checkout');
  const worktree = join(fixture.root, 'squash-merged');
  const branch = 'codex/squash-merged';

  const start = runCli(checkout, ['start', '--task-id', 'squash-merged', '--path', worktree, '--json']);
  assert.equal(start.status, 0, start.stderr);
  await writeFile(join(worktree, 'feature.txt'), 'same resulting content\n');
  git(worktree, ['add', 'feature.txt']);
  git(worktree, ['commit', '-m', 'feature commit']);
  const prHead = git(worktree, ['rev-parse', 'HEAD']);

  await writeFile(join(checkout, 'feature.txt'), 'same resulting content\n');
  git(checkout, ['add', 'feature.txt']);
  git(checkout, ['commit', '-m', 'squash result on main']);

  const cleanup = runCli(
    checkout,
    ['cleanup', '--task-id', 'squash-merged', '--json'],
    [branchPr(branch, 'MERGED', prHead)],
  );
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.equal(cleanup.json.deletedLocalBranch, true);
  assert.equal(git(checkout, ['worktree', 'list', '--porcelain']).includes(worktree), false);
  assert.notEqual(gitResult(checkout, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status, 0);
});

test('merged clean cleanup removes only the local worktree and branch', async (t) => {
  const fixture = await createRepository();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const checkout = join(fixture.root, 'checkout');
  const worktree = join(fixture.root, 'clean-task');
  const branch = 'codex/clean-task';

  const start = runCli(checkout, ['start', '--task-id', 'clean-task', '--path', worktree, '--json']);
  assert.equal(start.status, 0, start.stderr);
  const prHead = git(worktree, ['rev-parse', 'HEAD']);
  const cleanup = runCli(checkout, ['cleanup', '--task-id', 'clean-task', '--json'], [branchPr(branch, 'MERGED', prHead)]);
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.equal(cleanup.json.deletedLocalBranch, true);
  assert.equal(cleanup.json.remoteBranchTouched, false);
  assert.notEqual(gitResult(checkout, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status, 0);
  assert.equal(git(checkout, ['worktree', 'list', '--porcelain']).includes(worktree), false);
  assert.equal(git(checkout, ['ls-remote', '--heads', 'origin', branch]), '');
});

test('merged dirty cleanup preserves local work and records merged-dirty', async (t) => {
  const fixture = await createRepository();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const checkout = join(fixture.root, 'checkout');
  const worktree = join(fixture.root, 'dirty-task');
  const branch = 'codex/dirty-task';

  const start = runCli(checkout, ['start', '--task-id', 'dirty-task', '--path', worktree, '--json']);
  assert.equal(start.status, 0, start.stderr);
  await writeFile(join(worktree, 'uncommitted.txt'), 'must survive cleanup refusal\n');
  const prHead = git(worktree, ['rev-parse', 'HEAD']);
  const cleanup = runCli(checkout, ['cleanup', '--task-id', 'dirty-task', '--json'], [branchPr(branch, 'MERGED', prHead)]);
  assert.notEqual(cleanup.status, 0);
  assert.equal(cleanup.stderr.includes('WORKTREE_NOT_CLEAN'), true);
  assert.equal(git(worktree, ['status', '--porcelain']).includes('uncommitted.txt'), true);
  const record = JSON.parse(await readFile(join(checkout, '.git', 'ace-worktree-state', 'dirty-task.json'), 'utf8'));
  assert.equal(record.status, 'merged-dirty');
});

test('status records PR ownership and preserves the observed worktree state', async (t) => {
  const fixture = await createRepository();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const checkout = join(fixture.root, 'checkout');
  const worktree = join(fixture.root, 'status-task');
  const branch = 'codex/status-task';

  const start = runCli(checkout, ['start', '--task-id', 'status-task', '--path', worktree, '--owner', 'hermes', '--session-id', 'session-1', '--json']);
  assert.equal(start.status, 0, start.stderr);
  const status = runCli(checkout, ['status', '--task-id', 'status-task', '--json'], [branchPr(branch)]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.json.record.status, 'pr-open');
  assert.equal(status.json.record.prNumber, 101);
  assert.equal(status.json.record.owner, 'hermes');
  assert.equal(status.json.record.sessionId, 'session-1');
});

test('audit reports malformed registry records without touching worktrees', async (t) => {
  const fixture = await createRepository();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const checkout = join(fixture.root, 'checkout');
  const state = join(checkout, '.git', 'ace-worktree-state');
  await writeFile(state, 'not a directory\n');
  await rm(state, { force: true });
  await mkdir(state, { recursive: true });
  await writeFile(join(state, 'broken.json'), '{broken\n');

  const audit = runCli(checkout, ['audit', '--json']);
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(audit.json.registryIssues.length, 1);
  assert.equal(audit.json.registryIssues[0].code, 'INVALID_RECORD');
  assert.equal(audit.json.worktrees.length, 1);
});
