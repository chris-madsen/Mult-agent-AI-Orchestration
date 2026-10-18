import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTypeScriptLanguageServicePort } from '../src/adapters/typescript-language-service.js';

const queryAt = (source: string, token: string, occurrence = 0) => {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) offset = source.indexOf(token, offset + 1);
  if (offset < 0) throw new Error(`token not found: ${token}`);
  const before = source.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
};

const source = 'export function save(value: string): string { return value; }\nconst result = save(\'ok\');\n';
const port = makeTypeScriptLanguageServicePort({ rootPath: process.cwd(), files: { 'fixture.ts': source } });

test('TypeScript language service resolves definition, references and type information', async () => {
  const definition = await import('effect').then(({ Effect }) => Effect.runPromise(port.definition({ repoPath: 'fixture.ts', ...queryAt(source, 'save', 1) })));
  assert.equal(definition._tag, 'Ok');
  if (definition._tag === 'Err') return;
  assert.equal(definition.value[0]?.location.repoPath, 'fixture.ts');
  assert.equal(definition.value[0]?.location.startLine, 1);

  const references = await import('effect').then(({ Effect }) => Effect.runPromise(port.references({ repoPath: 'fixture.ts', ...queryAt(source, 'save') })));
  assert.equal(references._tag, 'Ok');
  if (references._tag === 'Err') return;
  assert.equal(references.value.length, 2);

  const typeInfo = await import('effect').then(({ Effect }) => Effect.runPromise(port.typeInfo({ repoPath: 'fixture.ts', ...queryAt(source, 'value') })));
  assert.equal(typeInfo._tag, 'Ok');
  if (typeInfo._tag === 'Err') return;
  assert.match(typeInfo.value?.display ?? '', /string/u);
});

test('TypeScript language service returns diagnostics and rejects unknown files', async () => {
  const { Effect } = await import('effect');
  const invalid = makeTypeScriptLanguageServicePort({ rootPath: process.cwd(), files: { 'invalid.ts': 'const value: string = 1;\n' } });
  const diagnostics = await Effect.runPromise(invalid.diagnostics({ repoPath: 'invalid.ts' }));
  assert.equal(diagnostics._tag, 'Ok');
  if (diagnostics._tag === 'Ok') assert.ok(diagnostics.value.some((item) => item.category === 'error'));
  const missing = await Effect.runPromise(invalid.definition({ repoPath: 'missing.ts', line: 1, column: 1 }));
  assert.equal(missing._tag, 'Err');
});
