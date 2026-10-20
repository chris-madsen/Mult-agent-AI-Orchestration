import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  diffSnapshotFileManifests,
  makeFileQdrantSnapshotState,
} from '../src/adapters/file-qdrant-snapshot-state.js';
import { ok } from '../src/domain/result.js';

const workspaceId = 'snapshot-state-workspace' as never;
const indexKey = 'a'.repeat(64);
const providerFingerprint = 'b'.repeat(64);
const identity = {
  workspaceId,
  indexKey,
  candidateIds: ['candidate-b', 'candidate-a'],
  fileManifest: [
    {
      repoPath: 'src/a.ts' as never,
      sourceDigest: 'c'.repeat(64) as never,
      candidateIds: ['candidate-a' as never],
    },
    {
      repoPath: 'src/b.ts' as never,
      sourceDigest: 'd'.repeat(64) as never,
      candidateIds: ['candidate-b' as never],
    },
  ],
  coverage: {
    schemaVersion: 1,
    sourceSnapshotDigest: 'e'.repeat(64) as never,
    parserVersion: 'fixture/parser-v1',
    attemptedPaths: 2,
    indexedPaths: 2,
    policyExcludedPaths: 0,
    outOfScopePaths: 0,
    failedPaths: 0,
    failureCounts: {
      read_failed: 0,
      binary_source: 0,
      invalid_utf8: 0,
      digest_raced: 0,
      structural_failed: 0,
      digest_mismatch: 0,
      parser_partial: 0,
      unsupported_parser: 0,
    },
    failures: [],
  },
  providerFingerprint,
};

test('Qdrant snapshot manifest is reusable only after atomic publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-snapshot-state-'));
  const state = await makeFileQdrantSnapshotState(root);
  assert.equal((await state.isPublished(identity))._tag, 'Ok');
  assert.equal((await state.isPublished(identity) as { _tag: 'Ok'; value: boolean }).value, false);
  const illegalPublish = await state.publish(identity);
  assert.equal(illegalPublish._tag, 'Err');
  if (illegalPublish._tag === 'Err') assert.equal(illegalPublish.error.code, 'PERSISTENCE_FAILED');
  assert.equal((await state.beginBuild(identity))._tag, 'Ok');
  const building = await state.isPublished(identity);
  assert.equal(building._tag, 'Ok');
  if (building._tag === 'Ok') assert.equal(building.value, false);
  assert.equal((await state.publish(identity))._tag, 'Ok');
  const published = await state.isPublished(identity);
  assert.equal(published._tag, 'Ok');
  if (published._tag === 'Ok') assert.equal(published.value, true);

  const changedMembership = await state.isPublished({
    ...identity,
    candidateIds: ['candidate-a'],
    fileManifest: identity.fileManifest.map((file) => file.repoPath === 'src/b.ts'
      ? { ...file, candidateIds: [] }
      : file),
  });
  // A concurrent/retried begin must not demote a published manifest to
  // building, because readers may already hold the corresponding lease.
  assert.equal((await state.beginBuild(identity))._tag, 'Ok');
  const remainsPublished = await state.isPublished(identity);
  assert.equal(remainsPublished._tag, 'Ok');
  if (remainsPublished._tag === 'Ok') assert.equal(remainsPublished.value, true);
  assert.equal(changedMembership._tag, 'Ok');
  if (changedMembership._tag === 'Ok') assert.equal(changedMembership.value, false);

  const changedFileDigest = await state.isPublished({
    ...identity,
    fileManifest: identity.fileManifest.map((file) => file.repoPath === 'src/a.ts'
      ? { ...file, sourceDigest: 'e'.repeat(64) as never }
      : file),
  });
  assert.equal(changedFileDigest._tag, 'Ok');
  if (changedFileDigest._tag === 'Ok') assert.equal(changedFileDigest.value, false);
});



