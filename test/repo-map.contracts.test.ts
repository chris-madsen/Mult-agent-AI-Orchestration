import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRepoMapDelta,
  emptyRepoMapGraph,
  makeRepoMapSymbol,
  renderRepoMapFor,
  rankRepoMap,
} from '../src/domain/repo-map.js';
import type { RepoMapReference } from '../src/domain/repo-map.js';

const digest = 'a'.repeat(64) as never;
const range = (line: number) => ({ startLine: line, endLine: line, startColumn: 1, endColumn: 20 });
const path = (value: string) => value as never;

const symbol = (name: string, line: number, references: readonly RepoMapReference[] = []) => makeRepoMapSymbol({
  repoPath: path(`src/${name}.ts`),
  name,
  kind: 'function',
  sourceDigest: digest,
  range: range(line),
  text: `export function ${name}() {}`,
  isExported: true,
  references,
});

test('RepoMap rank is deterministic and propagates reference importance', () => {
  const leaf = symbol('leaf', 1);
  const root = symbol('root', 2, [{ targetId: leaf.id, kind: 'reference' }]);
  const graph = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [root, leaf], removed: [] });
  const ranked = rankRepoMap(graph, { query: '', openFiles: [], mentionedFiles: [], tokenBudget: 20 });
  assert.deepEqual(ranked.map((item) => item.symbol.name), ['leaf', 'root']);
  assert.deepEqual(ranked.map((item) => item.symbol.id), rankRepoMap(graph, { query: '', openFiles: [], mentionedFiles: [], tokenBudget: 20 }).map((item) => item.symbol.id));
});

test('RepoMap personalization promotes open, mentioned, and queried files', () => {
  const alpha = symbol('alpha', 1);
  const beta = symbol('beta', 2);
  const graph = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [alpha, beta], removed: [] });
  const ranked = rankRepoMap(graph, { query: 'beta', openFiles: [], mentionedFiles: [], tokenBudget: 20 });
  assert.equal(ranked[0]?.symbol.name, 'beta');
});

test('RepoMap rendering stops at the explicit token budget', () => {
  const symbols = Array.from({ length: 10 }, (_, index) => symbol(`symbol${index}`, index + 1));
  const graph = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: symbols, removed: [] });
  const rendered = renderRepoMapFor(graph, { query: '', openFiles: [], mentionedFiles: [], tokenBudget: 3 });
  assert.equal(rendered.truncated, true);
  assert.ok(rendered.estimatedTokens <= 3);
});

test('RepoMap delta removes deleted symbols and replaces changed symbols', () => {
  const oldSymbol = symbol('old', 1);
  const nextSymbol = symbol('next', 2);
  const first = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [oldSymbol], removed: [] });
  const next = applyRepoMapDelta(first, { upserted: [nextSymbol], removed: [oldSymbol.id] });
  assert.equal(next.symbols.has(oldSymbol.id), false);
  assert.equal(next.symbols.has(nextSymbol.id), true);
});
