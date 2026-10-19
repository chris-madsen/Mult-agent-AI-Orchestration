import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Effect } from 'effect';
import { importMemoryEpisodes } from '../src/application/memory-import.js';
import type { AsyncMemoryArchivePort } from '../src/adapters/file-memory-archive.js';
import { admitMemoryEpisode } from '../src/domain/memory-admission.js';
import { evaluateMemoryEconomics } from '../src/domain/memory-economics.js';
import { ok } from '../src/domain/result.js';
import { makeEpisodeId, type EpisodeId, type ProjectionReceipt, type SessionEpisode } from '../src/domain/memory.js';
import type { GraphProjectionPort } from '../src/application/ports.js';
import { makeWorkspaceId, type ContentDigest } from '../src/domain/workspace.js';

const workspaceId = makeWorkspaceId('memory-admission-test');
if (workspaceId._tag === 'Err') throw new Error(workspaceId.error.message);
const digest = (value: string): ContentDigest => createHash('sha256').update(value).digest('hex') as ContentDigest;

const episode = (id: string, text: string, memoryHint?: 'project' | 'archive_only'): SessionEpisode => {
  const episodeId = makeEpisodeId(id);
  if (episodeId._tag === 'Err') throw new Error(episodeId.error.message);
  const content = Buffer.from(text, 'utf8');
  return {
    episodeId: episodeId.value,
    workspaceId: workspaceId.value,
    sessionId: 'session-1',
    sourcePointer: `codex://session-1/${id}`,
    occurredAtMs: 1_700_000_000_000,
    importedAtMs: 1_700_000_000_001,
    contentDigest: digest(text),
    content,
    searchText: text,
    ...(memoryHint === undefined ? {} : { memoryHint }),
    tombstoned: false,
  };
};

const inMemoryArchive = (): { readonly archive: AsyncMemoryArchivePort; readonly episodes: Map<EpisodeId, SessionEpisode> } => {
  const episodes = new Map<EpisodeId, SessionEpisode>();
  const archive: AsyncMemoryArchivePort = {
    importEpisode: async (value) => {
      const existing = episodes.get(value.episodeId);
      if (existing !== undefined) return ok({ created: false, episode: existing });
      episodes.set(value.episodeId, value);
      return ok({ created: true, episode: value });
    },
    readEpisode: async (episodeId) => {
      const value = episodes.get(episodeId);
      return value === undefined
        ? { _tag: 'Err', error: { code: 'FILE_NOT_FOUND', path: 'episode', message: 'not found' } }
        : ok(value);
    },
    deleteEpisode: async (episodeId) => {
      episodes.delete(episodeId);
      return ok(undefined);
    },
  };
  return { archive, episodes };
};

const projectionSession = (calls: { created: number; projected: number }): { projection: GraphProjectionPort; close: () => Promise<void> } => {
  calls.created += 1;
  const projection: GraphProjectionPort = {
    project: (input) => {
      calls.projected += 1;
      const receipt: ProjectionReceipt = {
        key: `${input.episodeId}:${input.extractorVersion}` as never,
        episodeId: input.episodeId,
        extractorVersion: input.extractorVersion,
        status: 'pending',
        attempts: 1,
      };
      return Effect.succeed(ok(receipt));
    },
    purge: () => Effect.succeed(ok(undefined)),
  };
  return { projection, close: async () => undefined };
};

test('MAC-01 ordinary transcript is archive-only and never starts Graphiti', async () => {
  const local = inMemoryArchive();
  const calls = { created: 0, projected: 0 };
  const result = await importMemoryEpisodes({
    episodes: [episode('ordinary', 'Opened the file and inspected the current implementation.')],
    archive: local.archive,
    createProjection: async () => projectionSession(calls),
    extractorVersion: 'test-extractor',
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.deepEqual(result.value[0]?.admission, { kind: 'archive_only', reason: 'ordinary_transcript' });
    assert.equal(result.value[0]?.projectionStatus, undefined);
  }
  assert.equal(local.episodes.size, 1);
  assert.deepEqual(calls, { created: 0, projected: 0 });
});

test('MAC-02 durable decision is projected once while raw episode remains archived', async () => {
  const local = inMemoryArchive();
  const calls = { created: 0, projected: 0 };
  const result = await importMemoryEpisodes({
    episodes: [episode('decision', 'We decided to use the local retrieval index going forward.')],
    archive: local.archive,
    createProjection: async () => projectionSession(calls),
    extractorVersion: 'test-extractor',
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.deepEqual(result.value[0]?.admission, { kind: 'project', reason: 'durable_decision' });
    assert.equal(result.value[0]?.projectionStatus, 'pending');
  }
  assert.equal(local.episodes.size, 1);
  assert.deepEqual(calls, { created: 1, projected: 1 });
});

test('MAC-03 explicit archive-only annotation wins over a decision-like sentence', () => {
  assert.deepEqual(admitMemoryEpisode(episode('annotated', 'We decided to use the local index.', 'archive_only')), {
    kind: 'archive_only',
    reason: 'ordinary_transcript',
  });
});

test('MAC-04 oversized input remains exact archive material and is not projected', () => {
  assert.deepEqual(admitMemoryEpisode({ searchText: 'architecture '.repeat(500) }), { kind: 'archive_only', reason: 'too_large' });
});

test('MAC-05 economics stays unknown until Graphiti reports provider token usage', () => {
  const unknown = evaluateMemoryEconomics({ reuseCount: 10 });
  assert.equal(unknown._tag, 'Ok');
  if (unknown._tag === 'Ok') assert.deepEqual(unknown.value, { status: 'unknown', reuseCount: 10 });

  const notRecovered = evaluateMemoryEconomics({ ingestionInputTokens: 1_000, ingestionOutputTokens: 200, savedAgentTokensPerReuse: 300, reuseCount: 3 });
  assert.equal(notRecovered._tag, 'Ok');
  if (notRecovered._tag === 'Ok') {
    assert.equal(notRecovered.value.status, 'not_recovered');
    assert.equal(notRecovered.value.breakEvenReuseCount, 4);
    assert.equal(notRecovered.value.netTokensSaved, -300);
  }

  const recovered = evaluateMemoryEconomics({ ingestionInputTokens: 1_000, ingestionOutputTokens: 200, savedAgentTokensPerReuse: 300, reuseCount: 4 });
  assert.equal(recovered._tag, 'Ok');
  if (recovered._tag === 'Ok') assert.equal(recovered.value.status, 'recovered');
});

test('MAC-06 invalid economics counters fail closed', () => {
  const invalid = evaluateMemoryEconomics({ ingestionInputTokens: -1, reuseCount: 0 });
  assert.equal(invalid._tag, 'Err');
});
