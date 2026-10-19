import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Effect } from 'effect';
import { makeTreeSitterStructuralPort, resolveTreeSitterProviderIdentity } from '../src/adapters/tree-sitter-structural.js';

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
  const greet = result.value.symbols.find((symbol) => symbol.name === 'greet');
  assert.deepEqual(
    greet === undefined ? undefined : { line: greet.nameStartLine, column: greet.nameStartColumn },
    { line: 2, column: 10 },
  );
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


test('Tree-sitter runtime identity binds package versions and exact helper bytes', async () => {
  const pythonCommand = join(process.cwd(), '.venv-system/bin/python');
  const originalHelper = join(process.cwd(), 'scripts/tree-sitter-structural.py');
  const first = await Effect.runPromise(resolveTreeSitterProviderIdentity({
    pythonCommand,
    helperPath: originalHelper,
  }));
  assert.equal(first._tag, 'Ok');
  if (first._tag === 'Err') return;
  assert.match(first.value.fingerprint, /^[a-f0-9]{64}$/u);
  assert.match(first.value.helperSha256, /^[a-f0-9]{64}$/u);
  assert.equal(first.value.provider, 'tree-sitter');
  assert.equal(first.value.protocolSchema, 2);
  assert.notEqual(first.value.treeSitterVersion, 'missing');
  assert.notEqual(first.value.grammarVersion, 'missing');

  const root = await mkdtemp(join(tmpdir(), 'ace-tree-sitter-identity-'));
  const copiedHelper = join(root, 'tree-sitter-structural.py');
  const bytes = await readFile(originalHelper);
  await writeFile(copiedHelper, Buffer.concat([bytes, Buffer.from('\n# identity digest mutation\n')]));
  const second = await Effect.runPromise(resolveTreeSitterProviderIdentity({
    pythonCommand,
    helperPath: copiedHelper,
  }));
  assert.equal(second._tag, 'Ok');
  if (second._tag === 'Err') return;
  assert.notEqual(second.value.helperSha256, first.value.helperSha256);
  assert.notEqual(second.value.fingerprint, first.value.fingerprint);
  assert.equal(second.value.treeSitterVersion, first.value.treeSitterVersion);
  assert.equal(second.value.grammarVersion, first.value.grammarVersion);
});
