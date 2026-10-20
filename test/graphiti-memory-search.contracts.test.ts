import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeFileDecisionHistory } from '../src/adapters/file-decision-history.js';
import { decisionStatesForEpisode, makeDecisionRecord, transitionDecision, type DecisionRecord } from '../src/domain/memory.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import {
  graphitiEpisodePageContains,
  graphitiEpisodeUuid,
  graphitiTemporalSearchArguments,
  parseGraphitiFactSearchReply,
} from '../src/adapters/graphiti-mcp.js';

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

test('Graphiti fact parser rejects an MCP error even when structured content looks like an empty success', () => {
  const result = parseGraphitiFactSearchReply({
    isError: true,
    structuredContent: { facts: [] },
  });
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'EXTERNAL_UNAVAILABLE');
});

test('Graphiti as-of searches use provider temporal bounds while retaining local exact verification', () => {
  const argumentsForAsOf = mustOk(graphitiTemporalSearchArguments(Date.parse('2026-10-20T12:34:56.789Z')));
  assert.deepEqual(argumentsForAsOf, {
    valid_at_before: '2026-10-20T12:34:56.789Z',
    invalid_at_after: '2026-10-20T12:34:56.789Z',
  });
  assert.deepEqual(mustOk(graphitiTemporalSearchArguments(undefined)), {});
  const invalid = graphitiTemporalSearchArguments(Number.NaN);
  assert.equal(invalid._tag, 'Err');
  if (invalid._tag === 'Err') assert.equal(invalid.error.code, 'INVALID_INPUT');
});

test('Graphiti full episode pages do not become false absence proofs without a cursor', () => {
  assert.deepEqual(
    mustOk(graphitiEpisodePageContains('episode-1', ['episode-2'], 2)),
    false,
  );
  const fullPage = graphitiEpisodePageContains('episode-1', ['episode-2', 'episode-3'], 2);
  assert.equal(fullPage._tag, 'Err');
  if (fullPage._tag === 'Err') assert.equal(fullPage.error.code, 'NOT_READY');
  assert.equal(mustOk(graphitiEpisodePageContains('episode-1', ['episode-1', 'episode-2'], 2)), true);
});

test('ACE episode IDs map deterministically into Graphiti UUIDs without exposing source content', () => {
  const first = graphitiEpisodeUuid('episode-1');
  const second = graphitiEpisodeUuid('episode-1');
  const other = graphitiEpisodeUuid('episode-2');
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/u);
});

test('local decision history preserves valid-time views for Graphiti hit enrichment', async () => {
  const workspace = makeWorkspaceId('graphiti-decision-workspace');
  const foreignWorkspace = makeWorkspaceId('graphiti-foreign-workspace');
  if (workspace._tag === 'Err' || foreignWorkspace._tag === 'Err') throw new Error('workspace fixture failed');
  const proposed = makeDecisionRecord({
    decisionId: 'decision-local' as never,
    workspaceId: workspace.value,
    subject: 'memory',
    proposal: 'keep Graphiti local',
    validFromMs: 100,
    sourceEpisodeIds: ['episode-decision' as never],
  });
  if (proposed._tag === 'Err') throw new Error(proposed.error.message);
  const accepted = transitionDecision(proposed.value, {
    type: 'confirm',
    atMs: 200,
    approvalIdentity: 'owner:test',
    sourceEpisodeIds: ['episode-decision' as never],
  });
  if (accepted._tag === 'Err') throw new Error(accepted.error.message);
  const foreign: DecisionRecord = {
    ...accepted.value,
    decisionId: 'decision-foreign' as never,
    workspaceId: foreignWorkspace.value,
  };
  const root = await mkdtemp(join(tmpdir(), 'ace-graphiti-decisions-'));
  const path = join(root, 'decisions.json');
  await writeFile(path, JSON.stringify([accepted.value, foreign]), 'utf8');
  const history = makeFileDecisionHistory(path);
  const loaded = await Effect.runPromise(history.list(workspace.value));
  assert.equal(loaded._tag, 'Ok');
  if (loaded._tag === 'Err') throw new Error(loaded.error.message);
  assert.equal(loaded.value.length, 1);
  assert.equal(decisionStatesForEpisode(
    'episode-decision' as never,
    workspace.value,
    150,
    loaded.value,
  )[0]?.state, 'Proposed');
  assert.equal(decisionStatesForEpisode(
    'episode-decision' as never,
    workspace.value,
    250,
    loaded.value,
  )[0]?.state, 'Accepted');
});

test('local decision history rejects an invalid successor graph instead of exposing fabricated history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-graphiti-invalid-decisions-'));
  const path = join(root, 'decisions.json');
  await writeFile(path, JSON.stringify([{
    decisionId: 'cycle-a',
    workspaceId: 'workspace',
    subject: 'subject',
    proposal: 'a',
    state: 'Superseded',
    validFromMs: 1,
    sourceEpisodeIds: ['episode'],
    successorId: 'cycle-a',
    transitions: [{
      type: 'supersede',
      atMs: 2,
      successorId: 'cycle-a',
      approvalIdentity: 'owner:test',
      sourceEpisodeIds: ['episode'],
    }],
  }]), 'utf8');
  const result = await Effect.runPromise(makeFileDecisionHistory(path).list('workspace' as never));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_MEMORY');
});
