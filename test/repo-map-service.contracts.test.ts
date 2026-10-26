import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeRepoMapService } from '../src/application/repo-map-service.js';
import { makeRepoMapSymbol } from '../src/domain/repo-map.js';

const symbol = makeRepoMapSymbol({
  repoPath: 'src/entry.ts' as never,
  name: 'entry',
  kind: 'function',
  sourceDigest: 'a'.repeat(64) as never,
  range: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 20 },
  text: 'export function entry() {}',
  isExported: true,
  references: [],
});

test('RepoMap service updates and renders through a typed application owner', async () => {
  const service = makeRepoMapService();
  assert.equal((await Effect.runPromise(service.update({ upserted: [symbol], removed: [] })))._tag, 'Ok');
  const rendered = await Effect.runPromise(service.render({ query: 'entry', openFiles: [], mentionedFiles: [], tokenBudget: 20 }));
  assert.equal(rendered._tag, 'Ok');
  if (rendered._tag === 'Ok') {
    assert.match(rendered.value.rendered, /entry/u);
    assert.ok(rendered.value.estimatedTokens <= 20);
  }
});

test('RepoMap service rejects invalid budgets before rendering', async () => {
  const service = makeRepoMapService();
  const result = await Effect.runPromise(service.render({ query: '', openFiles: [], mentionedFiles: [], tokenBudget: 0 }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_INPUT');
});
