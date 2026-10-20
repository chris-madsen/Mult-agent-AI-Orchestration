import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { IndexCoverageSummary, IndexFileIdentity } from '../domain/retrieval.js';
import type { WorkspaceId } from '../domain/workspace.js';

export interface SnapshotManifestIdentity {
  readonly workspaceId: WorkspaceId;
  readonly indexKey: string;
  readonly candidateIds: readonly string[];
  readonly fileManifest: readonly IndexFileIdentity[];
  readonly coverage: IndexCoverageSummary;
  readonly providerFingerprint: string;
}

interface StoredSnapshotManifest extends SnapshotManifestIdentity {
  readonly schemaVersion: 3;
  readonly status: 'building' | 'published';
  readonly updatedAtMs: number;
}

export interface SnapshotLease {
  readonly leaseId: string;
  readonly indexKey: string;
  readonly close: () => Promise<void>;
}

export type SnapshotLeaseProcessStatus = 'alive' | 'dead' | 'unknown';

export type SnapshotLeaseReapMode = 'conservative' | 'local-process';

export interface FileQdrantSnapshotStateOptions {
  readonly processId?: number;
  readonly nowMs?: () => number;
  readonly processStatus?: (processId: number) => SnapshotLeaseProcessStatus;
  /**
   * Conservative is the safe default across containers/PID namespaces: valid
   * lease files are retained until explicit close. local-process may reap a
   * dead PID only when the operator guarantees one shared PID namespace.
   */
  readonly leaseReapMode?: SnapshotLeaseReapMode;
  /** Test-only fault injection for lease-directory reads. */
  readonly readDirectory?: (path: string, withFileTypes?: boolean) => Promise<readonly (string | SnapshotDirectoryEntry)[]>;
  /** Test-only barrier before an empty lease directory is removed. */
  readonly beforeLeaseDirectoryRemoval?: (path: string) => Promise<void>;
}

export interface SnapshotDirectoryEntry {
  readonly name: string;
  readonly isDirectory: () => boolean;
}

interface StoredSnapshotLease {
  readonly schemaVersion: 1;
  readonly workspaceId: WorkspaceId;
  readonly indexKey: string;
  readonly leaseId: string;
  readonly processId: number;
  readonly acquiredAtMs: number;
}

export interface FileQdrantSnapshotState {
  /** Persistent random identity for this state root; used to isolate default Qdrant GC namespaces. */
  readonly stateOwnerId: string;
  readonly isPublished: (identity: SnapshotManifestIdentity) => Promise<Result<boolean, DomainError>>;
  readonly latestPublished: (
    workspaceId: WorkspaceId,
    providerFingerprint: string,
    excludeIndexKey?: string,
  ) => Promise<Result<SnapshotManifestIdentity | undefined, DomainError>>;
  readonly beginBuild: (identity: SnapshotManifestIdentity) => Promise<Result<void, DomainError>>;
  readonly publish: (identity: SnapshotManifestIdentity) => Promise<Result<void, DomainError>>;
  readonly acquireLease: (workspaceId: WorkspaceId, indexKey: string) => Promise<Result<SnapshotLease, DomainError>>;
  readonly activeIndexKeys: (workspaceId: WorkspaceId) => Promise<Result<ReadonlySet<string>, DomainError>>;
  /** Hold the lease mutation fence across active-key inspection and pruning. */
  readonly withActiveIndexKeys: <T>(
    workspaceId: WorkspaceId,
    action: (activeIndexKeys: ReadonlySet<string>) => Promise<Result<T, DomainError>>,
  ) => Promise<Result<T, DomainError>>;
}

const validIndexKey = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const validStateOwnerId = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const workspaceKey = (workspaceId: WorkspaceId): string =>
  createHash('sha256').update(workspaceId).digest('hex').slice(0, 32);

const readOrCreateStateOwnerId = async (rootPath: string): Promise<string> => {
  const path = join(rootPath, 'state-owner-id');
  const readExisting = async (): Promise<string> => {
    const value = (await readFile(path, 'utf8')).trim();
    if (!validStateOwnerId(value)) {
      throw new Error('Qdrant snapshot state owner ID is corrupt; refusing to change collection ownership implicitly');
    }
    return value;
  };
  try {
    return await readExisting();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
  }

  const generated = createHash('sha256').update(randomUUID(), 'utf8').digest('hex');
  try {
    await writeFile(path, generated + '\n', { flag: 'wx', mode: 0o600 });
    return generated;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') return readExisting();
    throw cause;
  }
};

