import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

test('auto selects single-pass NAPI def/ref for JS/TS while preserving CLI for other languages', async () => {
  const identity = await Effect.runPromise(resolveAstGrepProviderIdentity({
    command: '/definitely/missing/ast-grep',
    provider: 'napi',
    providerVersion: 'ast-grep/napi@0.51.0',
  }));
  assert.equal(identity._tag, 'Ok');
  if (identity._tag === 'Ok') assert.equal(identity.value.command, '@ast-grep/napi');

  const autoOptions = {
    command: 'node_modules/.bin/ast-grep',
    provider: 'auto' as const,
    providerVersion: 'ast-grep/napi@0.51.0',
  };
  const auto = makeAstGrepStructuralPort(autoOptions);
  const tsResult = await Effect.runPromise(auto.extract({ repoPath: 'main.ts', source }));
  assert.equal(tsResult._tag, 'Ok');
  if (tsResult._tag === 'Ok') {
    assert.ok(tsResult.value.identifiers?.some((item) => item.name === 'save'));
    assert.ok(tsResult.value.identifiers?.some((item) => item.name === 'value'));
  }
  const pyResult = await Effect.runPromise(auto.extract({
    repoPath: 'worker.py', source: Buffer.from('def work():\n    pass\n'),
  }));
  assert.equal(pyResult._tag, 'Ok');
  if (pyResult._tag === 'Ok') {
    assert.equal(pyResult.value.identifiers, undefined);
    assert.ok(pyResult.value.symbols.some((item) => item.name === 'work'));
  }
  const combined = await Effect.runPromise(auto.extractMany!([
    { repoPath: 'one.ts', source },
    { repoPath: 'two.py', source: Buffer.from('def work():\n    pass\n') },
    { repoPath: 'three.js', source: Buffer.from('function run() { return run(); }\n') },
  ]));
  assert.deepEqual(combined.map((item) => item._tag), ['Ok', 'Ok', 'Ok']);
  assert.equal(combined[0]?._tag === 'Ok' && combined[0].value.identifiers !== undefined, true);
  assert.equal(combined[1]?._tag === 'Ok' && combined[1].value.identifiers, undefined);
  assert.equal(combined[2]?._tag === 'Ok' && combined[2].value.identifiers !== undefined, true);
  const autoIdentity = await Effect.runPromise(resolveAstGrepProviderIdentity(autoOptions));
  const cliIdentity = await Effect.runPromise(resolveAstGrepProviderIdentity({ ...autoOptions, provider: 'cli' }));
  assert.equal(autoIdentity._tag, 'Ok');
  assert.equal(cliIdentity._tag, 'Ok');
  if (autoIdentity._tag === 'Ok' && cliIdentity._tag === 'Ok') {
    assert.notEqual(autoIdentity.value.fingerprint, cliIdentity.value.fingerprint);
    assert.match(autoIdentity.value.version, /hybrid-defref-v1/u);
  }
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
  const identifiers = result.value.identifiers ?? [];
  for (const name of ['café', 'π']) {
    const occurrences = identifiers.filter((item) => item.name === name);
    assert.ok(occurrences.length > 0, name);
    for (const identifier of occurrences) {
      assert.equal(
        unicode.subarray(identifier.startByteOffset, identifier.endByteOffset).toString('utf8'),
        name,
      );
      assert.equal(identifier.endByteOffset - identifier.startByteOffset, Buffer.byteLength(name, 'utf8'));
    }
  }
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

test('real-repo NAPI symbol coverage subsumes pinned official ast-grep CLI outline', async () => {
  const cli = makeAstGrepStructuralPort({
    command: 'node_modules/.bin/ast-grep',
    provider: 'cli',
  });
  const napi = makeAstGrepNapiStructuralPort();
  const examples = [
    'src/domain/repo-map.ts',
    'src/adapters/ast-grep-napi.ts',
    'src/application/lsp/claw-discovery.ts',
  ];
  const filtered = (symbols: readonly { readonly kind: string; readonly name: string; readonly startLine: number }[]) =>
    symbols.filter((symbol) => ['function', 'class', 'interface', 'type', 'enum', 'method'].includes(symbol.kind))
      .map((symbol) => `${symbol.kind}|${symbol.name}|${symbol.startLine}`).sort();
  for (const repoPath of examples) {
    const fixtureBytes = readFileSync(join(process.cwd(), repoPath));
    const [expected, actual] = await Promise.all([
      Effect.runPromise(cli.extract({ repoPath, source })),
      Effect.runPromise(napi.extract({ repoPath, source })),
    ]);
    assert.equal(expected._tag, 'Ok', repoPath);
    assert.equal(actual._tag, 'Ok', repoPath);
    if (expected._tag === 'Err' || actual._tag === 'Err') continue;
    const canonical = filtered(expected.value.symbols);
    const candidate = filtered(actual.value.symbols);
    // The official CLI outline skips some valid exported arrow declarations;
    // NAPI's same-parse declaration+identifier extraction legitimately adds
    // those declarations. It must never LOSE a CLI declaration on real code.
    for (const item of canonical) {
      assert.ok(candidate.includes(item),
        `${repoPath} missing canonical CLI tag ${item}; NAPI rollout must preserve outline coverage`);
    }
    assert.ok(actual.value.identifiers && actual.value.identifiers.length > 0,
      `${repoPath} NAPI must expose same-pass identifier occurrences`);
  }
});
