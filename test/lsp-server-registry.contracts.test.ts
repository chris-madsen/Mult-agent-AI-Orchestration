import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeLspServerRegistry, type LspRegistrySession, type LspServerDescriptor } from '../src/application/lsp/server-registry.js';

const session = (counters: { starts: number; closes: number }): LspRegistrySession => {
  counters.starts += 1;
  return {
    definition: () => Effect.succeed({ _tag: 'Ok', value: [] } as never),
    references: () => Effect.succeed({ _tag: 'Ok', value: [] } as never),
    typeInfo: () => Effect.succeed({ _tag: 'Ok', value: undefined } as never),
    diagnostics: () => Effect.succeed({ _tag: 'Ok', value: [] } as never),
    refresh: () => Effect.succeed({ _tag: 'Ok', value: undefined } as never),
    close: () => { counters.closes += 1; },
  };
};

const descriptor: LspServerDescriptor = {
  key: 'workspace|typescript',
  command: 'typescript-language-server',
  args: ['--stdio'],
  serverName: 'typescript-language-server',
};

test('LSP registry lazily starts one session, reference-counts leases, and closes once', async () => {
  const counters = { starts: 0, closes: 0 };
  const registry = makeLspServerRegistry();
  const first = await Effect.runPromise(registry.acquire(descriptor, () => session(counters)));
  const second = await Effect.runPromise(registry.acquire(descriptor, () => session(counters)));
  assert.equal(first._tag, 'Ok');
  assert.equal(second._tag, 'Ok');
  if (first._tag === 'Ok' && second._tag === 'Ok') {
    assert.equal(first.value.session, second.value.session);
    assert.deepEqual(registry.inspect(), [{ descriptor, refs: 2, state: 'leased' }]);
    first.value.release();
    assert.equal(counters.closes, 0);
    second.value.release();
    assert.equal(counters.closes, 1);
  }
  assert.equal(counters.starts, 1);
  await Effect.runPromise(registry.close());
  assert.equal(counters.closes, 1);
});

test('LSP registry shutdown closes a leased session once even if leases release later', async () => {
  const counters = { starts: 0, closes: 0 };
  const registry = makeLspServerRegistry();
  const first = await Effect.runPromise(registry.acquire(descriptor, () => session(counters)));
  const second = await Effect.runPromise(registry.acquire(descriptor, () => session(counters)));
  assert.equal(first._tag, 'Ok');
  assert.equal(second._tag, 'Ok');
  await Effect.runPromise(registry.close());
  assert.equal(counters.closes, 1);
  if (first._tag === 'Ok' && second._tag === 'Ok') {
    first.value.release();
    second.value.release();
    first.value.release();
  }
  await Effect.runPromise(registry.close());
  assert.equal(counters.closes, 1);
  assert.equal(counters.starts, 1);
});

test('LSP registry rejects an empty descriptor key before creating a session', async () => {
  const counters = { starts: 0, closes: 0 };
  const registry = makeLspServerRegistry();
  const result = await Effect.runPromise(registry.acquire({ ...descriptor, key: ' ' }, () => session(counters)));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_INPUT');
  assert.equal(counters.starts, 0);
});


test('LSP registry rejects descriptor collisions instead of reusing a different server under the same key', async () => {
  const counters = { starts: 0, closes: 0 };
  const registry = makeLspServerRegistry();
  const first = await Effect.runPromise(registry.acquire(descriptor, () => session(counters)));
  assert.equal(first._tag, 'Ok');
  const collided = await Effect.runPromise(registry.acquire({
    ...descriptor,
    command: 'rust-analyzer',
    serverName: 'rust-analyzer',
    args: [],
  }, () => session(counters)));
  assert.equal(collided._tag, 'Err');
  if (collided._tag === 'Err') assert.equal(collided.error.code, 'INVALID_INPUT');
  assert.equal(counters.starts, 1, 'colliding descriptor must not create or reuse a mismatched session');
  if (first._tag === 'Ok') first.value.release();
  await Effect.runPromise(registry.close());
});


test('LSP registry close waits for an async shutdown already started by lease release', async () => {
  let shutdownFinished = false;
  const registry = makeLspServerRegistry();
  const asyncSession: LspRegistrySession = {
    definition: () => Effect.succeed({ _tag: 'Ok', value: [] } as never),
    references: () => Effect.succeed({ _tag: 'Ok', value: [] } as never),
    typeInfo: () => Effect.succeed({ _tag: 'Ok', value: undefined } as never),
    diagnostics: () => Effect.succeed({ _tag: 'Ok', value: [] } as never),
    refresh: () => Effect.succeed({ _tag: 'Ok', value: undefined } as never),
    close: async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      shutdownFinished = true;
    },
  };
  const acquired = await Effect.runPromise(registry.acquire(descriptor, () => asyncSession));
  assert.equal(acquired._tag, 'Ok');
  if (acquired._tag === 'Ok') acquired.value.release();
  assert.equal(shutdownFinished, false);
  await Effect.runPromise(registry.close());
  assert.equal(shutdownFinished, true);
});