const defaultProcessStatus = (processId: number): SnapshotLeaseProcessStatus => {
  if (!Number.isSafeInteger(processId) || processId <= 0) return 'unknown';
  try {
    process.kill(processId, 0);
    return 'alive';
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return 'dead';
    if (code === 'EPERM') return 'alive';
    return 'unknown';
  }
};

const normalizedIdentity = (identity: SnapshotManifestIdentity): SnapshotManifestIdentity => ({
  ...identity,
  candidateIds: [...identity.candidateIds].sort(),
  fileManifest: [...identity.fileManifest]
    .map((file) => ({
      ...file,
      candidateIds: [...file.candidateIds].sort(),
    }))
    .sort((left, right) => left.repoPath.localeCompare(right.repoPath)),
  coverage: {
    ...identity.coverage,
    failures: [...identity.coverage.failures]
      .sort((left, right) => `${left.repoPath}:${left.kind}:${left.code ?? ''}`
        .localeCompare(`${right.repoPath}:${right.kind}:${right.code ?? ''}`)),
  },
});

const sameIdentity = (stored: StoredSnapshotManifest, expected: SnapshotManifestIdentity): boolean => {
  const normalized = normalizedIdentity(expected);
  return stored.schemaVersion === 3
    && (stored.status === 'building' || stored.status === 'published')
    && stored.workspaceId === normalized.workspaceId
    && stored.indexKey === normalized.indexKey
    && stored.providerFingerprint === normalized.providerFingerprint
    && JSON.stringify(stored.candidateIds) === JSON.stringify(normalized.candidateIds)
    && JSON.stringify(stored.fileManifest) === JSON.stringify(normalized.fileManifest)
    && JSON.stringify(stored.coverage) === JSON.stringify(normalized.coverage);
};

export interface SnapshotFileRename {
  readonly from: string;
  readonly to: string;
  readonly sourceDigest: string;
}

export interface SnapshotFileDelta {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly deleted: readonly string[];
  readonly renamed: readonly SnapshotFileRename[];
  readonly unchanged: readonly string[];
}

const sameFileIdentity = (left: IndexFileIdentity, right: IndexFileIdentity): boolean =>
  left.sourceDigest === right.sourceDigest
  && JSON.stringify([...left.candidateIds].sort()) === JSON.stringify([...right.candidateIds].sort());

export const diffSnapshotFileManifests = (
  previous: readonly IndexFileIdentity[],
  current: readonly IndexFileIdentity[],
): SnapshotFileDelta => {
  const oldByPath = new Map(previous.map((file) => [file.repoPath, file] as const));
  const newByPath = new Map(current.map((file) => [file.repoPath, file] as const));
  const unchanged: string[] = [];
  const changed: string[] = [];
  const deletedCandidates: IndexFileIdentity[] = [];
  const addedCandidates: IndexFileIdentity[] = [];

  for (const oldFile of previous) {
    const next = newByPath.get(oldFile.repoPath);
    if (next === undefined) deletedCandidates.push(oldFile);
    else if (sameFileIdentity(oldFile, next)) unchanged.push(oldFile.repoPath);
    else changed.push(oldFile.repoPath);
  }
  for (const newFile of current) {
    if (!oldByPath.has(newFile.repoPath)) addedCandidates.push(newFile);
  }

  const oldByDigest = new Map<string, IndexFileIdentity[]>();
  const newByDigest = new Map<string, IndexFileIdentity[]>();
  for (const file of deletedCandidates) oldByDigest.set(file.sourceDigest, [...(oldByDigest.get(file.sourceDigest) ?? []), file]);
  for (const file of addedCandidates) newByDigest.set(file.sourceDigest, [...(newByDigest.get(file.sourceDigest) ?? []), file]);

  const renamed: SnapshotFileRename[] = [];
  const renamedFrom = new Set<string>();
  const renamedTo = new Set<string>();
  for (const [digest, oldFiles] of oldByDigest) {
    const newFiles = newByDigest.get(digest) ?? [];
    if (oldFiles.length !== 1 || newFiles.length !== 1) continue;
    const from = oldFiles[0];
    const to = newFiles[0];
    if (from === undefined || to === undefined) continue;
    renamed.push({ from: from.repoPath, to: to.repoPath, sourceDigest: digest });
    renamedFrom.add(from.repoPath);
    renamedTo.add(to.repoPath);
  }

  return {
    added: addedCandidates.map((file) => file.repoPath).filter((path) => !renamedTo.has(path)).sort(),
    changed: changed.sort(),
    deleted: deletedCandidates.map((file) => file.repoPath).filter((path) => !renamedFrom.has(path)).sort(),
    renamed: renamed.sort((left, right) => left.from.localeCompare(right.from)),
    unchanged: unchanged.sort(),
  };
};

