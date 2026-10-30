import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
  makeLspServerDescriptor,
  makeLspServerRegistry,
  type LspRegistrySession,
  type LspServerDescriptor,
} from '../src/application/lsp/server-registry.js';

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
    assert.equal(first.value.created, true);
    assert.equal(second.value.created, false);
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

test('LSP process descriptor identity is stable across source generations', () => {
  const input = {
    workspaceId: 'workspace-1',
    rootPath: '/repo',
    command: 'typescript-language-server',
    args: ['--stdio'],
    serverName: 'typescript-language-server',
    languageIds: { '.ts': 'typescript' },
  };
  const first = makeLspServerDescriptor(input);
  const second = makeLspServerDescriptor({ ...input, languageIds: { '.ts': 'typescript' } });
  assert.deepEqual(first, second);
  assert.doesNotMatch(first.key, /snapshot|generation/iu);
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

test('Claw pinned discovery chooses installed server for verified workspace paths', async () => {
  const { findKnownLspForFile, knownLspServers, selectInstalledLspForPaths } =
    await import('../src/application/lsp/claw-discovery.js');
  assert.ok(knownLspServers().length >= 13);
  assert.equal(findKnownLspForFile('src/worker.py')?.command, 'pyright-langserver');
  assert.equal(findKnownLspForFile('src/component.tsx')?.command, 'typescript-language-server');
  assert.equal(findKnownLspForFile('.gitignore'), undefined);
  const checks: string[] = [];
  const chosen = selectInstalledLspForPaths(['a.py', 'b.py', 'c.ts', 'd.ts', 'e.go'], (item) => {
    checks.push(item.command);
    return item.command !== 'pyright-langserver';
  });
  assert.equal(chosen?.command, 'typescript-language-server');
  assert.deepEqual(checks, ['pyright-langserver', 'typescript-language-server']);
  assert.equal(selectInstalledLspForPaths(['README.md'], () => true), undefined);
});

test('Claw language allowlist keeps an unrelated TS document out of a Python LSP session', async () => {
  const { lspLanguageIdForPath } = await import('../src/adapters/lsp-semantic.js');
  const { findKnownLspForFile } = await import('../src/application/lsp/claw-discovery.js');
  const python = findKnownLspForFile('tools/scan.py');
  assert.ok(python);
  assert.equal(lspLanguageIdForPath('tools/scan.py', python.languageIds), 'python');
  assert.equal(lspLanguageIdForPath('app.ts', python.languageIds), undefined);
  assert.equal(lspLanguageIdForPath('app.ts'), 'typescript');
});

test('Claw multi-server registry routing preserves independent language ownership', async () => {
  const { selectInstalledLspServersForPaths } = await import('../src/application/lsp/claw-discovery.js');
  const { makeRoutedLspSession } = await import('../src/application/lsp/routed-semantic.js');
  const detected = selectInstalledLspServersForPaths(
    ['src/app.ts', 'src/work.py', 'src/pkg.go', 'README.md'],
    (entry) => ['typescript-language-server', 'pyright-langserver'].includes(entry.command),
  );
  assert.deepEqual(detected.map((entry) => entry.command),
    ['pyright-langserver', 'typescript-language-server']);
  const called = { py: 0, ts: 0 };
  const python = {
    ...session({ starts: 0, closes: 0 }),
    references: () => { called.py += 1; return Effect.succeed({ _tag: 'Ok', value: [] } as never); },
  };
  const typescript = {
    ...session({ starts: 0, closes: 0 }),
    references: () => { called.ts += 1; return Effect.succeed({ _tag: 'Ok', value: [] } as never); },
  };
  const composite = makeRoutedLspSession(detected.map((item) => ({
    session: item.command === 'pyright-langserver' ? python : typescript,
    languageIds: item.languageIds,
  })));
  const query = { line: 1, column: 1 };
  assert.equal((await Effect.runPromise(composite.references({ ...query, repoPath: 'src/work.py' })))._tag, 'Ok');
  assert.equal((await Effect.runPromise(composite.references({ ...query, repoPath: 'src/app.ts' })))._tag, 'Ok');
  assert.equal((await Effect.runPromise(composite.references({ ...query, repoPath: 'src/pkg.go' })))._tag, 'Err');
  assert.deepEqual(called, { py: 1, ts: 1 });
});