test('snapshot state owner is stable per state root and distinct across independent roots', async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), 'ace-snapshot-owner-a-'));
  const secondRoot = await mkdtemp(join(tmpdir(), 'ace-snapshot-owner-b-'));
  const first = await makeFileQdrantSnapshotState(firstRoot);
  const reopened = await makeFileQdrantSnapshotState(firstRoot);
  const second = await makeFileQdrantSnapshotState(secondRoot);

  assert.match(first.stateOwnerId, /^[a-f0-9]{64}$/u);
  assert.equal(reopened.stateOwnerId, first.stateOwnerId);
  assert.notEqual(second.stateOwnerId, first.stateOwnerId);
});

test('conservative lease mode never reaps a foreign/dead-looking PID automatically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-snapshot-conservative-'));
  const simulatedForeignPid = 737373;
  const writer = await makeFileQdrantSnapshotState(root, {
    processId: simulatedForeignPid,
    processStatus: () => 'alive',
  });
  const lease = await writer.acquireLease(workspaceId, indexKey);
  assert.equal(lease._tag, 'Ok');
  if (lease._tag === 'Err') throw new Error('lease setup failed');

  const inspector = await makeFileQdrantSnapshotState(root, {
    // This simulates a different PID namespace where process.kill(pid, 0)
    // would report ESRCH even though the remote reader still exists.
    processStatus: () => 'dead',
  });
  const active = await inspector.activeIndexKeys(workspaceId);
  assert.equal(active._tag, 'Ok');
  if (active._tag === 'Ok') assert.deepEqual([...active.value], [indexKey]);
});

test('dead PID reaping is available only through explicit local-process mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-snapshot-local-process-'));
  const simulatedPid = 838383;
  const writer = await makeFileQdrantSnapshotState(root, {
    processId: simulatedPid,
    processStatus: () => 'alive',
  });
  const lease = await writer.acquireLease(workspaceId, indexKey);
  assert.equal(lease._tag, 'Ok');
  if (lease._tag === 'Err') throw new Error('lease setup failed');

  const inspector = await makeFileQdrantSnapshotState(root, {
    processStatus: () => 'dead',
    leaseReapMode: 'local-process',
  });
  const active = await inspector.activeIndexKeys(workspaceId);
  assert.equal(active._tag, 'Ok');
  if (active._tag === 'Ok') assert.deepEqual([...active.value], []);
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
    leaseReapMode: 'local-process',
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
  const { readdir: readFiles, writeFile } = await import('node:fs/promises');
  const workspaceKey = createHash('sha256').update(workspaceId).digest('hex').slice(0, 32);
  const directory = join(root, 'leases', workspaceKey, indexKey);
  const [leaseFile] = await readFiles(directory);
  assert.notEqual(leaseFile, undefined);
  if (leaseFile === undefined) return;
  await writeFile(join(directory, leaseFile), '{not-json', 'utf8');

  const active = await state.activeIndexKeys(workspaceId);
  assert.equal(active._tag, 'Err');
  if (active._tag === 'Err') assert.equal(active.error.code, 'PERSISTENCE_FAILED');
});

test('active-key inspection fences acquire until the retain-and-prune decision is complete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-snapshot-fence-'));
  let entered!: () => void;
  const inspectionEntered = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const releaseInspection = new Promise<void>((resolve) => { release = resolve; });
  const state = await makeFileQdrantSnapshotState(root, {
    processId: 737373,
    processStatus: () => 'dead',
    leaseReapMode: 'local-process',
    beforeLeaseDirectoryRemoval: async () => {
      entered();
      await releaseInspection;
    },
  });
  const first = await state.acquireLease(workspaceId, indexKey);
  assert.equal(first._tag, 'Ok');
  if (first._tag === 'Err') throw new Error('lease setup failed');

  const inspected = state.withActiveIndexKeys(workspaceId, async (active) => ok([...active]));
  await inspectionEntered;
  let secondAcquired = false;
  const second = state.acquireLease(workspaceId, indexKey).then((result) => {
    secondAcquired = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondAcquired, false);

  release();
  const inspectedResult = await inspected;
  assert.equal(inspectedResult._tag, 'Ok');
  if (inspectedResult._tag === 'Ok') assert.deepEqual(inspectedResult.value, []);
  const secondResult = await second;
  assert.equal(secondResult._tag, 'Ok');
  if (secondResult._tag === 'Ok') await secondResult.value.close();
});

