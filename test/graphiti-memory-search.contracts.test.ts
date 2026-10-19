import assert from 'node:assert/strict';
import test from 'node:test';
import { graphitiEpisodeUuid, parseGraphitiFactSearchReply } from '../src/adapters/graphiti-mcp.js';

const mustOk = <T, E>(result: { readonly _tag: 'Ok'; readonly value: T } | { readonly _tag: 'Err'; readonly error: E }): T => {
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(String(result.error));
  return result.value;
};

test('Graphiti fact search parser preserves episode provenance and temporal bounds', () => {
  const facts = mustOk(parseGraphitiFactSearchReply({
    structuredContent: {
      message: 'Facts retrieved successfully',
      facts: [{
        uuid: 'fact-1',
        fact: 'ACE selected local Qdrant',
        group_id: 'workspace-group',
        episodes: ['11111111-1111-5111-a111-111111111111'],
        valid_at: '2026-10-01T10:00:00Z',
        invalid_at: null,
      }],
    },
  }));
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.fact, 'ACE selected local Qdrant');
  assert.deepEqual(facts[0]?.episodeUuids, ['11111111-1111-5111-a111-111111111111']);
  assert.equal(facts[0]?.validAt, Date.parse('2026-10-01T10:00:00Z'));
});

test('Graphiti fact parser rejects derived facts without original episode provenance', () => {
  const result = parseGraphitiFactSearchReply({
    structuredContent: {
      message: 'Facts retrieved successfully',
      facts: [{ fact: 'orphan fact', group_id: 'workspace-group' }],
    },
  });
  assert.equal(result._tag, 'Err');
});

test('ACE episode IDs map deterministically into Graphiti UUIDs without exposing source content', () => {
  const first = graphitiEpisodeUuid('episode-1');
  const second = graphitiEpisodeUuid('episode-1');
  const other = graphitiEpisodeUuid('episode-2');
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/u);
});
