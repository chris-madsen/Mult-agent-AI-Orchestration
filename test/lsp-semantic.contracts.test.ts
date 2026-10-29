import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Effect } from 'effect';
import { makeLspSemanticAnalysisPort, resolveLspProviderIdentity } from '../src/adapters/lsp-semantic.js';
import { makeAstGrepStructuralPort } from '../src/adapters/ast-grep-structural.js';
import { utf16ColumnAtUtf8Byte } from '../src/domain/utf8-range.js';

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

    const refreshedIdentity = 'b'.repeat(64);
    const refreshedSource = source
      .replaceAll('save', 'load')
      .replace('const invalid = missingValue();\n', '');
    const refreshed = await Effect.runPromise(provider.refresh({
      'main.ts': refreshedSource,
    }, refreshedIdentity));
    assert.equal(refreshed._tag, 'Ok');
    const refreshedDiagnostics = await Effect.runPromise(provider.diagnostics({ repoPath: 'main.ts' }));
    assert.equal(refreshedDiagnostics._tag, 'Ok');
    if (refreshedDiagnostics._tag === 'Ok') {
      assert.equal(
        refreshedDiagnostics.value.some((item) => item.code === 2304),
        false,
        'didChange must invalidate stale push diagnostics from the prior document version',
      );
    }
    const current = await Effect.runPromise(provider.definition({
      repoPath: 'main.ts', line: 2, column: 15, snapshotIdentity: refreshedIdentity,
    }));
    assert.equal(current._tag, 'Ok');

    const stale = await Effect.runPromise(provider.definition({
      repoPath: 'main.ts', line: 2, column: 15, snapshotIdentity: snapshotIdentity,
    }));
    assert.equal(stale._tag, 'Err');
    if (stale._tag === 'Err') assert.equal(stale.error.code, 'NOT_READY');

    await provider.close();
    const afterClose = await Effect.runPromise(provider.definition({
      repoPath: 'main.ts', line: 2, column: 15, snapshotIdentity: refreshedIdentity,
    }));
    assert.equal(afterClose._tag, 'Err');
    if (afterClose._tag === 'Err') assert.equal(afterClose.error.code, 'NOT_READY');
  } finally {
    await provider.close();
  }
});

test('pull-diagnostics servers are queried immediately with the advertised diagnostic identifier', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'ace-lsp-pull-diagnostics-'));
  const serverPath = join(rootPath, 'pull-server.cjs');
  const jsonRpcEntry = createRequire(import.meta.url).resolve('vscode-jsonrpc/node');
  await writeFile(serverPath, [
    `const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = require(${JSON.stringify(jsonRpcEntry)});`,
    'const connection = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));',
    'connection.onRequest(\'initialize\', () => ({ capabilities: { diagnosticProvider: { identifier: \'fake-pull\', interFileDependencies: false, workspaceDiagnostics: false } } }));',
    'connection.onNotification(\'textDocument/didOpen\', async (params) => {',
    '  await connection.sendNotification(\'textDocument/publishDiagnostics\', {',
    '    uri: params.textDocument.uri,',
    '    diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, message: \'stale push diagnostic\', severity: 2, code: 66 }],',
    '  });',
    '});',
    'connection.onRequest(\'textDocument/definition\', () => null);',
    'connection.onRequest(\'textDocument/diagnostic\', (params) => {',
    '  if (params.identifier !== \'fake-pull\') throw new Error(\'wrong diagnostic identifier\');',
    '  return { kind: \'full\', items: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, message: \'pull diagnostic\', severity: 1, code: 77 }] };',
    '});',
    'connection.onRequest(\'shutdown\', () => null);',
    'connection.onNotification(\'exit\', () => process.exit(0));',
    'connection.listen();',
    '',
  ].join('\n'), 'utf8');
  const snapshotIdentity = '7'.repeat(64);
  const provider = makeLspSemanticAnalysisPort({
    command: process.execPath,
    args: [serverPath],
    serverName: 'fake-server-name-must-not-be-used-as-diagnostic-id',
    rootPath,
    files: { 'main.ts': 'const value = 1;\n' },
    snapshotIdentity,
    timeoutMs: 1_500,
  });
  try {
    const warmed = await Effect.runPromise(provider.definition({
      repoPath: 'main.ts', line: 1, column: 1, snapshotIdentity,
    }));
    assert.equal(warmed._tag, 'Ok');
    const startedAt = Date.now();
    const diagnostics = await Effect.runPromise(provider.diagnostics({ repoPath: 'main.ts' }));
    assert.equal(diagnostics._tag, 'Ok');
    if (diagnostics._tag === 'Ok') {
      assert.deepEqual(
        diagnostics.value.map((item) => item.code),
        [77],
        'an advertised pull provider remains authoritative even if it also published a cached push result',
      );
    }
    assert.ok(
      Date.now() - startedAt < 1_000,
      'pull-capable servers must not wait for the push-diagnostics timeout first',
    );
  } finally {
    await provider.close();
  }
});

