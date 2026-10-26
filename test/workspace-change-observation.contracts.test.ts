import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { Effect } from 'effect';
import { makeHostWorkspacePort } from '../src/adapters/host-worktree-helper.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import type { HostHelperTransport, HostWorktreeValue } from '../src/adapters/host-worktree-helper.js';
import { ok } from '../src/domain/result.js';
import { makeWorkspaceId, type RepoPath } from '../src/domain/workspace.js';

const execFileAsync = promisify(execFile);
const git = (cwd: string, args: readonly string[]) => execFileAsync('git', [...args], { cwd, encoding: 'utf8' });
const path = (value: string): RepoPath => value as RepoPath;

const createGitWorkspace = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'ace-workspace-observation-'));
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.email', 'ace-tests@example.invalid']);
  await git(root, ['config', 'user.name', 'ACE Tests']);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/changed.ts'), 'export const changed = false;\n');
  await writeFile(join(root, 'src/renamed.ts'), 'export const renamed = true;\n');
  await writeFile(join(root, 'src/deleted.ts'), 'export const deleted = true;\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'fixture']);
  return root;
};

test('NodeWorkspacePort observes changed, added, deleted, and renamed paths without a full snapshot', async () => {
  const root = await createGitWorkspace();
  try {
    const port = makeNodeWorkspacePort({ allowedRoots: [root] });
    const initial = await Effect.runPromise(port.snapshot(root, 1));
    assert.equal(initial._tag, 'Ok');

    await writeFile(join(root, 'src/changed.ts'), 'export const changed = true;\n');
    await rename(join(root, 'src/renamed.ts'), join(root, 'src/moved.ts'));
    await unlink(join(root, 'src/deleted.ts'));
    await writeFile(join(root, 'src/added.ts'), 'export const added = true;\n');
    await git(root, ['add', '-A']);

    const observed = await Effect.runPromise(port.observeChanges(root, initial.value.headRevision));
    assert.equal(observed._tag, 'Ok');
    assert.deepEqual(observed.value.changedPaths, ['src/changed.ts']);
    assert.deepEqual(observed.value.addedPaths, ['src/added.ts']);
    assert.deepEqual(observed.value.deletedPaths, ['src/deleted.ts']);
    assert.deepEqual(observed.value.renamed, [{ from: 'src/renamed.ts', to: 'src/moved.ts' }]);
    assert.deepEqual(observed.value.untrackedPaths, []);
    assert.deepEqual(observed.value.stagedPaths?.sort(), [
      'src/added.ts', 'src/changed.ts', 'src/moved.ts',
    ]);
    assert.deepEqual(observed.value.deletedPaths, ['src/deleted.ts']);
    assert.deepEqual(observed.value.unstagedPaths, []);
    assert.equal(typeof observed.value.branch, 'string');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('NodeWorkspacePort reconciles all prior paths once when a non-Git workspace becomes Git', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-workspace-git-transition-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'one.ts'), 'export const one = 1;\n');
    const port = makeNodeWorkspacePort({ allowedRoots: [root] });
    const before = await Effect.runPromise(port.snapshot(root, 1));
    assert.equal(before._tag, 'Ok');
    if (before._tag === 'Err') return;
    assert.equal(before.value.headRevision, 'unavailable');

    await git(root, ['init', '--quiet']);
    await git(root, ['add', '.']);
    await git(root, [
      '-c', 'user.name=ACE Transition Fixture',
      '-c', 'user.email=ace-transition@example.invalid',
      'commit', '--quiet', '-m', 'first git snapshot',
    ]);

    const observed = await Effect.runPromise(port.observeChanges(root, {
      headRevision: before.value.headRevision,
      files: before.value.files.map((file) => ({
        repoPath: file.repoPath,
        sizeBytes: file.sizeBytes,
        ...(file.mtimeMs === undefined ? {} : { mtimeMs: file.mtimeMs }),
      })),
    }));
    assert.equal(observed._tag, 'Ok');
    if (observed._tag === 'Err') return;
    assert.match(observed.value.headRevision, /^[a-f0-9]{40,64}$/u);
    assert.ok(observed.value.changedPaths.includes('src/one.ts' as never),
      'first real Git HEAD must force exact reconciliation of pre-Git source');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('NodeWorkspacePort keeps a clean non-Git workspace as an explicit no-change observation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-workspace-non-git-'));
  try {
    const port = makeNodeWorkspacePort({ allowedRoots: [root] });
    const observed = await Effect.runPromise(port.observeChanges(root));
    assert.equal(observed._tag, 'Ok');
    assert.deepEqual(observed.value, {
      headRevision: 'unavailable',
      changedPaths: [],
      addedPaths: [],
      deletedPaths: [],
      renamed: [],
      untrackedPaths: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('host-worktree helper forwards and validates observe_changes', async () => {
  const workspace = makeWorkspaceId('host-observation-contract');
  assert.equal(workspace._tag, 'Ok');
  if (workspace._tag === 'Err') return;
  const transport: HostHelperTransport = {
    invoke: async (request) => request.operation === 'observe_changes'
      ? ok<HostWorktreeValue>({
        changeObservation: {
          headRevision: 'a'.repeat(40),
          changedPaths: [path('src/changed.ts')],
          addedPaths: [path('src/added.ts')],
          deletedPaths: [],
          renamed: [],
        },
      })
      : ok<HostWorktreeValue>({ logicalRoot: '/logical' }),
  };
  const port = makeHostWorkspacePort(workspace.value, transport);
  const observed = await Effect.runPromise(port.observeChanges('/logical', 'b'.repeat(40)));
  assert.equal(observed._tag, 'Ok');
  assert.deepEqual(observed.value.addedPaths, ['src/added.ts']);
});
