import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

type AiderFixture = {
  readonly sourceDigest: string;
  readonly symbols: readonly {
    readonly id: string;
    readonly repoPath: string;
    readonly name: string;
    readonly kind: string;
    readonly line: number;
    readonly text: string;
  }[];
  readonly references: readonly {
    readonly source: string;
    readonly target: string;
    readonly weight?: number;
  }[];
  readonly cases: readonly {
    readonly name: string;
    readonly query: string;
    readonly openFiles: readonly string[];
    readonly mentionedFiles: readonly string[];
    readonly mentionedIdentifiers?: readonly string[];
    readonly expectedOrder?: readonly string[];
    readonly expectedTop?: string;
    readonly expectedRenderedContains?: string;
    readonly boostedIdentifier?: string;
  }[];
};

const aiderFixture = JSON.parse(readFileSync(
  join(process.cwd(), 'test/fixtures/repo-map/aider-behavior.json'),
  'utf8',
)) as AiderFixture;

const aiderGraph = () => {
  const symbols = aiderFixture.symbols.map((fixtureSymbol) => makeRepoMapSymbol({
    repoPath: path(fixtureSymbol.repoPath),
    name: fixtureSymbol.name,
    kind: fixtureSymbol.kind,
    sourceDigest: aiderFixture.sourceDigest as never,
    range: range(fixtureSymbol.line),
    text: fixtureSymbol.text,
    references: [],
  }));
  const byFixtureId = new Map(aiderFixture.symbols.map((fixtureSymbol, index) => [fixtureSymbol.id, symbols[index]!]));
  const referencesBySource = new Map<string, RepoMapReference[]>();
  for (const reference of aiderFixture.references) {
    const target = byFixtureId.get(reference.target);
    if (target === undefined) throw new Error(`fixture target missing: ${reference.target}`);
    referencesBySource.set(reference.source, [
      ...(referencesBySource.get(reference.source) ?? []),
      {
        targetId: target.id,
        kind: 'reference',
        ...(reference.weight === undefined ? {} : { weight: reference.weight }),
      },
    ]);
  }
  const upserted = symbols.map((symbol, index) => ({
    ...symbol,
    references: referencesBySource.get(aiderFixture.symbols[index]!.id) ?? [],
  }));
  return applyRepoMapDelta(emptyRepoMapGraph(), { upserted, removed: [] });
};

const aiderInput = (fixtureCase: AiderFixture['cases'][number]) => ({
  query: fixtureCase.query,
  openFiles: fixtureCase.openFiles.map(path),
  mentionedFiles: fixtureCase.mentionedFiles.map(path),
  ...(fixtureCase.mentionedIdentifiers === undefined ? {} : { mentionedIdentifiers: fixtureCase.mentionedIdentifiers }),
  tokenBudget: 128,
});

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

test('RepoMap preserves Aider additive path personalization for an open file', () => {
  const alpha = symbol('alpha', 1);
  const beta = symbol('beta', 2);
  const graph = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [alpha, beta], removed: [] });
  const ranked = rankRepoMap(graph, {
    query: 'alpha',
    openFiles: [alpha.repoPath],
    mentionedFiles: [beta.repoPath],
    tokenBudget: 20,
  });
  const alphaScore = ranked.find((item) => item.symbol.id === alpha.id)?.score ?? 0;
  const betaScore = ranked.find((item) => item.symbol.id === beta.id)?.score ?? 0;
  assert.ok(alphaScore > betaScore, 'path mention adds a second personalization share to an open file');
});

test('RepoMap does not invent Aider path personalization from a file extension', () => {
  const alpha = symbol('alpha', 1);
  const beta = makeRepoMapSymbol({
    ...symbol('beta', 2),
    repoPath: path('src/beta.js'),
  });
  const graph = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [alpha, beta], removed: [] });
  const ranked = rankRepoMap(graph, { query: 'ts', openFiles: [], mentionedFiles: [], tokenBudget: 20 });
  const alphaScore = ranked.find((item) => item.symbol.id === alpha.id)?.score ?? 0;
  const betaScore = ranked.find((item) => item.symbol.id === beta.id)?.score ?? 0;
  assert.ok(Math.abs(alphaScore - betaScore) < 1e-10, 'Aider matches path parts and basenames, not split extensions');
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

