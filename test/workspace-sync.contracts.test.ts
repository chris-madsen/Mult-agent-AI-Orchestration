import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { ok } from '../src/domain/result.js';
import { makeWorkspaceId, type RepoPath } from '../src/domain/workspace.js';
import { makeWorkspaceSync, type WorkspaceSyncState } from '../src/application/workspace-sync.js';
import type { WorkspaceManifest } from '../src/domain/workspace-manifest.js';

const workspaceId = (() => {
  const result = makeWorkspaceId('workspace-sync-contract');
  assert.equal(result._tag, 'Ok');
  return result.value;
})();

const path = (value: string): RepoPath => value as RepoPath;
const digest = (value: string): `${string}` => value.repeat(64) as `${string}`;

const manifest = (repoPath: string, sourceDigest: string): WorkspaceManifest => ({
  schemaVersion: 1,
  scopeFingerprint: 'scope-v1',
  files: [{
    repoPath: path(repoPath),
    sourceDigest: digest(sourceDigest),
    sizeBytes: 1,
    state: 'tracked',
  }],
  removedPaths: [],
  contentIdentity: `${repoPath}:${sourceDigest}`,
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


