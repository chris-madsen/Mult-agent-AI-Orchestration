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

test('NAPI identity and auto mode do not require the CLI for supported files', async () => {
  const identity = await Effect.runPromise(resolveAstGrepProviderIdentity({
    command: '/definitely/missing/ast-grep',
    provider: 'napi',
    providerVersion: 'ast-grep/napi@0.51.0',
  }));
  assert.equal(identity._tag, 'Ok');
  if (identity._tag === 'Ok') assert.equal(identity.value.command, '@ast-grep/napi');

  const auto = makeAstGrepStructuralPort({
    command: '/definitely/missing/ast-grep',
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
