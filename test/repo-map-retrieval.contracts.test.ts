import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRepoMapPrior } from '../src/adapters/qdrant-context-provider.js';
import type { RankedCandidate } from '../src/domain/retrieval.js';
import { makeRepoMapSymbol } from '../src/domain/repo-map.js';

const ranked = (name: string, line: number, score: number): RankedCandidate => ({
  candidate: {
    candidateId: `${name}-candidate` as never,
    workspaceId: 'workspace' as never,
    repoPath: 'src/example.ts' as never,
    range: { startLine: line, startColumn: 1, endLine: line, endColumn: name.length + 1 },
    symbolName: name,
    structuralKind: 'function',
    text: `function ${name}() {}`,
    sourceDigest: 'a'.repeat(64) as never,
    generation: 1 as never,
    indexedAtMs: 1,
    invalidated: false,
  },
  score,
  freshness: 'current',
});

test('RepoMap prior reorders canonical source ranges without replacing Qdrant scores', () => {
  const first = ranked('first', 1, 0.7);
  const second = ranked('second', 2, 0.69);
  const result = applyRepoMapPrior(
    [first, second],
    {
      ranked: [{
        symbol: makeRepoMapSymbol({
          repoPath: 'src/example.ts' as never,
          name: 'second',
          kind: 'function',
          sourceDigest: 'a'.repeat(64) as never,
          range: second.candidate.range,
          text: second.candidate.text,
          references: [],
        }),
        score: 1,
      }],
      rendered: 'src/example.ts:2 function second',
      estimatedTokens: 8,
      truncated: false,
    },
    2,
  );
  assert.equal(result[0]?.candidate.symbolName, 'second');
  assert.equal(result[0]?.score, 0.74);
  assert.equal(result[1]?.candidate.symbolName, 'first');
});


test('RepoMap never boosts a candidate using a different source digest at the same path and range', () => {
  const current = ranked('current', 1, 0.4);
  const staleSymbol = makeRepoMapSymbol({
    repoPath: current.candidate.repoPath,
    name: 'current',
    kind: 'function',
    sourceDigest: 'b'.repeat(64) as never,
    range: current.candidate.range,
    text: current.candidate.text,
    references: [],
  });
  const result = applyRepoMapPrior(
    [current],
    {
      ranked: [{ symbol: staleSymbol, score: 1 }],
      rendered: '',
      estimatedTokens: 0,
      truncated: false,
    },
    1,
  );
  assert.equal(result[0]?.score, 0.4);
});
