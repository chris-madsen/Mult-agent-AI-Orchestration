import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeAsyncFileMemoryArchive } from '../src/adapters/file-memory-archive.js';
import { makeFileProjectionOutbox } from '../src/adapters/file-projection-outbox.js';
import {
  createLocalMemoryBackup,
  restoreLocalMemoryBackup,
  verifyLocalMemoryBackup,
} from '../src/adapters/local-memory-backup.js';
import { makeEpisodeId } from '../src/domain/memory.js';

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

test('quiesced local memory backup round-trips archive bytes and projection outbox', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-memory-backup-'));
  const archiveRoot = join(parent, 'archive');
  const bundleRoot = join(parent, 'bundle');
  const restoredRoot = join(parent, 'restored');

  const archive = await makeAsyncFileMemoryArchive(archiveRoot);
  const bytes = Buffer.from('{"role":"user","text":"retain this exact original"}\n', 'utf8');
  const episodeId = makeEpisodeId('backup-episode');
  assert.equal(episodeId._tag, 'Ok');
  if (episodeId._tag === 'Err') throw new Error(episodeId.error.message);
  const imported = await archive.importEpisode({
    episodeId: episodeId.value,
    workspaceId: 'backup-workspace' as never,
    sessionId: 'backup-session',
    sourcePointer: 'codex://backup-session/1',
    occurredAtMs: 100,
    importedAtMs: 101,
    contentDigest: digest(bytes) as never,
    content: bytes,
    searchText: 'retain this exact original',
    tombstoned: false,
  });
  assert.equal(imported._tag, 'Ok');

  const outbox = await makeFileProjectionOutbox(join(archiveRoot, 'projection-outbox'));
  const begun = await outbox.begin(episodeId.value, 'extractor-v1');
  assert.equal(begun._tag, 'Ok');
  if (begun._tag === 'Err') throw new Error(begun.error.message);
  assert.equal((await outbox.put({
    ...begun.value,
    status: 'incomplete',
    attempts: 2,
    totalAttempts: 2,
    nextAttemptAtMs: 500,
    lastErrorCode: 'EXTERNAL_UNAVAILABLE',
  }))._tag, 'Ok');

  const backup = await createLocalMemoryBackup(archiveRoot, bundleRoot, 1_000);
  assert.equal(backup._tag, 'Ok');
  if (backup._tag === 'Err') throw new Error(backup.error.message);
  assert.ok(backup.value.files.some((file) => file.path.startsWith('episodes/')));
  assert.ok(backup.value.files.some((file) => file.path.startsWith('projection-outbox/')));

  const verified = await verifyLocalMemoryBackup(bundleRoot);
  assert.equal(verified._tag, 'Ok');
  if (verified._tag === 'Err') throw new Error(verified.error.message);
  assert.equal(verified.value.contentSha256, backup.value.contentSha256);

  const restored = await restoreLocalMemoryBackup(bundleRoot, restoredRoot);
  assert.equal(restored._tag, 'Ok');
  if (restored._tag === 'Err') throw new Error(restored.error.message);

  const restoredArchive = await makeAsyncFileMemoryArchive(restoredRoot);
  const original = await restoredArchive.readEpisode(episodeId.value);
  assert.equal(original._tag, 'Ok');
  if (original._tag === 'Err') throw new Error(original.error.message);
  assert.equal(Buffer.compare(Buffer.from(original.value.content), bytes), 0);

  const restoredOutbox = await makeFileProjectionOutbox(join(restoredRoot, 'projection-outbox'));
  const receipts = await restoredOutbox.list();
  assert.equal(receipts._tag, 'Ok');
  if (receipts._tag === 'Err') throw new Error(receipts.error.message);
  assert.equal(receipts.value.length, 1);
  assert.equal(receipts.value[0]?.status, 'incomplete');
  assert.equal(receipts.value[0]?.attempts, 2);
  assert.equal(receipts.value[0]?.lastErrorCode, 'EXTERNAL_UNAVAILABLE');
});

test('tampered backup data fails digest verification and cannot restore', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-memory-backup-tamper-'));
  const archiveRoot = join(parent, 'archive');
  const bundleRoot = join(parent, 'bundle');
  const restoredRoot = join(parent, 'restored');
  const archive = await makeAsyncFileMemoryArchive(archiveRoot);
  const bytes = Buffer.from('exact bytes');
  const episodeId = makeEpisodeId('tamper-episode');
  assert.equal(episodeId._tag, 'Ok');
  if (episodeId._tag === 'Err') throw new Error(episodeId.error.message);
  assert.equal((await archive.importEpisode({
    episodeId: episodeId.value,
    workspaceId: 'backup-workspace' as never,
    sessionId: 's',
    sourcePointer: 'codex://s/1',
    occurredAtMs: 1,
    importedAtMs: 1,
    contentDigest: digest(bytes) as never,
    content: bytes,
    searchText: 'exact bytes',
    tombstoned: false,
  }))._tag, 'Ok');
  const backup = await createLocalMemoryBackup(archiveRoot, bundleRoot, 2);
  assert.equal(backup._tag, 'Ok');
  if (backup._tag === 'Err') throw new Error(backup.error.message);

  const blob = backup.value.files.find((file) => file.path.endsWith('.bin'));
  assert.notEqual(blob, undefined);
  if (blob === undefined) return;
  await writeFile(join(bundleRoot, 'data', ...blob.path.split('/')), 'tampered', 'utf8');

  const verified = await verifyLocalMemoryBackup(bundleRoot);
  assert.equal(verified._tag, 'Err');
  if (verified._tag === 'Err') assert.equal(verified.error.code, 'DIGEST_MISMATCH');
  const restored = await restoreLocalMemoryBackup(bundleRoot, restoredRoot);
  assert.equal(restored._tag, 'Err');
});

test('backup refuses active writer lock and symbolic links', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-memory-backup-safety-'));
  const lockedRoot = join(parent, 'locked');
  await mkdir(lockedRoot, { recursive: true });
  await mkdir(join(lockedRoot, '.archive-write.lock'));
  const locked = await createLocalMemoryBackup(lockedRoot, join(parent, 'locked-bundle'), 3);
  assert.equal(locked._tag, 'Err');

  const sourceRoot = join(parent, 'symlink-source');
  await mkdir(sourceRoot, { recursive: true });
  const external = join(parent, 'outside.txt');
  await writeFile(external, 'outside', 'utf8');
  await symlink(external, join(sourceRoot, 'linked.txt'));
  const linked = await createLocalMemoryBackup(sourceRoot, join(parent, 'symlink-bundle'), 4);
  assert.equal(linked._tag, 'Err');
});

test('restore never overwrites an existing destination', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-memory-restore-existing-'));
  const archiveRoot = join(parent, 'archive');
  const bundleRoot = join(parent, 'bundle');
  const destination = join(parent, 'destination');
  await mkdir(archiveRoot, { recursive: true });
  await writeFile(join(archiveRoot, 'plain.json'), '{"ok":true}\n', 'utf8');
  assert.equal((await createLocalMemoryBackup(archiveRoot, bundleRoot, 5))._tag, 'Ok');
  await mkdir(destination);
  await writeFile(join(destination, 'keep.txt'), 'do not overwrite', 'utf8');

  const restored = await restoreLocalMemoryBackup(bundleRoot, destination);
  assert.equal(restored._tag, 'Err');
  assert.equal(await readFile(join(destination, 'keep.txt'), 'utf8'), 'do not overwrite');
});
