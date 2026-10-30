import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeFileWorkspaceStore } from '../src/application/file-workspace-store.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import { observeWorkspace, registerWorkspace } from '../src/application/workspace-service.js';

test('concurrent real file stores agree on one canonical workspace registration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ace-register-race-'));
  try {
    const rootPath = join(directory, 'worktree');
    await mkdir(rootPath);
    const stateFile = join(directory, 'workspace-state.json');
    const files = makeNodeWorkspacePort({ allowedRoots: [directory] });
    const first = makeFileWorkspaceStore(stateFile);
    const second = makeFileWorkspaceStore(stateFile);

    // Force both readers to observe the absent root before either writer
    // enters the existing cross-process filesystem write fence.
    let readers = 0;
    let unblock: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => { unblock = resolve; });
    const storeWithBarrier = (store: typeof first) => ({
      ...store,
      findByRoot: (canonicalRoot: string) => Effect.promise(async () => {
        const found = await Effect.runPromise(store.findByRoot(canonicalRoot));
        if (found._tag === 'Ok' && found.value === undefined) {
          readers += 1;
          if (readers === 2) unblock();
          await barrier;
        }
        return found;
      }),
    });
    const ports = (store: ReturnType<typeof storeWithBarrier>, id: string) => ({
      files,
      store,
      clock: { nowMs: () => 1000 },
      ids: { newWorkspaceId: () => id, newRequestId: () => id },
    });
    const [a, b] = await Promise.all([
      Effect.runPromise(registerWorkspace(ports(storeWithBarrier(first), 'writer-a'), { rootPath })),
      Effect.runPromise(registerWorkspace(ports(storeWithBarrier(second), 'writer-b'), { rootPath })),
    ]);
    assert.equal(a._tag, 'Ok');
    assert.equal(b._tag, 'Ok');
    if (a._tag === 'Err' || b._tag === 'Err') return;
    assert.equal(a.value.workspaceId, b.value.workspaceId,
      'losing registration must use committed winner, never a fabricated second workspace');
    const persisted = await Effect.runPromise(first.findByRoot(a.value.rootPath));
    assert.equal(persisted._tag, 'Ok');
    if (persisted._tag === 'Ok') {
      assert.equal(persisted.value?.workspaceId, a.value.workspaceId);
    }
    const observed = await Effect.runPromise(observeWorkspace(ports(storeWithBarrier(first), 'writer-a'), a.value.workspaceId));
    assert.equal(observed._tag, 'Ok');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