test('RepoMap delta rebinds unchanged callers when a definition digest changes', () => {
  const oldTarget = symbol('target', 1);
  const caller = symbol('caller', 2, [{ targetId: oldTarget.id, kind: 'reference', weight: 3 }]);
  const initial = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [oldTarget, caller], removed: [] });
  const newTarget = makeRepoMapSymbol({
    ...oldTarget,
    sourceDigest: 'b'.repeat(64) as never,
    references: [],
  });
  const replaced = applyRepoMapDelta(initial, { upserted: [newTarget], removed: [oldTarget.id] });
  assert.deepEqual(replaced.symbols.get(caller.id)?.references, [{
    targetId: newTarget.id,
    kind: 'reference',
    weight: 3,
  }]);

  const deleted = applyRepoMapDelta(initial, { upserted: [], removed: [oldTarget.id] });
  assert.deepEqual(deleted.symbols.get(caller.id)?.references, []);
});


test('RepoMap redistributes dangling file rank before Aider definition projection', () => {
  const a = symbol('a', 1);
  const b = symbol('b', 2, [{ targetId: a.id, kind: 'reference' }]);
  const graph = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [a, b], removed: [] });
  const ranked = rankRepoMap(graph, { query: '', openFiles: [], mentionedFiles: [], tokenBudget: 20 });
  const mass = ranked.reduce((sum, item) => sum + item.score, 0);
  assert.ok(mass > 0 && mass < 1,
    'Aider projects only rank carried by outgoing definition edges; dangling file rank is not fabricated as a definition edge');
  assert.equal(ranked[0]?.symbol.id, a.id);
});

test('RepoMap adds Aider fallback self-edges by unreferenced identifier, not symbol out-degree', () => {
  const target = symbol('target', 1);
  const caller = symbol('caller', 2, [{ targetId: target.id, kind: 'reference' }]);
  const graph = applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [target, caller], removed: [] });
  const ranked = rankRepoMap(graph, { query: '', openFiles: [], mentionedFiles: [], tokenBudget: 20 });
  const callerScore = ranked.find((item) => item.symbol.id === caller.id)?.score ?? 0;
  const targetScore = ranked.find((item) => item.symbol.id === target.id)?.score ?? 0;
  assert.ok(callerScore > 0, 'the unreferenced caller identifier keeps Aider\'s 0.1 self-edge');
  assert.ok(targetScore < 0.5, 'a referenced target identifier must not receive a synthetic self-edge');
});

test('RepoMap uses Aider defines-as-references fallback when the whole graph has no references', () => {
  const important = makeRepoMapSymbol({
    ...symbol('veryLongIdentifier', 1),
    repoPath: path('src/shared.ts'),
  });
  const ordinary = makeRepoMapSymbol({
    ...symbol('small', 2),
    repoPath: path('src/shared.ts'),
  });
  const ranked = rankRepoMap(
    applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [ordinary, important], removed: [] }),
    { query: '', openFiles: [], mentionedFiles: [], tokenBudget: 20 },
  );
  assert.equal(ranked[0]?.symbol.id, important.id);
  assert.ok((ranked[0]?.score ?? 0) > (ranked[1]?.score ?? 0));
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
  const ranked = rankRepoMap(graph, {
    query: 'target',
    openFiles: [],
    mentionedFiles: [],
    tokenBudget: 128,
  });
  assert.ok(ranked.every((item) => Number.isFinite(item.score)));
  const projectedMass = ranked.reduce((sum, item) => sum + item.score, 0);
  assert.ok(projectedMass >= 0 && projectedMass <= 1 + 1e-8,
    'Aider does not fabricate rank for unreferenced personalized dangling files');
});

