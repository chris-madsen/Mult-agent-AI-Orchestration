import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteEpisodeWithProjection } from '../src/application/retained-memory.js';
import { makeFileProjectionOutbox } from '../src/adapters/file-projection-outbox.js';
import { domainError } from '../src/domain/errors.js';
import { err, ok } from '../src/domain/result.js';
import type { AsyncMemoryArchivePort } from '../src/adapters/file-memory-archive.js';
import type { EpisodeId } from '../src/domain/memory.js';
import type { GraphProjectionPort, GraphProjectionStatePort } from '../src/application/ports.js';

const episodeId = 'episode-delete-verify' as EpisodeId;

const archiveFixture = (deleted: { value: number }): AsyncMemoryArchivePort => ({
  listEpisodes: async () => ok([]),
  importEpisode: async () => err(domainError('INVALID_MEMORY', 'test', 'not used')),
  readEpisode: async () => err(domainError('FILE_NOT_FOUND', 'test', 'not used')),
  deleteEpisode: async () => {
    deleted.value += 1;
    return ok(undefined);
  },
});

const graphFixture = (purge: GraphProjectionPort['purge']): GraphProjectionPort => ({
  project: () => Effect.succeed(err(domainError('INVALID_MEMORY', 'test', 'not used'))),
  purge,
});

test('derived purge must be verified absent before archive tombstone', async () => {
  const deleted = { value: 0 };
  let checks = 0;
  const state: GraphProjectionStatePort = {
    isPresent: () => {
      checks += 1;
      return Effect.succeed(ok(true));
    },
  };
  const result = await Effect.runPromise(deleteEpisodeWithProjection(
    archiveFixture(deleted),
    graphFixture(() => Effect.succeed(ok(undefined))),
    state,
    episodeId,
    { verificationAttempts: 2, verificationDelayMs: 0 },
  ));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_EXTERNAL_RESPONSE');
  assert.equal(checks, 2);
  assert.equal(deleted.value, 0, 'source truth must survive an unverified derived purge');
});

test('verified delayed Graphiti absence permits archive deletion', async () => {
  const deleted = { value: 0 };
  let checks = 0;
  const state: GraphProjectionStatePort = {
    isPresent: () => {
      checks += 1;
      return Effect.succeed(ok(checks < 2));
    },
  };
  const result = await Effect.runPromise(deleteEpisodeWithProjection(
    archiveFixture(deleted),
    graphFixture(() => Effect.succeed(ok(undefined))),
    state,
    episodeId,
    { verificationAttempts: 3, verificationDelayMs: 0 },
  ));
  assert.equal(result._tag, 'Ok');
  assert.equal(checks, 2);
  assert.equal(deleted.value, 1);
});

test('purge or verification outage never tombstones the archive', async () => {
  for (const mode of ['purge', 'verify'] as const) {
    const deleted = { value: 0 };
    const graph = graphFixture(() => Effect.succeed(
      mode === 'purge'
        ? err(domainError('EXTERNAL_UNAVAILABLE', 'graphiti', 'offline'))
        : ok(undefined),
    ));
    const state: GraphProjectionStatePort = {
      isPresent: () => Effect.succeed(
        mode === 'verify'
          ? err(domainError('EXTERNAL_UNAVAILABLE', 'graphiti', 'offline'))
          : ok(false),
      ),
    };
    const result = await Effect.runPromise(deleteEpisodeWithProjection(
      archiveFixture(deleted),
      graph,
      state,
      episodeId,
      { verificationDelayMs: 0 },
    ));
    assert.equal(result._tag, 'Err');
    assert.equal(deleted.value, 0);
  }
});

test('deletion fence is durable before purge and blocks in-flight projection persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-retained-delete-fence-'));
  const outbox = await makeFileProjectionOutbox(root);
  const deleted = { value: 0 };
  let present = true;
  const result = await Effect.runPromise(deleteEpisodeWithProjection(
    archiveFixture(deleted),
    graphFixture(() => {
      return Effect.promise(async () => {
        const blocked = await outbox.isDeletionBlocked(episodeId);
        assert.deepEqual(blocked, { _tag: 'Ok', value: true });
        present = false;
        return ok(undefined);
      });
    }),
    { isPresent: () => Effect.succeed(ok(present)) },
    episodeId,
    { verificationAttempts: 2, verificationDelayMs: 0, deletionFence: outbox },
  ));
  assert.equal(result._tag, 'Ok');
  assert.equal(deleted.value, 1);
  const stale = await outbox.put({
    key: 'episode-delete-verify:extractor-v1' as never,
    episodeId,
    extractorVersion: 'extractor-v1',
    status: 'projected',
    attempts: 1,
  });
  assert.equal(stale._tag, 'Err');
  if (stale._tag === 'Err') assert.equal(stale.error.code, 'ARCHIVE_TOMBSTONED');
});
