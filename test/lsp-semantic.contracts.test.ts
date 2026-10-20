import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Effect } from 'effect';
import { makeLspSemanticAnalysisPort, resolveLspProviderIdentity } from '../src/adapters/lsp-semantic.js';

const command = join(process.cwd(), 'node_modules/.bin/typescript-language-server');

test('generic LSP adapter uses the real TypeScript language server for definitions, references, hover and diagnostics', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'ace-lsp-contract-'));
  const snapshotIdentity = 'a'.repeat(64);
  const source = 'export function save(): string { return "ok"; }\nconst value = save();\nconst invalid = missingValue();\n';
  const provider = makeLspSemanticAnalysisPort({
    command,
    rootPath,
    files: { 'main.ts': source },
    snapshotIdentity,
    timeoutMs: 20_000,
  });
  try {
    const definition = await Effect.runPromise(provider.definition({
      repoPath: 'main.ts', line: 2, column: 15, snapshotIdentity,
    }));
    assert.equal(definition._tag, 'Ok');
    if (definition._tag === 'Ok') assert.deepEqual(definition.value[0]?.location, {
      repoPath: 'main.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 21,
    });

    const references = await Effect.runPromise(provider.references({
      repoPath: 'main.ts', line: 1, column: 17, snapshotIdentity,
    }));
    assert.equal(references._tag, 'Ok');
    if (references._tag === 'Ok') assert.equal(references.value.length, 2);

    const hover = await Effect.runPromise(provider.typeInfo({
      repoPath: 'main.ts', line: 2, column: 15, snapshotIdentity,
    }));
    assert.equal(hover._tag, 'Ok');
    if (hover._tag === 'Ok') assert.match(hover.value?.display ?? '', /save|\(\)/u);

    const diagnostics = await Effect.runPromise(provider.diagnostics({ repoPath: 'main.ts' }));
    assert.equal(diagnostics._tag, 'Ok');
    if (diagnostics._tag === 'Ok') assert.ok(diagnostics.value.some((item) => item.code === 2304));

    const stale = await Effect.runPromise(provider.definition({
      repoPath: 'main.ts', line: 2, column: 15, snapshotIdentity: 'b'.repeat(64),
    }));
    assert.equal(stale._tag, 'Err');
    if (stale._tag === 'Err') assert.equal(stale.error.code, 'NOT_READY');
  } finally {
    provider.close();
  }
});

test('LSP identity and unsupported language status are explicit', async () => {
  const identity = await Effect.runPromise(resolveLspProviderIdentity({
    command,
    snapshotIdentity: 'c'.repeat(64),
  }));
  assert.equal(identity._tag, 'Ok');
  if (identity._tag === 'Ok') {
    assert.equal(identity.value.server, 'typescript-language-server');
    assert.deepEqual(identity.value.args, ['--stdio']);
    assert.equal(identity.value.protocol, 'lsp');
    assert.match(identity.value.version, /^6\.0\.2$/u);
    assert.match(identity.value.fingerprint, /^[a-f0-9]{64}$/u);
  }

  const customArgs = await Effect.runPromise(resolveLspProviderIdentity({
    command: process.execPath,
    args: [],
    serverName: 'custom-lsp',
    snapshotIdentity: 'e'.repeat(64),
  }));
  assert.equal(customArgs._tag, 'Ok');
  if (customArgs._tag === 'Ok') {
    assert.equal(customArgs.value.server, 'custom-lsp');
    assert.deepEqual(customArgs.value.args, []);
  }

  const provider = makeLspSemanticAnalysisPort({
    command,
    rootPath: process.cwd(),
    files: { 'main.py': 'def save():\n    return True\n' },
    snapshotIdentity: 'd'.repeat(64),
  });
  const result = await Effect.runPromise(provider.definition({
    repoPath: 'main.py', line: 1, column: 5, snapshotIdentity: 'd'.repeat(64),
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'UNSUPPORTED_PROVIDER');
  provider.close();
});
