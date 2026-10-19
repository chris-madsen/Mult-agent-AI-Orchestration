import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteEpisode } from '../src/archive/episodes.mjs';
import { readBlob } from '../src/archive/blob-store.mjs';

test('deleting one episode preserves shared immutable bytes', () => {
  assert.equal(deleteEpisode('episode-a'), true);
  assert.deepEqual(readBlob('shared-digest'), Buffer.from('immutable source bytes'));
  assert.equal(deleteEpisode('episode-b'), true);
  assert.equal(readBlob('shared-digest'), undefined);
});
