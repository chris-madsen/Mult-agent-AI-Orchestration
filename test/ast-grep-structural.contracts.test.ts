import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import {
  makeAstGrepStructuralPort,
  resolveAstGrepProviderIdentity,
} from '../src/adapters/ast-grep-structural.js';
import {
  structuralLanguageForPath,
  supportedStructuralLanguages,
} from '../src/domain/structural-language.js';

const command = join(process.cwd(), 'node_modules/.bin/ast-grep');
const provider = makeAstGrepStructuralPort({ command });

test('ast-grep identity is pinned to the executable version', async () => {
  const identity = await Effect.runPromise(resolveAstGrepProviderIdentity({ command }));
  assert.equal(identity._tag, 'Ok');
  if (identity._tag === 'Err') return;
  assert.equal(identity.value.provider, 'ast-grep');
  assert.equal(identity.value.protocolSchema, 1);
  assert.match(identity.value.version, /^ast-grep\s+0\.51\.0$/u);
  assert.match(identity.value.fingerprint, /^[a-f0-9]{64}$/u);
});

test('ast-grep extracts multilingual structural symbols with exact source byte ranges', async () => {
  const fixtures = [
    { path: 'fixture.ts', source: 'export function привет(): string { return "ok"; }\nclass Service { save(): void {} }\n' },
    { path: 'fixture.py', source: 'def привет(name):\n    return name\n' },
    { path: 'fixture.rs', source: 'fn main() {}\nstruct User { id: u64 }\n' },
    { path: 'fixture.go', source: 'package main\ntype User struct {}\n' },
    { path: 'fixture.java', source: 'class User { void save() {} }\n' },
    { path: 'fixture.cs', source: 'class User { void Save() {} }\n' },
    { path: 'fixture.cpp', source: 'struct User {};\n' },
    { path: 'fixture.kt', source: 'class User\n' },
    { path: 'fixture.swift', source: 'struct User {}\n' },
  ] as const;

  for (const fixture of fixtures) {
    const source = Buffer.from(fixture.source, 'utf8');
    const result = await Effect.runPromise(provider.extract({ repoPath: fixture.path, source }));
    assert.equal(result._tag, 'Ok', fixture.path);
    if (result._tag === 'Err') continue;
    assert.ok(result.value.symbols.length > 0, fixture.path);
    for (const symbol of result.value.symbols) {
      assert.equal(symbol.language !== undefined, true, fixture.path);
      assert.equal(symbol.startByteOffset !== undefined, true, fixture.path);
      assert.equal(symbol.endByteOffset !== undefined, true, fixture.path);
      const exact = source.subarray(symbol.startByteOffset, symbol.endByteOffset).toString('utf8');
      assert.ok(exact.length > 0, `${fixture.path}:${symbol.name}`);
      assert.ok(exact.includes(symbol.name), `${fixture.path}:${symbol.name}`);
    }
  }
});

test('ast-grep preserves an honest empty outline for supported non-code sources', async () => {
  for (const fixture of [
    ['fixture.json', '{"user":{"id":1}}\n'],
    ['fixture.yaml', 'user:\n  id: 1\n'],
    ['fixture.html', '<div class="user">hi</div>\n'],
    ['fixture.css', '.user { color: red; }\n'],
  ] as const) {
    const result = await Effect.runPromise(provider.extract({ repoPath: fixture[0], source: Buffer.from(fixture[1]) }));
    assert.equal(result._tag, 'Ok', fixture[0]);
    if (result._tag === 'Ok') assert.deepEqual(result.value.symbols, [], fixture[0]);
  }
});

test('language registry is explicit and unsupported extensions do not silently route to a parser', async () => {
  assert.ok(supportedStructuralLanguages().length >= 20);
  assert.equal(structuralLanguageForPath('src/main.ts')?.language, 'typescript');
  assert.equal(structuralLanguageForPath('src/main.py')?.language, 'python');
  assert.equal(structuralLanguageForPath('src/main.unknown'), undefined);
  const result = await Effect.runPromise(provider.extract({
    repoPath: 'src/main.unknown',
    source: Buffer.from('not source'),
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'UNSUPPORTED_PROVIDER');
});
