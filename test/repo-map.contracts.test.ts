import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRepoMapRanking } from '../src/domain/repo-map.js';
import type { RankedCandidate } from '../src/domain/retrieval.js';

const candidate = (id: string, path: string, symbolName: string, text: string, score: number): RankedCandidate => ({
  candidate: {
    candidateId: id as never,
    workspaceId: 'repo-map-workspace' as never,
    repoPath: path as never,
    range: { startLine: 1, endLine: 1 },
    symbolName,
    text,
    sourceDigest: 'a'.repeat(64) as never,
    generation: 1 as never,
    indexedAtMs: 1,
    invalidated: false,
  },
  score,
  freshness: 'current',
});

test('RepoMap ranking prefers exact symbol matches and is deterministic', () => {
  const result = applyRepoMapRanking([
    candidate('b', 'src/other.ts', 'other', 'unrelated body', 10),
    candidate('a', 'src/retry.ts', 'retryBudget', 'retry budget calculation', 10),
  ], 'retryBudget', { maxCandidates: 1, maxTokens: 100 });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.candidate.candidateId, 'a');
  assert.equal(result.droppedCount, 1);
  assert.ok(result.candidates[0]?.warning?.includes('RepoMap'));
});

test('RepoMap token budget drops later symbols without claiming retrieval failure', () => {
  const result = applyRepoMapRanking([
    candidate('a', 'src/a.ts', 'a', '1234567890', 10),
    candidate('b', 'src/b.ts', 'b', '1234567890', 9),
  ], 'a', { maxTokens: 3 });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.droppedCount, 1);
  assert.equal(result.estimatedTokens, 3);
});