test('lease directory read permission and I/O failures block garbage collection', async () => {
  const permissionRoot = await mkdtemp(join(tmpdir(), 'ace-snapshot-eacces-'));
  const permissionState = await makeFileQdrantSnapshotState(permissionRoot, {
    readDirectory: async (_path, withFileTypes = false) => {
      if (withFileTypes) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return [];
    },
  });
  const permissionResult = await permissionState.activeIndexKeys(workspaceId);
  assert.equal(permissionResult._tag, 'Err');
  if (permissionResult._tag === 'Err') assert.equal(permissionResult.error.code, 'PERSISTENCE_FAILED');

  const ioRoot = await mkdtemp(join(tmpdir(), 'ace-snapshot-eio-'));
  const writer = await makeFileQdrantSnapshotState(ioRoot);
  const lease = await writer.acquireLease(workspaceId, indexKey);
  assert.equal(lease._tag, 'Ok');
  if (lease._tag === 'Err') throw new Error('lease setup failed');
  const ioState = await makeFileQdrantSnapshotState(ioRoot, {
    readDirectory: async (path, withFileTypes = false) => {
      if (!withFileTypes) throw Object.assign(new Error('I/O failure'), { code: 'EIO' });
      return readdir(path, { withFileTypes: true });
    },
  });
  const ioResult = await ioState.activeIndexKeys(workspaceId);
  assert.equal(ioResult._tag, 'Err');
  if (ioResult._tag === 'Err') assert.equal(ioResult.error.code, 'PERSISTENCE_FAILED');
  await lease.value.close();
});

test('missing lease workspace is an empty state, while non-ENOENT failures are not', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-snapshot-enoent-'));
  const state = await makeFileQdrantSnapshotState(root);
  const result = await state.activeIndexKeys(workspaceId);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') assert.deepEqual([...result.value], []);
});


test('per-file snapshot delta distinguishes content edits, unique renames, additions and deletions', () => {
  const previous = [
    { repoPath: 'src/stable.ts' as never, sourceDigest: '1'.repeat(64) as never, candidateIds: ['stable-old' as never] },
    { repoPath: 'src/edit.ts' as never, sourceDigest: '2'.repeat(64) as never, candidateIds: ['edit-old' as never] },
    { repoPath: 'src/rename-old.ts' as never, sourceDigest: '3'.repeat(64) as never, candidateIds: ['rename-old' as never] },
    { repoPath: 'src/delete.ts' as never, sourceDigest: '4'.repeat(64) as never, candidateIds: [] },
  ];
  const current = [
    { repoPath: 'src/stable.ts' as never, sourceDigest: '1'.repeat(64) as never, candidateIds: ['stable-old' as never] },
    { repoPath: 'src/edit.ts' as never, sourceDigest: '5'.repeat(64) as never, candidateIds: ['edit-new' as never] },
    { repoPath: 'src/rename-new.ts' as never, sourceDigest: '3'.repeat(64) as never, candidateIds: ['rename-new' as never] },
    { repoPath: 'src/add.ts' as never, sourceDigest: '6'.repeat(64) as never, candidateIds: [] },
  ];

  assert.deepEqual(diffSnapshotFileManifests(previous, current), {
    added: ['src/add.ts'],
    changed: ['src/edit.ts'],
    deleted: ['src/delete.ts'],
    renamed: [{
      from: 'src/rename-old.ts',
      to: 'src/rename-new.ts',
      sourceDigest: '3'.repeat(64),
    }],
    unchanged: ['src/stable.ts'],
  });
});

test('ambiguous same-digest copies are not guessed as renames', () => {
  const digest = '7'.repeat(64) as never;
  const delta = diffSnapshotFileManifests([
    { repoPath: 'src/a.ts' as never, sourceDigest: digest, candidateIds: [] },
    { repoPath: 'src/b.ts' as never, sourceDigest: digest, candidateIds: [] },
  ], [
    { repoPath: 'src/c.ts' as never, sourceDigest: digest, candidateIds: [] },
  ]);
  assert.deepEqual(delta.renamed, []);
  assert.deepEqual(delta.deleted, ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(delta.added, ['src/c.ts']);
});
