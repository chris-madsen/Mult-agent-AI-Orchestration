import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeLspServerRegistry, type LspRegistrySession } from '../src/application/lsp/server-registry.js';

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

test('LSP registry lazily starts one session, reference-counts leases, and closes once', async () => {
  const counters = { starts: 0, closes: 0 };
  const registry = makeLspServerRegistry();
  const first = await Effect.runPromise(registry.acquire('workspace|typescript', () => session(counters)));
  const second = await Effect.runPromise(registry.acquire('workspace|typescript', () => session(counters)));
  assert.equal(first._tag, 'Ok');
  assert.equal(second._tag, 'Ok');
  if (first._tag === 'Ok' && second._tag === 'Ok') {
    assert.equal(first.value.session, second.value.session);
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
  const first = await Effect.runPromise(registry.acquire('workspace|typescript', () => session(counters)));
  const second = await Effect.runPromise(registry.acquire('workspace|typescript', () => session(counters)));
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
