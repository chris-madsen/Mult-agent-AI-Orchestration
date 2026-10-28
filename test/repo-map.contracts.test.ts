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


test('RepoMap PageRank conserves probability with dangling symbols', () => {
  const a = symbol('a', 1);
  const b = symbol('b', 2, [{ targetId: a.id, kind: 'reference' }]);
  const graph = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [a, b], removed: [] });
  const ranked = rankRepoMap(graph, { query: '', openFiles: [], mentionedFiles: [], tokenBudget: 20 });
  const mass = ranked.reduce((sum, item) => sum + item.score, 0);
  assert.ok(Math.abs(mass - 1) < 1e-10,
    'dangling vertices must redistribute their rank instead of leaking probability');
  assert.equal(ranked[0]?.symbol.id, a.id);
});

test('unresolved references are ignored while repeated references increase edge weight', () => {
  const target = symbol('target', 1);
  const plain = symbol('caller', 2, [{ targetId: target.id, kind: 'reference' }]);
  const duplicateAndMissing = symbol('caller', 2, [
    { targetId: target.id, kind: 'reference' },
    { targetId: target.id, kind: 'reference' },
    { targetId: 'deleted-reference-id' as never, kind: 'reference' },
  ]);
  const input = { query: '', openFiles: [], mentionedFiles: [], tokenBudget: 20 };
  const baseline = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [target, plain], removed: [] });
  const noisy = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [target, duplicateAndMissing], removed: [] });
  const first = rankRepoMap(baseline, input);
  const second = rankRepoMap(noisy, input);
  assert.equal(second[0]?.symbol.id, target.id);
  assert.ok((second.find((item) => item.symbol.id === target.id)?.score ?? 0)
    >= (first.find((item) => item.symbol.id === target.id)?.score ?? 0));
});

test('RepoMap prioritizes personalized files even when every vertex is dangling', () => {
  const a = symbol('alpha', 1);
  const b = symbol('beta', 2);
  const graph = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [a, b], removed: [] });
  const input = { query: '', openFiles: [b.repoPath], mentionedFiles: [], tokenBudget: 20 };
  const ranked = rankRepoMap(graph, input);
  assert.equal(ranked[0]?.symbol.id, b.id);
  assert.ok(Math.abs(ranked.reduce((sum, item) => sum + item.score, 0) - 1) < 1e-10);
});

test('RepoMap budget packing skips oversized ranked entries and includes shorter ones', () => {
  const longName = 'an-extremely-long-path-that-does-not-fit-any-small-token-budget'.repeat(2);
  const big = makeRepoMapSymbol({
    repoPath: path(`src/${longName}.ts`),
    name: 'long',
    kind: 'function',
    sourceDigest: digest,
    range: range(1),
    text: 'function long() {}',
    references: [],
  });
  const short = makeRepoMapSymbol({
    repoPath: path('s.ts'),
    name: 'ok',
    kind: 'function',
    sourceDigest: digest,
    range: range(1),
    text: 'function ok() {}',
    references: [],
  });
  const graph = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [big, short], removed: [] });
  const result = renderRepoMapFor(graph, {
    query: 'long',
    openFiles: [big.repoPath],
    mentionedFiles: [big.repoPath],
    tokenBudget: 12,
  });
  assert.match(result.rendered, /s\.ts:1 function ok/u);
  assert.doesNotMatch(result.rendered, /an-extremely-long/u);
  assert.equal(result.truncated, true);
  assert.ok(result.estimatedTokens <= 12);
});


test('RepoMap normalizes malformed edge weights instead of poisoning PageRank', () => {
  const target = symbol('target', 1);
  const caller = symbol('caller', 2, [
    { targetId: target.id, kind: 'reference', weight: Number.NaN },
    { targetId: target.id, kind: 'reference', weight: -3 },
  ]);
  const graph = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [target, caller], removed: [] });
  const ranked = rankRepoMap(graph, input);
  assert.ok(ranked.every((item) => Number.isFinite(item.score)));
  assert.ok(Math.abs(ranked.reduce((sum, item) => sum + item.score, 0) - 1) < 1e-8);
});
