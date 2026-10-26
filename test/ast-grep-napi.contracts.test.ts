import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeAstGrepNapiStructuralPort } from '../src/adapters/ast-grep-napi.js';
import { makeAstGrepStructuralPort, resolveAstGrepProviderIdentity } from '../src/adapters/ast-grep-structural.js';

const source = Buffer.from([
  'export function save(value: string) { return value; }',
  'class Box { method() { return save("x"); } }',
  'import { readFile } from "node:fs";',
  '',
].join('\n'), 'utf8');

test('ast-grep NAPI returns exact byte ranges and nested TypeScript symbols', async () => {
  const provider = makeAstGrepNapiStructuralPort({ providerVersion: 'ast-grep/napi@0.51.0' });
  const result = await Effect.runPromise(provider.extract({ repoPath: 'main.ts', source }));
  assert.equal(result._tag, 'Ok');
  const value = result.value;
  assert.equal(value.sourceDigest.length, 64);
  assert.equal(value.hasSyntaxErrors, false);
  const save = value.symbols.find((symbol) => symbol.kind === 'function' && symbol.name === 'save');
  assert.ok(save);
  assert.equal(save.startByteOffset, Buffer.byteLength('export ', 'utf8'));
  assert.equal(save.endByteOffset, Buffer.byteLength('export function save(value: string) { return value; }', 'utf8'));
  assert.equal(save.isExported, true);
  assert.ok(value.symbols.some((symbol) => symbol.kind === 'class' && symbol.name === 'Box'));
  assert.ok(value.symbols.some((symbol) => symbol.kind === 'method' && symbol.name === 'method'));
  assert.ok(value.symbols.some((symbol) => symbol.kind === 'import'));
});

test('ast-grep provider identity is stable for the NAPI path', async () => {
  const identity = await Effect.runPromise(resolveAstGrepProviderIdentity({
    command: 'unused-for-napi',
    provider: 'napi',
    providerVersion: 'ast-grep/napi@0.51.0',
  }));
  assert.equal(identity._tag, 'Ok');
  assert.equal(identity.value.command, '@ast-grep/napi');
  assert.equal(identity.value.version, 'ast-grep/napi@0.51.0');
  assert.equal(identity.value.fingerprint.length, 64);
});

test('structural factory selects the NAPI provider without spawning ast-grep CLI', async () => {
  const provider = makeAstGrepStructuralPort({
    command: '/path/that/must/not/be_spawned',
    provider: 'napi',
  });
  const result = await Effect.runPromise(provider.extract({ repoPath: 'main.ts', source }));
  assert.equal(result._tag, 'Ok');
});

test('auto structural provider uses NAPI for supported languages and explicit CLI fallback otherwise', async () => {
  const provider = makeAstGrepStructuralPort({
    command: '/path/that/must/not/be_spawned',
    provider: 'auto',
  });
  const typescript = await Effect.runPromise(provider.extract({ repoPath: 'main.ts', source }));
  assert.equal(typescript._tag, 'Ok');
  const unsupported = await Effect.runPromise(provider.extract({
    repoPath: 'main.py',
    source: Buffer.from('def save():\n    return True\n', 'utf8'),
  }));
  assert.equal(unsupported._tag, 'Err');
});
