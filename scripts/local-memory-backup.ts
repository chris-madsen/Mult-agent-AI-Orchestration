import { resolve } from 'node:path';
import {
  createLocalMemoryBackup,
  restoreLocalMemoryBackup,
  verifyLocalMemoryBackup,
} from '../src/adapters/local-memory-backup.js';

const [operation, first, second] = process.argv.slice(2);

if (operation !== 'backup' && operation !== 'verify' && operation !== 'restore') {
  throw new Error('Usage: tsx scripts/local-memory-backup.ts backup <archive-root> <bundle-root> | verify <bundle-root> | restore <bundle-root> <new-archive-root>');
}

if (operation === 'verify') {
  if (first === undefined || second !== undefined) {
    throw new Error('Usage: ... verify <bundle-root>');
  }
  const verified = await verifyLocalMemoryBackup(resolve(first));
  if (verified._tag === 'Err') throw new Error(`${verified.error.code}: ${verified.error.message}`);
  process.stdout.write(JSON.stringify({
    status: 'VERIFIED',
    kind: verified.value.kind,
    files: verified.value.files.length,
    content_sha256: verified.value.contentSha256,
  }) + '\n');
} else {
  if (first === undefined || second === undefined) {
    throw new Error(operation === 'backup'
      ? 'Usage: ... backup <archive-root> <bundle-root>'
      : 'Usage: ... restore <bundle-root> <new-archive-root>');
  }
  if (process.env.ACE_MEMORY_BACKUP_ACK_QUIESCED !== 'true') {
    throw new Error('Set ACE_MEMORY_BACKUP_ACK_QUIESCED=true only after stopping ACE memory writers/Graphiti projection reconciliation.');
  }
  const result = operation === 'backup'
    ? await createLocalMemoryBackup(resolve(first), resolve(second))
    : await restoreLocalMemoryBackup(resolve(first), resolve(second));
  if (result._tag === 'Err') throw new Error(`${result.error.code}: ${result.error.message}`);
  process.stdout.write(JSON.stringify({
    status: operation === 'backup' ? 'BACKUP_CREATED' : 'RESTORED',
    kind: result.value.kind,
    files: result.value.files.length,
    content_sha256: result.value.contentSha256,
    scope: 'ace-owned-local-memory-archive-and-nested-projection-outbox-only',
  }) + '\n');
}