test('LSP semantic queries are serialized through one vscode-jsonrpc session', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'ace-lsp-serialized-'));
  const serverPath = join(rootPath, 'serialized-server.cjs');
  const statePath = join(rootPath, 'state.json');
  const jsonRpcEntry = createRequire(import.meta.url).resolve('vscode-jsonrpc/node');
  await writeFile(serverPath, [
    'const fs = require(\'node:fs\');',
    'const path = require(\'node:path\');',
    'const { pathToFileURL } = require(\'node:url\');',
    `const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = require(${JSON.stringify(jsonRpcEntry)});`,
    'const statePath = process.argv[2];',
    'const rootPath = process.argv[3];',
    'let active = 0;',
    'let maxActive = 0;',
    'const save = () => fs.writeFileSync(statePath, JSON.stringify({ active, maxActive }));',
    'const connection = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));',
    'connection.onRequest(\'initialize\', () => ({ capabilities: {} }));',
    'connection.onRequest(\'textDocument/definition\', async () => {',
    '  active += 1; maxActive = Math.max(maxActive, active); save();',
    '  await new Promise((resolve) => setTimeout(resolve, 40));',
    '  active -= 1; save();',
    '  return [{ uri: pathToFileURL(path.join(rootPath, \'main.ts\')).toString(), range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }];',
    '});',
    'connection.onRequest(\'shutdown\', () => null);',
    'connection.onNotification(\'exit\', () => process.exit(0));',
    'connection.listen();',
    '',
  ].join('\n'), 'utf8');
  const snapshotIdentity = '8'.repeat(64);
  const provider = makeLspSemanticAnalysisPort({
    command: process.execPath,
    args: [serverPath, statePath, rootPath],
    serverName: 'serialized-test-server',
    rootPath,
    files: { 'main.ts': 'const value = 1;\n' },
    snapshotIdentity,
    timeoutMs: 2_000,
  });
  try {
    const results = await Promise.all([
      Effect.runPromise(provider.definition({ repoPath: 'main.ts', line: 1, column: 7, snapshotIdentity })),
      Effect.runPromise(provider.definition({ repoPath: 'main.ts', line: 1, column: 7, snapshotIdentity })),
    ]);
    assert.equal(results[0]?._tag, 'Ok');
    assert.equal(results[1]?._tag, 'Ok');
    const state = JSON.parse(await readFile(statePath, 'utf8')) as { readonly maxActive?: unknown };
    assert.equal(state.maxActive, 1);
  } finally {
    await provider.close();
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
  await provider.close();
});

