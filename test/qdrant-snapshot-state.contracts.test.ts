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


test('orphaned snapshot lease from a dead local process is recovered after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-snapshot-orphan-'));
  const deadPid = 424242;
  const writer = await makeFileQdrantSnapshotState(root, {
    processId: deadPid,
    processStatus: () => 'alive',
    nowMs: () => 100,
  });
  const lease = await writer.acquireLease(workspaceId, indexKey);
  assert.equal(lease._tag, 'Ok');
  if (lease._tag === 'Err') throw new Error('lease setup failed');

  const restarted = await makeFileQdrantSnapshotState(root, {
    processStatus: (processId) => processId === deadPid ? 'dead' : 'unknown',
    nowMs: () => 200,
  });
  const active = await restarted.activeIndexKeys(workspaceId);
  assert.equal(active._tag, 'Ok');
  if (active._tag === 'Ok') assert.deepEqual([...active.value], []);

  const secondPass = await restarted.activeIndexKeys(workspaceId);
  assert.equal(secondPass._tag, 'Ok');
  if (secondPass._tag === 'Ok') assert.deepEqual([...secondPass.value], []);
});

test('unknown lease liveness is retained fail-closed instead of risking reader data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-snapshot-unknown-'));
  const simulatedPid = 525252;
  const writer = await makeFileQdrantSnapshotState(root, {
    processId: simulatedPid,
    processStatus: () => 'alive',
  });
  const lease = await writer.acquireLease(workspaceId, indexKey);
  assert.equal(lease._tag, 'Ok');
  if (lease._tag === 'Err') throw new Error('lease setup failed');

  const inspector = await makeFileQdrantSnapshotState(root, {
    processStatus: () => 'unknown',
  });
  const active = await inspector.activeIndexKeys(workspaceId);
  assert.equal(active._tag, 'Ok');
  if (active._tag === 'Ok') assert.deepEqual([...active.value], [indexKey]);
});

test('corrupt lease metadata blocks garbage collection rather than being silently removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-snapshot-corrupt-'));
  const state = await makeFileQdrantSnapshotState(root, {
    processId: 626262,
    processStatus: () => 'alive',
  });
  const lease = await state.acquireLease(workspaceId, indexKey);
  assert.equal(lease._tag, 'Ok');
  if (lease._tag === 'Err') throw new Error('lease setup failed');

  const { createHash } = await import('node:crypto');
  const { readdir, writeFile } = await import('node:fs/promises');
  const workspaceKey = createHash('sha256').update(workspaceId).digest('hex').slice(0, 32);
  const directory = join(root, 'leases', workspaceKey, indexKey);
  const [leaseFile] = await readdir(directory);
  assert.notEqual(leaseFile, undefined);
  if (leaseFile === undefined) return;
  await writeFile(join(directory, leaseFile), '{not-json', 'utf8');

  const active = await state.activeIndexKeys(workspaceId);
  assert.equal(active._tag, 'Err');
  if (active._tag === 'Err') assert.equal(active.error.code, 'PERSISTENCE_FAILED');
});
