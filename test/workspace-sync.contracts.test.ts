import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { ok } from '../src/domain/result.js';
import { makeWorkspaceId, type RepoPath } from '../src/domain/workspace.js';
import {
  makeWorkspaceSync,
  observeWorkspaceManifest,
  type WorkspaceSyncState,
} from '../src/application/workspace-sync.js';
import { workspaceManifestFromFiles, type WorkspaceManifest } from '../src/domain/workspace-manifest.js';
import type { WorkspaceFilePort } from '../src/application/ports.js';

const workspaceId = (() => {
  const result = makeWorkspaceId('workspace-sync-contract');
  assert.equal(result._tag, 'Ok');
  return result.value;
})();

const path = (value: string): RepoPath => value as RepoPath;
const digest = (value: string): `${string}` => value.repeat(64) as `${string}`;

const manifest = (
  repoPath: string,
  sourceDigest: string,
  headRevision = 'a'.repeat(40),
): WorkspaceManifest => workspaceManifestFromFiles({
  headRevision,
  scopeFingerprint: 'scope-v1',
  files: [{
    repoPath: path(repoPath),
    sourceDigest: digest(sourceDigest),
    sizeBytes: 1,
    state: 'tracked',
  }],
});

const initialState = (source: WorkspaceManifest): WorkspaceSyncState => ({
  workspaceId,
  workspaceManifest: source,
  generation: 1,
  indexKey: 'index-v1',
  candidateIdsByPath: new Map(),
});

test('WorkspaceSync refreshes once, reuses the verified state on no-op refresh, and classifies changes', async () => {
  const first = manifest('src/one.ts', 'a');
  const next = manifest('src/one.ts', 'b');
  let observed = next;
  let rebuildCalls = 0;
  const sync = makeWorkspaceSync({
    initial: initialState(first),
    observeChanges: () => Effect.succeed(ok({ changed: true, manifest: observed })),
    rebuild: ({ nextManifest, previous }) => {
      rebuildCalls += 1;
      return Effect.succeed(ok({
        ...previous,
        workspaceManifest: nextManifest,
        generation: previous.generation + 1,
        indexKey: 'index-v2',
      }));
    },
  });

  const refreshed = await Effect.runPromise(sync.refresh());
  assert.equal(refreshed._tag, 'Ok');
  if (refreshed._tag === 'Ok') {
    assert.equal(refreshed.value.refreshed, true);
    assert.deepEqual(refreshed.value.delta.changed, [path('src/one.ts')]);
    assert.equal(refreshed.value.state.generation, 2);
  }
  assert.equal(rebuildCalls, 1);

  observed = next;
  const noOp = await Effect.runPromise(sync.refresh());
  assert.equal(noOp._tag, 'Ok');
  if (noOp._tag === 'Ok') assert.equal(noOp.value.refreshed, false);
  assert.equal(rebuildCalls, 1);
});

test('WorkspaceSync serializes concurrent refreshes and commits one rebuilt state', async () => {
  const first = manifest('src/one.ts', 'a');
  const next = manifest('src/one.ts', 'b');
  let rebuildCalls = 0;
  const sync = makeWorkspaceSync({
    initial: initialState(first),
    observeChanges: () => Effect.succeed(ok({ changed: true, manifest: next })),
    rebuild: ({ nextManifest, previous }) => Effect.promise(async () => {
      rebuildCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return ok({
        ...previous,
        workspaceManifest: nextManifest,
        generation: previous.generation + 1,
        indexKey: 'index-v2',
      });
    }),
  });

  const results = await Promise.all([
    Effect.runPromise(sync.refresh()),
    Effect.runPromise(sync.refresh()),
  ]);
  assert.equal(rebuildCalls, 1);
  for (const result of results) {
    assert.equal(result._tag, 'Ok');
    if (result._tag === 'Ok') assert.equal(result.value.state.generation, 2);
  }
});

test('WorkspaceSync rejects a rebuild whose manifest is already stale', async () => {
  const first = manifest('src/one.ts', 'a');
  const next = manifest('src/one.ts', 'b');
  const stale = manifest('src/one.ts', 'c');
  const sync = makeWorkspaceSync({
    initial: initialState(first),
    observeChanges: () => Effect.succeed(ok({ changed: true, manifest: next })),
    rebuild: () => Effect.succeed(ok({
      ...initialState(stale),
      generation: 2,
      indexKey: 'index-v2',
    })),
  });

  const result = await Effect.runPromise(sync.refresh());
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'WORKTREE_RACED');
});




