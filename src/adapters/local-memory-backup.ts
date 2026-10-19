import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';

export interface LocalMemoryBackupFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface LocalMemoryBackupManifest {
  readonly schemaVersion: 1;
  readonly kind: 'ace-memory-local-backup';
  readonly createdAtMs: number;
  readonly files: readonly LocalMemoryBackupFile[];
  readonly contentSha256: string;
}

const isMissing = (cause: unknown): boolean => (cause as NodeJS.ErrnoException).code === 'ENOENT';

const sha256File = async (path: string): Promise<string> => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest('hex');
};

const normalizedRelativePath = (root: string, absolute: string): Result<string, DomainError> => {
  const value = relative(root, absolute).split(sep).join('/');
  return value.length > 0
    && !isAbsolute(value)
    && value !== '..'
    && !value.startsWith('../')
    && !value.includes('/../')
    && !value.includes('\\')
    ? ok(value)
    : err(domainError('PERSISTENCE_FAILED', 'backup_path', 'backup traversal produced an unsafe relative path'));
};

const overlaps = (left: string, right: string): boolean => {
  const a = resolve(left);
  const b = resolve(right);
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
};

const listRegularFiles = async (root: string): Promise<Result<readonly string[], DomainError>> => {
  const output: string[] = [];
  const visit = async (directory: string): Promise<Result<void, DomainError>> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return err(domainError('PERSISTENCE_FAILED', 'backup_source', 'could not enumerate local memory state'));
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name);
      let metadata;
      try {
        metadata = await lstat(absolute);
      } catch {
        return err(domainError('PERSISTENCE_FAILED', 'backup_source', 'could not inspect local memory state'));
      }
      if (metadata.isSymbolicLink()) {
        return err(domainError('PERSISTENCE_FAILED', 'backup_source', 'local memory backup refuses symbolic links'));
      }
      if (metadata.isDirectory()) {
        const nested = await visit(absolute);
        if (nested._tag === 'Err') return nested;
        continue;
      }
      if (!metadata.isFile()) {
        return err(domainError('PERSISTENCE_FAILED', 'backup_source', 'local memory backup accepts only regular files and directories'));
      }
      output.push(absolute);
    }
    return ok(undefined);
  };
  const visited = await visit(root);
  return visited._tag === 'Err' ? visited : ok(output);
};

const manifestDigest = (files: readonly LocalMemoryBackupFile[]): string =>
  createHash('sha256')
    .update(JSON.stringify([...files].sort((left, right) => left.path.localeCompare(right.path))), 'utf8')
    .digest('hex');

const validManifestFile = (file: unknown): file is LocalMemoryBackupFile => {
  if (typeof file !== 'object' || file === null || Array.isArray(file)) return false;
  const value = file as Partial<LocalMemoryBackupFile>;
  return typeof value.path === 'string'
    && value.path.length > 0
    && !isAbsolute(value.path)
    && value.path !== '..'
    && !value.path.startsWith('../')
    && !value.path.includes('/../')
    && !value.path.includes('\\')
    && typeof value.sizeBytes === 'number'
    && Number.isSafeInteger(value.sizeBytes)
    && value.sizeBytes >= 0
    && typeof value.sha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(value.sha256);
};

export const verifyLocalMemoryBackup = async (
  bundleRoot: string,
): Promise<Result<LocalMemoryBackupManifest, DomainError>> => {
  const root = resolve(bundleRoot);
  let manifest: LocalMemoryBackupManifest;
  try {
    const parsed: unknown = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return err(domainError('PERSISTENCE_FAILED', 'backup_manifest', 'local memory backup manifest is not an object'));
    }
    const value = parsed as Partial<LocalMemoryBackupManifest>;
    if (value.schemaVersion !== 1
      || value.kind !== 'ace-memory-local-backup'
      || !Number.isSafeInteger(value.createdAtMs) || (value.createdAtMs ?? -1) < 0
      || !Array.isArray(value.files)
      || !value.files.every(validManifestFile)
      || typeof value.contentSha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(value.contentSha256)) {
      return err(domainError('PERSISTENCE_FAILED', 'backup_manifest', 'local memory backup manifest is invalid'));
    }
    manifest = value as LocalMemoryBackupManifest;
  } catch {
    return err(domainError('PERSISTENCE_FAILED', 'backup_manifest', 'could not read local memory backup manifest'));
  }

  const unique = new Set(manifest.files.map((file) => file.path));
  if (unique.size !== manifest.files.length || manifestDigest(manifest.files) !== manifest.contentSha256) {
    return err(domainError('DIGEST_MISMATCH', 'backup_manifest', 'local memory backup manifest membership digest does not match'));
  }

  const dataRoot = join(root, 'data');
  const observed = await listRegularFiles(dataRoot);
  if (observed._tag === 'Err') return observed;
  const observedRelative: string[] = [];
  for (const absolute of observed.value) {
    const relativePath = normalizedRelativePath(dataRoot, absolute);
    if (relativePath._tag === 'Err') return relativePath;
    observedRelative.push(relativePath.value);
  }
  const expectedPaths = [...manifest.files.map((file) => file.path)].sort();
  if (JSON.stringify(observedRelative.sort()) !== JSON.stringify(expectedPaths)) {
    return err(domainError('DIGEST_MISMATCH', 'backup_membership', 'backup data files do not exactly match the manifest'));
  }

  for (const file of manifest.files) {
    const absolute = join(dataRoot, ...file.path.split('/'));
    let metadata;
    try {
      metadata = await stat(absolute);
    } catch {
      return err(domainError('PERSISTENCE_FAILED', 'backup_data', 'could not stat backup data file'));
    }
    if (!metadata.isFile() || metadata.size !== file.sizeBytes || await sha256File(absolute) !== file.sha256) {
      return err(domainError('DIGEST_MISMATCH', 'backup_data', `backup file failed verification: ${file.path}`));
    }
  }
  return ok(manifest);
};

