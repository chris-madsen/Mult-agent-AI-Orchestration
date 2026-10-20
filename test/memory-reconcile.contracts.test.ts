import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeAsyncFileMemoryArchive } from '../src/adapters/file-memory-archive.js';
import { makeFileProjectionOutbox } from '../src/adapters/file-projection-outbox.js';
import { reconcileProjectionIntents } from '../src/application/memory-reconcile.js';
import { makeEpisodeId, type SessionEpisode } from '../src/domain/memory.js';
import { makeWorkspaceId, type ContentDigest } from '../src/domain/workspace.js';

const workspace = makeWorkspaceId('memory-reconcile-fixture');
if (workspace._tag === 'Err') throw new Error(workspace.error.message);

const episodeFixture = (): SessionEpisode => {
  const content = Buffer.from('We decided to retain this source locally.\n', 'utf8');
  const contentDigest = createHash('sha256').update(content).digest('hex') as ContentDigest;
  const episodeId = makeEpisodeId('reconcile-episode');
  if (episodeId._tag === 'Err') throw new Error(episodeId.error.message);
  return {
    episodeId: episodeId.value,
    workspaceId: workspace.value,
    sessionId: 'reconcile-session',
    sourcePointer: 'codex://reconcile/session/1',
    occurredAtMs: 1_700_000_000_000,
    importedAtMs: 1_700_000_000_001,
    contentDigest,
    content,
    searchText: 'We decided to retain this source locally.',
    memoryHint: 'project',
    tombstoned: false,
  };
};

test('reconciliation rebuilds a missing projection intent from immutable archive truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-memory-reconcile-'));
  const archive = await makeAsyncFileMemoryArchive(join(root, 'archive'));
  const outbox = await makeFileProjectionOutbox(join(root, 'outbox'));
  const episode = episodeFixture();
  assert.equal((await archive.importEpisode(episode))._tag, 'Ok');

  const archived = await archive.listEpisodes();
  assert.equal(archived._tag, 'Ok');
  if (archived._tag === 'Err') throw new Error(archived.error.message);
  const rebuilt = await reconcileProjectionIntents({
    episodes: archived.value,
    extractorVersion: 'reconcile-v1',
    outbox,
  });
  assert.deepEqual(rebuilt, { _tag: 'Ok', value: 1 });

  const receipts = await outbox.list();
  assert.equal(receipts._tag, 'Ok');
  if (receipts._tag === 'Ok') {
    assert.equal(receipts.value.length, 1);
    assert.equal(receipts.value[0]?.episodeId, episode.episodeId);
    assert.equal(receipts.value[0]?.status, 'pending');
  }
});
