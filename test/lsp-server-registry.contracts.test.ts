import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeLspServerRegistry } from '../src/application/lsp/server-registry.js';
import { ok } from '../src/domain/result.js';
import type { SemanticAnalysisPort } from '../src/application/ports.js';

const port = (close: () => void): SemanticAnalysisPort & { readonly close: () => void } => ({
  definition: () => Effect.succeed(ok([])),
  references: () => Effect.succeed(ok([])),
  typeInfo: () => Effect.succeed(ok(undefined)),
  diagnostics: () => Effect.succeed(ok([])),
  close,
});

test('LSP registry lazily creates one workspace-scoped server and releases it by reference count', () => {
  const registry = makeLspServerRegistry();
  let factories = 0;
  let closes = 0;
  const factory = () => {
    factories += 1;
    return port(() => { closes += 1; });
  };
  const first = registry.acquire('workspace:snapshot-a', factory);
  const second = registry.acquire('workspace:snapshot-a', factory);
  assert.equal(first, second);
  assert.equal(factories, 1);
  registry.release('workspace:snapshot-a');
  assert.equal(closes, 0);
  registry.release('workspace:snapshot-a');
  assert.equal(closes, 1);
});

test('LSP registry closes all active servers during workspace shutdown', () => {
  const registry = makeLspServerRegistry();
  let closes = 0;
  registry.acquire('a', () => port(() => { closes += 1; }));
  registry.acquire('b', () => port(() => { closes += 1; }));
  registry.closeAll();
  assert.equal(closes, 2);
});