test('actual ast-grep declarations resolve through real LSP without injected name anchors', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'ace-cst-lsp-'));
  const snapshotIdentity = 'f'.repeat(64);
  const source = [
    'const emoji = "🧠";',
    'export function привет(name: string): string { return name; }',
    'class Service { save(): void {} }',
    '',
  ].join('\n');
  const bytes = Buffer.from(source, 'utf8');
  const structural = makeAstGrepStructuralPort({ command: join(process.cwd(), 'node_modules/.bin/ast-grep') });
  const outlined = await Effect.runPromise(structural.extract({ repoPath: 'main.ts', source: bytes }));
  assert.equal(outlined._tag, 'Ok');
  if (outlined._tag === 'Err') return;
  const lsp = makeLspSemanticAnalysisPort({
    command, rootPath, files: { 'main.ts': source }, snapshotIdentity, timeoutMs: 20_000,
  });
  try {
    for (const name of ['привет', 'Service', 'save']) {
      const candidate = outlined.value.symbols.find((item) => item.name === name);
      assert.ok(candidate, 'missing declaration: ' + name);
      assert.ok(candidate?.nameStartLine !== undefined && candidate?.nameStartColumn !== undefined
        && candidate?.nameEndColumn !== undefined, 'missing semantic anchor: ' + name);
      if (candidate?.nameStartLine === undefined || candidate.nameStartColumn === undefined
        || candidate.nameEndColumn === undefined) continue;
      const column = utf16ColumnAtUtf8Byte(bytes, candidate.nameStartLine, candidate.nameStartColumn);
      const endColumn = utf16ColumnAtUtf8Byte(bytes, candidate.nameStartLine, candidate.nameEndColumn);
      assert.ok(column !== undefined && endColumn !== undefined, 'UTF-8/UTF-16 conversion: ' + name);
      if (column === undefined || endColumn === undefined) continue;
      const definition = await Effect.runPromise(lsp.definition({
        repoPath: 'main.ts', line: candidate.nameStartLine, column, snapshotIdentity,
      }));
      assert.equal(definition._tag, 'Ok', 'definition query for ' + name);
      if (definition._tag === 'Err') continue;
      assert.ok(definition.value.some((item) =>
        item.location.repoPath === 'main.ts'
        && item.location.startLine === candidate.nameStartLine
        && item.location.startColumn === column
        && item.location.endLine === candidate.nameStartLine
        && item.location.endColumn === endColumn), 'LSP disagrees with structural declaration: ' + name);
    }
  } finally {
    await lsp.close();
  }
});


test('failed LSP initialization allows bounded graceful provider termination', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'ace-lsp-init-failure-'));
  const marker = join(rootPath, 'terminated.txt');
  const script = [
    'const fs = require(\'node:fs\');',
    'const marker = process.argv[1];',
    'process.on(\'SIGTERM\', () => { setTimeout(() => { fs.writeFileSync(marker, \'terminated\'); process.exit(0); }, 400); });',
    'setInterval(() => {}, 1000);',
  ].join(' ');
  const provider = makeLspSemanticAnalysisPort({
    command: process.execPath,
    args: ['-e', script, marker],
    rootPath,
    files: { 'main.ts': 'const value = 1;\n' },
    snapshotIdentity: '9'.repeat(64),
    timeoutMs: 1_000,
  });
  const startedAt = Date.now();
  try {
    const result = await Effect.runPromise(provider.definition({
      repoPath: 'main.ts',
      line: 1,
      column: 7,
      snapshotIdentity: '9'.repeat(64),
    }));
    assert.equal(result._tag, 'Err');
    if (result._tag === 'Err') assert.equal(result.error.code, 'UNSUPPORTED_PROVIDER');
    assert.ok(Date.now() - startedAt < 3_000, 'initialization cleanup must remain bounded');
    assert.equal(await readFile(marker, 'utf8'), 'terminated');
  } finally {
    await provider.close();
  }
});


test('LSP identity version probe allows bounded graceful provider termination', {
  skip: process.platform === 'win32',
}, async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'ace-lsp-version-hang-'));
  const marker = join(rootPath, 'terminated.txt');
  const commandPath = join(rootPath, 'hung-lsp');
  await writeFile(commandPath, [
    '#!/usr/bin/env node',
    'const fs = require(\'node:fs\');',
    `const marker = ${JSON.stringify(marker)};`,
    'process.on(\'SIGTERM\', () => { setTimeout(() => { fs.writeFileSync(marker, \'terminated\'); process.exit(0); }, 400); });',
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n'), 'utf8');
  await chmod(commandPath, 0o755);

  const startedAt = Date.now();
  const result = await Effect.runPromise(resolveLspProviderIdentity({
    command: commandPath,
    snapshotIdentity: '8'.repeat(64),
    timeoutMs: 1_000,
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'UNSUPPORTED_PROVIDER');
  assert.ok(Date.now() - startedAt < 3_000, 'identity probe must not inherit an unbounded child lifetime');
  assert.equal(await readFile(marker, 'utf8'), 'terminated');
});