test('RepoMap preserves the pinned Aider behavioral fixture for weighting and personalization', () => {
  const graph = aiderGraph();
  const baseline = rankRepoMap(graph, aiderInput(aiderFixture.cases[0]!));
  assert.deepEqual(baseline.map((item) => item.symbol.name), aiderFixture.cases[0]!.expectedOrder);
  const rendered = renderRepoMapFor(graph, aiderInput(aiderFixture.cases[0]!));
  assert.match(rendered.rendered, new RegExp(aiderFixture.cases[0]!.expectedRenderedContains!, 'u'));

  const chatPersonalized = rankRepoMap(graph, aiderInput(aiderFixture.cases[1]!));
  assert.equal(chatPersonalized[0]?.symbol.name, aiderFixture.cases[1]!.expectedTop);

  const explicitMention = rankRepoMap(graph, aiderInput(aiderFixture.cases[2]!));
  const baselineSmall = baseline.find((item) => item.symbol.name === aiderFixture.cases[2]!.boostedIdentifier)?.score ?? 0;
  const explicitSmall = explicitMention.find((item) => item.symbol.name === aiderFixture.cases[2]!.boostedIdentifier)?.score ?? 0;
  assert.ok(explicitSmall > baselineSmall, 'explicit identifier mentions must increase the target definition score');
});

test('RepoMap distributes an identifier relation across same-name definitions in different files', () => {
  const first = makeRepoMapSymbol({
    repoPath: path('src/first.ts'),
    name: 'sharedName',
    kind: 'function',
    sourceDigest: digest,
    range: range(1),
    text: 'function sharedName() {}',
    references: [],
  });
  const second = makeRepoMapSymbol({
    repoPath: path('src/second.ts'),
    name: 'sharedName',
    kind: 'function',
    sourceDigest: digest,
    range: range(1),
    text: 'function sharedName() {}',
    references: [],
  });
  const caller = makeRepoMapSymbol({
    repoPath: path('src/caller.ts'),
    name: 'caller',
    kind: 'function',
    sourceDigest: digest,
    range: range(1),
    text: 'function caller() { sharedName(); }',
    references: [{ targetId: first.id, kind: 'reference' }],
  });
  const ranked = rankRepoMap(
    applyRepoMapDelta(emptyRepoMapGraph(), { upserted: [first, second, caller], removed: [] }),
    { query: '', openFiles: [], mentionedFiles: [], tokenBudget: 128 },
  );
  const firstScore = ranked.find((item) => item.symbol.id === first.id)?.score ?? 0;
  const secondScore = ranked.find((item) => item.symbol.id === second.id)?.score ?? 0;
  assert.ok(firstScore > 0);
  assert.equal(firstScore, secondScore);
});

test('RepoMap graph ranking agrees numerically with pinned Aider plus networkx oracle', () => {
  const oracle = JSON.parse(readFileSync(
    join(process.cwd(), 'test/fixtures/repo-map/aider-networkx-oracle.json'),
    'utf8',
  )) as { readonly cases: readonly {
    readonly name: string;
    readonly expected: readonly (readonly [string, string, number])[];
  }[] };
  const graph = aiderGraph();
  for (const fixture of oracle.cases) {
    const original = aiderFixture.cases.find((item) => item.name === fixture.name);
    assert.ok(original, 'oracle case must use the same frozen def/ref inputs');
    const ranked = rankRepoMap(graph, aiderInput(original));
    for (const [repoPath, name, expected] of fixture.expected) {
      const actual = ranked.find((item) => item.symbol.repoPath === repoPath && item.symbol.name === name);
      assert.ok(actual, `missing oracle tag ${repoPath}/${name}`);
      // NetworkX's default convergence tolerance (1e-6 * N) differs from the
      // current numeric solver; compare scores with a bounded numeric epsilon.
      assert.ok(Math.abs(actual.score - expected) < 1e-4,
        `${fixture.name} ${repoPath}/${name}: got ${actual.score}, upstream ${expected}`);
    }
    // Compare only tags with meaningful scores; Aider's chat-file skip does
    // not remove their graph nodes, while ACE's public rank includes them.
    assert.deepEqual(
      ranked.filter((item) => item.score > 1e-4).map((item) => item.symbol.name),
      [...fixture.expected].filter((row) => row[2] > 1e-4).map((row) => row[1]),
    );
  }
});
