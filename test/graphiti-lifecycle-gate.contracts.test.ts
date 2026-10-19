import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeAsyncFileMemoryArchive } from '../src/adapters/file-memory-archive.js';
import { makeFileProjectionOutbox } from '../src/adapters/file-projection-outbox.js';
import { runGraphitiLifecycleGate } from '../src/application/graphiti-lifecycle-gate.js';
import { projectionKey, type SessionEpisode } from '../src/domain/memory.js';
import { ok } from '../src/domain/result.js';
import { makeWorkspaceId, type ContentDigest } from '../src/domain/workspace.js';
import type { GraphProjectionPort, GraphProjectionStatePort, MemorySearchPort } from '../src/application/ports.js';

const workspace = makeWorkspaceId('graphiti-lifecycle-fixture');
if (workspace._tag === 'Err') throw new Error(workspace.error.message);

const episodeFixture = (): SessionEpisode => {
  const content = Buffer.from('We decided to keep private memory local in Graphiti.\n', 'utf8');
  const digest = createHash('sha256').update(content).digest('hex') as ContentDigest;
  return {
    episodeId: 'graphiti-lifecycle-episode' as never,
    workspaceId: workspace.value,
    sessionId: 'graphiti-lifecycle-session',
    sourcePointer: 'codex://graphiti-lifecycle/session/1',
    occurredAtMs: 1_700_000_000_000,
    importedAtMs: 1_700_000_001_000,
    contentDigest: digest,
    content,
    searchText: 'We decided to keep private memory local in Graphiti.',
    memoryHint: 'project',
    tombstoned: false,
  };
};

test('Graphiti lifecycle gate proves projection, provenance recall, purge and tombstone in order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-graphiti-lifecycle-'));
  const archive = await makeAsyncFileMemoryArchive(join(root, 'archive'));
  const outbox = await makeFileProjectionOutbox(join(root, 'outbox'));
  const episode = episodeFixture();
  let present = false;
  let purgeCalls = 0;
  const projection: GraphProjectionPort = {
    project: (input) => {
      present = true;
      return Effect.succeed(ok({
        key: projectionKey(input.episodeId, input.extractorVersion),
        episodeId: input.episodeId,
        extractorVersion: input.extractorVersion,
        status: 'pending',
        attempts: 1,
      }));
    },
    purge: () => {
      purgeCalls += 1;
      present = false;
      return Effect.succeed(ok(undefined));
    },
  };
  const state: GraphProjectionStatePort = {
    isPresent: () => Effect.succeed(ok(present)),
  };
  const memory: MemorySearchPort = {
    search: (input) => Effect.succeed(ok({
      hits: [{
        episode: {
          episodeId: episode.episodeId,
          workspaceId: episode.workspaceId,
          sessionId: episode.sessionId,
          sourcePointer: episode.sourcePointer,
          occurredAtMs: episode.occurredAtMs,
          importedAtMs: episode.importedAtMs,
          contentDigest: episode.contentDigest,
          searchText: episode.searchText,
          tombstoned: false,
        },
        matchingExcerpt: 'private memory remains local',
      }],
      conflicts: [],
      ...(input.asOfMs === undefined ? {} : { asOfMs: input.asOfMs }),
    })),
  };

  const result = await runGraphitiLifecycleGate({
    episode,
    query: 'where should private memory stay?',
    extractorVersion: 'graphiti-e2e-v1',
    requestId: 'graphiti-lifecycle-request',
    archive,
    outbox,
    projection,
    projectionState: state,
    memory,
    projectionPollAttempts: 2,
    projectionPollDelayMs: 0,
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.projectionObserved, true);
  assert.equal(result.value.provenanceHitCount, 1);
  assert.equal(result.value.purgeVerified, true);
  assert.equal(result.value.archiveTombstoneVerified, true);
  assert.equal(purgeCalls, 1);

  const archived = await archive.readEpisode(episode.episodeId);
  assert.equal(archived._tag, 'Err');
  if (archived._tag === 'Err') assert.equal(archived.error.code, 'ARCHIVE_TOMBSTONED');

  const receipts = await outbox.list();
  assert.equal(receipts._tag, 'Ok');
  if (receipts._tag === 'Ok') assert.equal(receipts.value[0]?.status, 'tombstoned');
});

test('Graphiti lifecycle gate refuses recall without exact archive provenance and preserves source truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-graphiti-lifecycle-miss-'));
  const archive = await makeAsyncFileMemoryArchive(join(root, 'archive'));
  const outbox = await makeFileProjectionOutbox(join(root, 'outbox'));
  const episode = episodeFixture();
  const projection: GraphProjectionPort = {
    project: (input) => Effect.succeed(ok({
      key: projectionKey(input.episodeId, input.extractorVersion),
      episodeId: input.episodeId,
      extractorVersion: input.extractorVersion,
      status: 'pending',
      attempts: 1,
    })),
    purge: () => Effect.succeed(ok(undefined)),
  };
  const state: GraphProjectionStatePort = { isPresent: () => Effect.succeed(ok(true)) };
  const memory: MemorySearchPort = {
    search: () => Effect.succeed(ok({ hits: [], conflicts: [] })),
  };

  const result = await runGraphitiLifecycleGate({
    episode,
    query: 'missing provenance',
    extractorVersion: 'graphiti-e2e-v1',
    requestId: 'graphiti-lifecycle-request-miss',
    archive,
    outbox,
    projection,
    projectionState: state,
    memory,
    projectionPollAttempts: 1,
    projectionPollDelayMs: 0,
  });
  assert.equal(result._tag, 'Err');
  const archived = await archive.readEpisode(episode.episodeId);
  assert.equal(archived._tag, 'Ok', 'failed recall proof must not delete source truth');
});