export const makeFileQdrantSnapshotState = async (
  rootPath: string,
  options: FileQdrantSnapshotStateOptions = {},
): Promise<FileQdrantSnapshotState> => {
  const manifestsRoot = join(rootPath, 'manifests');
  const leasesRoot = join(rootPath, 'leases');
  await mkdir(manifestsRoot, { recursive: true });
  await mkdir(leasesRoot, { recursive: true });
  const locksRoot = join(leasesRoot, '.locks');
  await mkdir(locksRoot, { recursive: true });
  const stateOwnerId = await readOrCreateStateOwnerId(rootPath);
  const leaseReapMode = options.leaseReapMode ?? 'conservative';

  const readDirectory = options.readDirectory ?? ((path: string, withFileTypes = false) =>
    withFileTypes
      ? readdir(path, { withFileTypes: true })
      : readdir(path));
  const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

  const manifestPath = (workspaceId: WorkspaceId, indexKey: string): string =>
    join(manifestsRoot, workspaceKey(workspaceId), `${indexKey}.json`);
  const leasePath = (workspaceId: WorkspaceId, indexKey: string): string =>
    join(leasesRoot, workspaceKey(workspaceId), indexKey);

  const leaseLockPath = (workspaceId: WorkspaceId): string =>
    join(locksRoot, `${workspaceKey(workspaceId)}.lock`);

  const withLeaseLock = async <T>(
    workspaceId: WorkspaceId,
    action: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> => {
    const lockPath = leaseLockPath(workspaceId);
    let acquired = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await mkdir(lockPath);
        acquired = true;
        break;
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          return err(domainError('PERSISTENCE_FAILED', 'snapshot_lease', 'could not acquire snapshot lease mutation fence'));
        }
        await delay(5);
      }
    }
    if (!acquired) {
      return err(domainError(
        'PERSISTENCE_FAILED',
        'snapshot_lease',
        'snapshot lease mutation fence remained held; refusing an unsafe concurrent decision',
      ));
    }

    let result: Result<T, DomainError>;
    try {
      result = await action();
    } catch {
      result = err(domainError('PERSISTENCE_FAILED', 'snapshot_lease', 'snapshot lease mutation failed'));
    }
    try {
      await rmdir(lockPath);
    } catch {
      return err(domainError('PERSISTENCE_FAILED', 'snapshot_lease', 'could not release snapshot lease mutation fence'));
    }
    return result;
  };

  const removeEmptyLeaseDirectory = async (directory: string): Promise<boolean> => {
    await options.beforeLeaseDirectoryRemoval?.(directory);
    try {
      await rmdir(directory);
      return true;
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return true;
      if (code === 'ENOTEMPTY' || code === 'EEXIST') return false;
      throw cause;
    }
  };

  const readLeaseNames = async (directory: string): Promise<readonly string[]> => {
    try {
      const entries = await readDirectory(directory, false);
      return entries.filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.json'));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
  };

  const inspectActiveIndexKeys = async (workspaceId: WorkspaceId): Promise<ReadonlySet<string>> => {
    const root = join(leasesRoot, workspaceKey(workspaceId));
    let keys: readonly (string | SnapshotDirectoryEntry)[];
    try {
      keys = await readDirectory(root, true);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return new Set<string>();
      throw cause;
    }
    const active = new Set<string>();
    for (const entry of keys) {
      if (typeof entry === 'string' || !entry.isDirectory() || !validIndexKey(entry.name)) continue;
      const directory = join(root, entry.name);
      const leases = await readLeaseNames(directory);
      let hasLiveOrUnknownLease = false;
      for (const name of leases) {
        const path = join(directory, name);
        let stored: StoredSnapshotLease;
        try {
          stored = JSON.parse(await readFile(path, 'utf8')) as StoredSnapshotLease;
        } catch {
          throw new Error('could not parse snapshot lease while deciding whether Qdrant data is safe to prune');
        }
        if (stored.schemaVersion !== 1
          || stored.workspaceId !== workspaceId
          || stored.indexKey !== entry.name
          || stored.leaseId.trim().length === 0
          || !Number.isSafeInteger(stored.processId)
          || stored.processId <= 0
          || !Number.isSafeInteger(stored.acquiredAtMs)
          || stored.acquiredAtMs < 0) {
          throw new Error('invalid snapshot lease identity; refusing unsafe garbage collection');
        }
        const status = (options.processStatus ?? defaultProcessStatus)(stored.processId);
        if (leaseReapMode === 'local-process' && status === 'dead') {
          await rm(path, { force: true });
        } else {
          // Conservative mode intentionally retains even apparently-dead
          // PIDs because PID liveness is not portable across containers,
          // hosts or PID namespaces. A leaked snapshot is safer than
          // deleting data under an active remote reader.
          hasLiveOrUnknownLease = true;
        }
      }
      if (hasLiveOrUnknownLease) {
        active.add(entry.name);
      } else if (!(await removeEmptyLeaseDirectory(directory))) {
        // A legacy writer or an operator may have populated the directory
        // outside this process. Treat an observed non-empty directory as
        // active instead of pruning on a stale empty observation.
        active.add(entry.name);
      }
    }
    return active;
  };

  const validate = (identity: SnapshotManifestIdentity): Result<SnapshotManifestIdentity, DomainError> => {
    if (!validIndexKey(identity.indexKey) || !/^[a-f0-9]{64}$/u.test(identity.providerFingerprint)) {
      return err(domainError('INVALID_INPUT', 'snapshot_identity', 'snapshot keys and provider fingerprint must be SHA-256 hex'));
    }
    const paths = new Set<string>();
    const candidateIds = new Set(identity.candidateIds);
    for (const file of identity.fileManifest) {
      if (paths.has(file.repoPath)
        || !/^[a-f0-9]{64}$/u.test(file.sourceDigest)
        || file.candidateIds.some((candidateId) => !candidateIds.has(candidateId))
        || new Set(file.candidateIds).size !== file.candidateIds.length) {
        return err(domainError(
          'INVALID_INPUT',
          'snapshot_file_manifest',
          'file manifest requires unique paths, SHA-256 digests, and candidate IDs belonging to the snapshot',
        ));
      }
      paths.add(file.repoPath);
    }
    return ok(normalizedIdentity(identity));
  };

  const writeManifest = async (
    identity: SnapshotManifestIdentity,
    status: StoredSnapshotManifest['status'],
  ): Promise<Result<void, DomainError>> => {
    const checked = validate(identity);
    if (checked._tag === 'Err') return checked;
    const path = manifestPath(identity.workspaceId, identity.indexKey);
    await mkdir(join(manifestsRoot, workspaceKey(identity.workspaceId)), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    const stored: StoredSnapshotManifest = {
      ...checked.value,
      schemaVersion: 3,
      status,
      updatedAtMs: options.nowMs?.() ?? Date.now(),
    };
    try {
      await writeFile(temporary, JSON.stringify(stored), { flag: 'wx' });
      await rename(temporary, path);
      return ok(undefined);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      return err(domainError('PERSISTENCE_FAILED', 'snapshot_manifest', 'could not atomically persist Qdrant snapshot manifest'));
    }
  };

  const readManifest = async (
    identity: SnapshotManifestIdentity,
  ): Promise<Result<StoredSnapshotManifest | undefined, DomainError>> => {
    try {
      return ok(JSON.parse(await readFile(manifestPath(identity.workspaceId, identity.indexKey), 'utf8')) as StoredSnapshotManifest);
    } catch (cause) {
      return (cause as NodeJS.ErrnoException).code === 'ENOENT'
        ? ok(undefined)
        : err(domainError('PERSISTENCE_FAILED', 'snapshot_manifest', 'could not read Qdrant snapshot manifest'));
    }
  };

  return {
    stateOwnerId,
    isPublished: async (identity) => {
      const checked = validate(identity);
      if (checked._tag === 'Err') return checked;
      try {
        const stored = JSON.parse(await readFile(manifestPath(identity.workspaceId, identity.indexKey), 'utf8')) as StoredSnapshotManifest;
        return ok(stored.status === 'published' && sameIdentity(stored, checked.value));
      } catch (cause) {
        return (cause as NodeJS.ErrnoException).code === 'ENOENT'
          ? ok(false)
          : err(domainError('PERSISTENCE_FAILED', 'snapshot_manifest', 'could not inspect Qdrant snapshot manifest'));
      }
    },
    latestPublished: async (workspaceId, providerFingerprint, excludeIndexKey) => {
      if (!/^[a-f0-9]{64}$/u.test(providerFingerprint)) {
        return err(domainError('INVALID_INPUT', 'provider_fingerprint', 'provider fingerprint must be SHA-256 hex'));
      }
      const root = join(manifestsRoot, workspaceKey(workspaceId));
      try {
        const entries = (await readdir(root)).filter((entry) => entry.endsWith('.json')).sort();
        let latest: StoredSnapshotManifest | undefined;
        for (const entry of entries) {
          const stored = JSON.parse(await readFile(join(root, entry), 'utf8')) as StoredSnapshotManifest;
          if (stored.schemaVersion !== 3 || stored.status !== 'published'
            || stored.workspaceId !== workspaceId
            || stored.providerFingerprint !== providerFingerprint
            || stored.indexKey === excludeIndexKey
            || !validIndexKey(stored.indexKey)) continue;
          if (latest === undefined || stored.updatedAtMs > latest.updatedAtMs) latest = stored;
        }
        if (latest === undefined) return ok(undefined);
        return ok({
          workspaceId: latest.workspaceId,
          indexKey: latest.indexKey,
          candidateIds: latest.candidateIds,
          fileManifest: latest.fileManifest,
          coverage: latest.coverage,
          providerFingerprint: latest.providerFingerprint,
        });
      } catch (cause) {
        return (cause as NodeJS.ErrnoException).code === 'ENOENT'
          ? ok(undefined)
          : err(domainError('PERSISTENCE_FAILED', 'snapshot_manifest', 'could not enumerate published Qdrant manifests'));
      }
    },
    beginBuild: async (identity) => {
      const checked = validate(identity);
      if (checked._tag === 'Err') return checked;
      const existing = await readManifest(checked.value);
      if (existing._tag === 'Err') return existing;
      if (existing.value !== undefined) {
        if (!sameIdentity(existing.value, checked.value)) {
          return err(domainError('PERSISTENCE_FAILED', 'snapshot_manifest', 'snapshot manifest identity collision refuses overwrite'));
        }
        // A concurrent writer may have already published this exact snapshot.
        // Never demote it back to building, which would make warm reuse racey.
        return ok(undefined);
      }
      return writeManifest(checked.value, 'building');
    },
    publish: async (identity) => {
      const checked = validate(identity);
      if (checked._tag === 'Err') return checked;
      const existing = await readManifest(checked.value);
      if (existing._tag === 'Err') return existing;
      if (existing.value === undefined) {
        return err(domainError('PERSISTENCE_FAILED', 'snapshot_manifest', 'cannot publish a snapshot that was never staged'));
      }
      if (!sameIdentity(existing.value, checked.value)) {
        return err(domainError('PERSISTENCE_FAILED', 'snapshot_manifest', 'snapshot manifest identity does not match staged build'));
      }
      if (existing.value.status === 'published') return ok(undefined);
      return writeManifest(checked.value, 'published');
    },
    acquireLease: async (workspaceId, indexKey) => {
      if (!validIndexKey(indexKey)) {
        return err(domainError('INVALID_INPUT', 'index_key', 'snapshot lease requires a SHA-256 index key'));
      }
      return withLeaseLock(workspaceId, async () => {
        const directory = leasePath(workspaceId, indexKey);
        await mkdir(directory, { recursive: true });
        const leaseId = randomUUID();
        const path = join(directory, `${leaseId}.json`);
        try {
          const stored: StoredSnapshotLease = {
            schemaVersion: 1,
            workspaceId,
            indexKey,
            leaseId,
            processId: options.processId ?? process.pid,
            acquiredAtMs: options.nowMs?.() ?? Date.now(),
          };
          await writeFile(path, JSON.stringify(stored), { flag: 'wx' });
        } catch {
          return err(domainError('PERSISTENCE_FAILED', 'snapshot_lease', 'could not acquire Qdrant snapshot lease'));
        }
        let closed = false;
        return ok({
          leaseId,
          indexKey,
          close: async () => {
            if (closed) return;
            closed = true;
            const closedResult = await withLeaseLock(workspaceId, async () => {
              try {
                await rm(path, { force: true });
                await removeEmptyLeaseDirectory(directory);
                return ok(undefined);
              } catch {
                return err(domainError('PERSISTENCE_FAILED', 'snapshot_lease', 'could not close Qdrant snapshot lease'));
              }
            });
            if (closedResult._tag === 'Err') throw new Error(closedResult.error.message);
          },
        });
      });
    },
    activeIndexKeys: async (workspaceId) => withLeaseLock(workspaceId, async () => {
      try {
        return ok(await inspectActiveIndexKeys(workspaceId));
      } catch {
        return err(domainError('PERSISTENCE_FAILED', 'snapshot_lease', 'could not inspect Qdrant snapshot leases'));
      }
    }),
    withActiveIndexKeys: async (workspaceId, action) => withLeaseLock(workspaceId, async () => {
      try {
        return await action(await inspectActiveIndexKeys(workspaceId));
      } catch {
        return err(domainError('PERSISTENCE_FAILED', 'snapshot_lease', 'could not inspect Qdrant snapshot leases'));
      }
    }),
  };
};