export const createLocalMemoryBackup = async (
  sourceRoot: string,
  bundleRoot: string,
  nowMs: number = Date.now(),
): Promise<Result<LocalMemoryBackupManifest, DomainError>> => {
  const source = resolve(sourceRoot);
  const destination = resolve(bundleRoot);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    return err(domainError('INVALID_INPUT', 'backup_time', 'backup timestamp must be a non-negative safe integer'));
  }
  if (overlaps(source, destination)) {
    return err(domainError('INVALID_INPUT', 'backup_path', 'backup source and destination must not overlap'));
  }
  try {
    const sourceStat = await lstat(source);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      return err(domainError('INVALID_INPUT', 'backup_source', 'memory backup source must be a real directory'));
    }
  } catch {
    return err(domainError('FILE_NOT_FOUND', 'backup_source', 'memory backup source directory does not exist'));
  }
  try {
    await lstat(join(source, '.archive-write.lock'));
    return err(domainError('PERSISTENCE_FAILED', 'backup_source', 'archive write lock exists; backup requires a quiesced archive'));
  } catch (cause) {
    if (!isMissing(cause)) return err(domainError('PERSISTENCE_FAILED', 'backup_source', 'could not inspect archive write lock'));
  }
  try {
    await lstat(destination);
    return err(domainError('INVALID_INPUT', 'backup_destination', 'backup destination already exists'));
  } catch (cause) {
    if (!isMissing(cause)) return err(domainError('PERSISTENCE_FAILED', 'backup_destination', 'could not inspect backup destination'));
  }

  const staging = join(dirname(destination), `.${basename(destination)}.staging-${randomUUID()}`);
  const dataRoot = join(staging, 'data');
  try {
    await mkdir(dataRoot, { recursive: true });
    const files = await listRegularFiles(source);
    if (files._tag === 'Err') {
      await rm(staging, { recursive: true, force: true });
      return files;
    }
    const records: LocalMemoryBackupFile[] = [];
    for (const absolute of files.value) {
      const relativePath = normalizedRelativePath(source, absolute);
      if (relativePath._tag === 'Err') {
        await rm(staging, { recursive: true, force: true });
        return relativePath;
      }
      const target = join(dataRoot, ...relativePath.value.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(absolute, target);
      const [sourceStat, copiedStat, sourceDigest, copiedDigest] = await Promise.all([
        stat(absolute),
        stat(target),
        sha256File(absolute),
        sha256File(target),
      ]);
      if (sourceStat.size !== copiedStat.size || sourceDigest !== copiedDigest) {
        await rm(staging, { recursive: true, force: true });
        return err(domainError('DIGEST_MISMATCH', 'backup_copy', `backup copy verification failed: ${relativePath.value}`));
      }
      records.push({
        path: relativePath.value,
        sizeBytes: sourceStat.size,
        sha256: sourceDigest,
      });
    }
    records.sort((left, right) => left.path.localeCompare(right.path));
    const manifest: LocalMemoryBackupManifest = {
      schemaVersion: 1,
      kind: 'ace-memory-local-backup',
      createdAtMs: nowMs,
      files: records,
      contentSha256: manifestDigest(records),
    };
    await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await rename(staging, destination);
    const verified = await verifyLocalMemoryBackup(destination);
    return verified._tag === 'Err' ? verified : ok(manifest);
  } catch {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    return err(domainError('PERSISTENCE_FAILED', 'backup', 'could not create local memory backup'));
  }
};

export const restoreLocalMemoryBackup = async (
  bundleRoot: string,
  destinationRoot: string,
): Promise<Result<LocalMemoryBackupManifest, DomainError>> => {
  const bundle = resolve(bundleRoot);
  const destination = resolve(destinationRoot);
  if (overlaps(bundle, destination)) {
    return err(domainError('INVALID_INPUT', 'restore_path', 'backup bundle and restore destination must not overlap'));
  }
  const verified = await verifyLocalMemoryBackup(bundle);
  if (verified._tag === 'Err') return verified;
  try {
    await lstat(destination);
    return err(domainError('INVALID_INPUT', 'restore_destination', 'restore destination already exists'));
  } catch (cause) {
    if (!isMissing(cause)) return err(domainError('PERSISTENCE_FAILED', 'restore_destination', 'could not inspect restore destination'));
  }

  const staging = join(dirname(destination), `.${basename(destination)}.restore-${randomUUID()}`);
  try {
    await mkdir(staging, { recursive: true });
    for (const file of verified.value.files) {
      const source = join(bundle, 'data', ...file.path.split('/'));
      const target = join(staging, ...file.path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      const [metadata, digest] = await Promise.all([stat(target), sha256File(target)]);
      if (metadata.size !== file.sizeBytes || digest !== file.sha256) {
        await rm(staging, { recursive: true, force: true });
        return err(domainError('DIGEST_MISMATCH', 'restore_copy', `restored file failed verification: ${file.path}`));
      }
    }
    await rename(staging, destination);
    return ok(verified.value);
  } catch {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    return err(domainError('PERSISTENCE_FAILED', 'restore', 'could not restore local memory backup'));
  }
};
