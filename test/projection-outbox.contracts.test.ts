import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeFileProjectionOutbox } from '../src/adapters/file-projection-outbox.js';

test('projection outbox survives restart and keeps one logical receipt per episode/extractor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-projection-outbox-'));
  const first = await makeFileProjectionOutbox(root);
  const episodeId = 'episode-outbox' as never;
  const begun = await first.begin(episodeId, 'extractor-v1');
  assert.equal(begun._tag, 'Ok');
  if (begun._tag === 'Err') throw new Error(begun.error.message);
  assert.equal(begun.value.status, 'pending');
  assert.equal(begun.value.attempts, 0);

  const incomplete = { ...begun.value, status: 'incomplete' as const, attempts: 1 };
  assert.equal((await first.put(incomplete))._tag, 'Ok');

  const restarted = await makeFileProjectionOutbox(root);
  const replay = await restarted.begin(episodeId, 'extractor-v1');
  assert.equal(replay._tag, 'Ok');
  if (replay._tag === 'Err') throw new Error(replay.error.message);
  assert.deepEqual(replay.value, incomplete);

  assert.equal((await restarted.put({ ...replay.value, status: 'projected' }))._tag, 'Ok');
  const all = await restarted.list();
  assert.equal(all._tag, 'Ok');
  if (all._tag === 'Ok') {
    assert.equal(all.value.length, 1);
    assert.equal(all.value[0]?.status, 'projected');
  }
});
