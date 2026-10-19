import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeFileQdrantSnapshotState } from '../src/adapters/file-qdrant-snapshot-state.js';

const workspaceId = 'snapshot-state-workspace' as never;
const indexKey = 'a'.repeat(64);
const providerFingerprint = 'b'.repeat(64);
const identity = {
  workspaceId,
  indexKey,
  candidateIds: ['candidate-b', 'candidate-a'],
  coverage: {
    attemptedPaths: 2,
    indexedPaths: 2,
    policyExcludedPaths: 0,
    outOfScopePaths: 0,
    failedPaths: 0,
    failures: [],
  },
  providerFingerprint,
};

test('Qdrant snapshot manifest is reusable only after atomic publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-snapshot-state-'));
  const state = await makeFileQdrantSnapshotState(root);
  assert.equal((await state.isPublished(identity))._tag, 'Ok');
  assert.equal((await state.isPublished(identity) as { _tag: 'Ok'; value: boolean }).value, false);
  assert.equal((await state.beginBuild(identity))._tag, 'Ok');
  const building = await state.isPublished(identity);
  assert.equal(building._tag, 'Ok');
  if (building._tag === 'Ok') assert.equal(building.value, false);
  assert.equal((await state.publish(identity))._tag, 'Ok');
  const published = await state.isPublished(identity);
  assert.equal(published._tag, 'Ok');
  if (published._tag === 'Ok') assert.equal(published.value, true);

  const changedMembership = await state.isPublished({ ...identity, candidateIds: ['candidate-a'] });
  assert.equal(changedMembership._tag, 'Ok');
  if (changedMembership._tag === 'Ok') assert.equal(changedMembership.value, false);
});

test('snapshot leases retain all active keys until each owner closes explicitly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-snapshot-lease-'));
  const state = await makeFileQdrantSnapshotState(root);
  const first = await state.acquireLease(workspaceId, indexKey);
  const secondKey = 'c'.repeat(64);
  const second = await state.acquireLease(workspaceId, secondKey);
  assert.equal(first._tag, 'Ok');
  assert.equal(second._tag, 'Ok');
  if (first._tag === 'Err' || second._tag === 'Err') throw new Error('lease setup failed');

  let active = await state.activeIndexKeys(workspaceId);
  assert.equal(active._tag, 'Ok');
  if (active._tag === 'Ok') assert.deepEqual([...active.value].sort(), [indexKey, secondKey].sort());

  await first.value.close();
  active = await state.activeIndexKeys(workspaceId);
  assert.equal(active._tag, 'Ok');
  if (active._tag === 'Ok') assert.deepEqual([...active.value], [secondKey]);

  await second.value.close();
  active = await state.activeIndexKeys(workspaceId);
  assert.equal(active._tag, 'Ok');
  if (active._tag === 'Ok') assert.deepEqual([...active.value], []);
});
