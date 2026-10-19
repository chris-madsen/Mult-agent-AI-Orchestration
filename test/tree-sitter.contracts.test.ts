import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeTreeSitterStructuralPort } from '../src/adapters/tree-sitter-structural.js';

test('Tree-sitter structural adapter returns typed symbols with source provenance', async () => {
  const port = makeTreeSitterStructuralPort({
    pythonCommand: join(process.cwd(), '.venv-system/bin/python'),
    helperPath: join(process.cwd(), 'scripts/tree-sitter-structural.py'),
  });
  const result = await Effect.runPromise(port.extract({
    repoPath: 'fixture.ts',
    source: Buffer.from('interface User { id: string }\nfunction greet(user: User): string { return user.id; }\nclass Service { save(): void {} }\n'),
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.deepEqual(result.value.symbols.map((symbol) => symbol.name), ['User', 'greet', 'Service', 'save']);
  assert.equal(result.value.sourceDigest.length, 64);
  assert.equal(result.value.hasSyntaxErrors, false);
});

test('Tree-sitter provider failure is explicit rather than fabricated evidence', async () => {
  const port = makeTreeSitterStructuralPort({ helperPath: '/does/not/exist', timeoutMs: 500 });
  const result = await Effect.runPromise(port.extract({ repoPath: 'fixture.ts', source: Buffer.from('function x() {}') }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'UNSUPPORTED_PROVIDER');
});


test('Tree-sitter adapter rejects invalid UTF-8 before provider execution', async () => {
  const port = makeTreeSitterStructuralPort({ helperPath: '/does/not/matter' });
  const result = await Effect.runPromise(port.extract({
    repoPath: 'invalid.ts',
    source: Uint8Array.from([0x66, 0x6f, 0x80, 0x6f]),
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') {
    assert.equal(result.error.code, 'INVALID_INPUT');
    assert.equal(result.error.path, 'source');
  }
});