test('WorkspaceSync advances the active HEAD without rebuilding when source content is identical', async () => {
  const first = manifest('src/one.ts', 'a', 'a'.repeat(40));
  const sameContentNewHead = manifest('src/one.ts', 'a', 'b'.repeat(40));
  const seenHeads: string[] = [];
  let calls = 0;
  const owner = makeWorkspaceSync({
    initial: initialState(first),
    observeChanges: (current) => {
      seenHeads.push(current.workspaceManifest.headRevision);
      calls += 1;
      return Effect.succeed(ok(calls === 1
        ? { changed: true, manifest: sameContentNewHead }
        : { changed: false }));
    },
    rebuild: () => {
      throw new Error('content-identical HEAD advance must not rebuild');
    },
  });

  const advanced = await Effect.runPromise(owner.refresh());
  assert.equal(advanced._tag, 'Ok');
  if (advanced._tag === 'Ok') {
    assert.equal(advanced.value.refreshed, false);
    assert.equal(advanced.value.state.workspaceManifest.headRevision, 'b'.repeat(40));
  }
  await Effect.runPromise(owner.refresh());
  assert.deepEqual(seenHeads, ['a'.repeat(40), 'b'.repeat(40)]);
});

test('changed-path observation exact-reads only affected files and does not rebuild an unchanged dirty file', async () => {
  const source = Buffer.from('export const value = 2;\n');
  const sourceDigest = digest('b') as never;
  const current = workspaceManifestFromFiles({
    headRevision: 'a'.repeat(40),
    scopeFingerprint: 'scope-v1',
    files: [{
      repoPath: path('src/one.ts'),
      sourceDigest,
      sizeBytes: source.byteLength,
      state: 'tracked',
    }],
  });
  let reads = 0;
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => { throw new Error('not used'); },
    snapshot: () => { throw new Error('changed-path observation must not snapshot the repository'); },
    observeChanges: (_root, previousHead) => {
      assert.equal(previousHead, current.headRevision);
      return Effect.succeed(ok({
        headRevision: current.headRevision,
        changedPaths: [path('src/one.ts')],
        addedPaths: [],
        deletedPaths: [],
        renamed: [],
        stagedPaths: [path('src/one.ts')],
        unstagedPaths: [],
        untrackedPaths: [],
        branch: 'main',
      }));
    },
    readExact: (_root, repoPath) => {
      reads += 1;
      assert.equal(repoPath, path('src/one.ts'));
      return Effect.succeed(ok({ bytes: source, digest: sourceDigest }));
    },
  };

  const observed = await Effect.runPromise(observeWorkspaceManifest(files, '/repo', current));
  assert.equal(observed._tag, 'Ok');
  if (observed._tag === 'Ok') {
    assert.equal(observed.value.changed, false);
    assert.deepEqual(observed.value.delta?.changed, []);
    assert.deepEqual(observed.value.workingContext?.stagedPaths, [path('src/one.ts')]);
    assert.equal(observed.value.workingContext?.branch, 'main');
  }
  assert.equal(reads, 1);
});


test('retrieval-scoped observation ignores out-of-scope and sensitive path changes without reading them', async () => {
  const current = workspaceManifestFromFiles({
    headRevision: 'a'.repeat(40),
    scopeFingerprint: 'scope-v1',
    files: [
      { repoPath: path('src/one.ts'), sourceDigest: digest('a') as never, sizeBytes: 1, state: 'tracked' },
      { repoPath: path('README.md'), sourceDigest: digest('b') as never, sizeBytes: 1, state: 'tracked' },
      { repoPath: path('.env'), sourceDigest: digest('c') as never, sizeBytes: 1, state: 'untracked' },
    ],
  });
  let reads = 0;
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => { throw new Error('not used'); },
    snapshot: () => { throw new Error('scoped observation must not snapshot'); },
    observeChanges: () => Effect.succeed(ok({
      headRevision: current.headRevision,
      changedPaths: [path('.env')],
      addedPaths: [],
      deletedPaths: [path('README.md')],
      renamed: [],
      untrackedPaths: [path('.env')],
    })),
    readExact: () => {
      reads += 1;
      throw new Error('out-of-scope or sensitive paths must not be exact-read');
    },
  };
  const observed = await Effect.runPromise(observeWorkspaceManifest(
    files,
    '/repo',
    current,
    (repoPath) => repoPath.endsWith('.ts'),
  ));
  assert.equal(observed._tag, 'Ok');
  if (observed._tag === 'Ok') assert.equal(observed.value.changed, false);
  assert.equal(reads, 0);
});
