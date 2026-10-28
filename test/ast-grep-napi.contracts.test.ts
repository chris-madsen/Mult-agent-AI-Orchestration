import assert from 'node:assert/strict';
import { Effect } from 'effect';
import test from 'node:test';
import { makeAstGrepNapiStructuralPort, supportsAstGrepNapiPath } from '../src/adapters/ast-grep-napi.js';
import { makeAstGrepStructuralPort, resolveAstGrepProviderIdentity } from '../src/adapters/ast-grep-structural.js';

const source = Buffer.from('export function save(value: string) { return value; }\nconst retry = (attempt: number) => attempt + 1;\n');

test('NAPI extracts named declarations without mistaking an arrow parameter for its symbol name', async () => {
  const result = await Effect.runPromise(makeAstGrepNapiStructuralPort().extract({ repoPath: 'main.ts', source }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.symbols.find((item) => item.name === 'save')?.kind, 'function');
  assert.equal(result.value.symbols.find((item) => item.name === 'retry')?.kind, 'function');
  assert.equal(result.value.symbols.some((item) => item.name === 'attempt' && item.kind === 'function'), false);
});

test('NAPI collects byte-bound identifier occurrences in the same parse as declarations', async () => {
  const result = await Effect.runPromise(makeAstGrepNapiStructuralPort().extract({ repoPath: 'main.ts', source }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  const identifiers = result.value.identifiers;
  assert.ok(identifiers);
  assert.ok(identifiers.some((item) => item.name === 'save'));
  assert.ok(identifiers.filter((item) => item.name === 'value').length >= 2);
  for (const identifier of identifiers) {
    assert.equal(
      source.subarray(identifier.startByteOffset, identifier.endByteOffset).toString('utf8'),
      identifier.name,
    );
  }
});

test('explicit NAPI identity remains experimental while auto mode uses the CLI outline provider', async () => {
  const identity = await Effect.runPromise(resolveAstGrepProviderIdentity({
    command: '/definitely/missing/ast-grep',
    provider: 'napi',
    providerVersion: 'ast-grep/napi@0.51.0',
  }));
  assert.equal(identity._tag, 'Ok');
  if (identity._tag === 'Ok') assert.equal(identity.value.command, '@ast-grep/napi');

  const auto = makeAstGrepStructuralPort({
    command: 'node_modules/.bin/ast-grep',
    provider: 'auto',
    providerVersion: 'ast-grep/napi@0.51.0',
  });
  assert.equal((await Effect.runPromise(auto.extract({ repoPath: 'main.ts', source })))._tag, 'Ok');
});


test('NAPI support means extraction parity, not merely a bundled grammar', async () => {
  assert.equal(supportsAstGrepNapiPath('main.ts'), true);
  assert.equal(supportsAstGrepNapiPath('component.tsx'), true);
  assert.equal(supportsAstGrepNapiPath('styles.css'), false);
  assert.equal(supportsAstGrepNapiPath('page.html'), false);
});

test('NAPI semantic name ranges use UTF-8 byte columns', async () => {
  const unicode = Buffer.from('export function café(π: string) { return π; }\n', 'utf8');
  const result = await Effect.runPromise(makeAstGrepNapiStructuralPort().extract({
    repoPath: 'unicode.ts',
    source: unicode,
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  const symbol = result.value.symbols.find((item) => item.name === 'café');
  assert.ok(symbol);
  assert.equal(
    (symbol?.nameEndColumn ?? 0) - (symbol?.nameStartColumn ?? 0),
    Buffer.byteLength('café', 'utf8'),
  );
});

test('NAPI import records use the CLI module identity and preserve import state', async () => {
  const result = await Effect.runPromise(makeAstGrepNapiStructuralPort().extract({
    repoPath: 'imports.ts',
    source: Buffer.from("import { save } from './service.js';\n", 'utf8'),
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.deepEqual(result.value.symbols, [{
    name: "'./service.js'",
    kind: 'module',
    providerKind: 'import_statement',
    language: 'typescript',
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 37,
    startByteOffset: 0,
    endByteOffset: 36,
    isImport: true,
  }]);
});

test('NAPI matches CLI field scope for interfaces without inventing type-alias object fields', async () => {
  const result = await Effect.runPromise(makeAstGrepNapiStructuralPort().extract({
    repoPath: 'fields.ts',
    source: Buffer.from('interface Config { path: string; }\ntype Box = { value: string };\n', 'utf8'),
  }));
  if (result._tag === 'Ok') {
    assert.equal(result.value.symbols.some((item) => item.name === 'path' && item.kind === 'field'), true);
    assert.equal(result.value.symbols.some((item) => item.name === 'value' && item.kind === 'field'), false);
  }
});
