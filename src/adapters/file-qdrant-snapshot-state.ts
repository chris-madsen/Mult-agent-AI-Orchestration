import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { IndexCoverageSummary } from '../domain/retrieval.js';
import type { WorkspaceId } from '../domain/workspace.js';

export interface SnapshotManifestIdentity {
  readonly workspaceId: WorkspaceId;
  readonly indexKey: string;
  readonly candidateIds: readonly string[];
  readonly coverage: IndexCoverageSummary;
  readonly providerFingerprint: string;
}

interface StoredSnapshotManifest extends SnapshotManifestIdentity {
  readonly schemaVersion: 2;
  readonly status: 'building' | 'published';
  readonly updatedAtMs: number;
}

export interface SnapshotLease {
  readonly leaseId: string;
  readonly indexKey: string;
  readonly close: () => Promise<void>;
}

export interface FileQdrantSnapshotState {
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
}

const validIndexKey = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const workspaceKey = (workspaceId: WorkspaceId): string =>
  createHash('sha256').update(workspaceId).digest('hex').slice(0, 32);

const normalizedIdentity = (identity: SnapshotManifestIdentity): SnapshotManifestIdentity => ({
  ...identity,
  candidateIds: [...identity.candidateIds].sort(),
  coverage: {
    ...identity.coverage,
    failures: [...identity.coverage.failures]
      .sort((left, right) => `${left.repoPath}:${left.kind}:${left.code ?? ''}`
        .localeCompare(`${right.repoPath}:${right.kind}:${right.code ?? ''}`)),
  },
});

const sameIdentity = (stored: StoredSnapshotManifest, expected: SnapshotManifestIdentity): boolean => {
  const normalized = normalizedIdentity(expected);
  return stored.schemaVersion === 2
    && stored.workspaceId === normalized.workspaceId
    && stored.indexKey === normalized.indexKey
    && stored.providerFingerprint === normalized.providerFingerprint
    && JSON.stringify(stored.candidateIds) === JSON.stringify(normalized.candidateIds)
    && JSON.stringify(stored.coverage) === JSON.stringify(normalized.coverage);
};

export const makeFileQdrantSnapshotState = async (rootPath: string): Promise<FileQdrantSnapshotState> => {
  const manifestsRoot = join(rootPath, 'manifests');
  const leasesRoot = join(rootPath, 'leases');
  await mkdir(manifestsRoot, { recursive: true });
  await mkdir(leasesRoot, { recursive: true });

  const manifestPath = (workspaceId: WorkspaceId, indexKey: string): string =>
    join(manifestsRoot, workspaceKey(workspaceId), `${indexKey}.json`);
  const leasePath = (workspaceId: WorkspaceId, indexKey: string): string =>
    join(leasesRoot, workspaceKey(workspaceId), indexKey);

  const validate = (identity: SnapshotManifestIdentity): Result<SnapshotManifestIdentity, DomainError> =>
    validIndexKey(identity.indexKey) && /^[a-f0-9]{64}$/u.test(identity.providerFingerprint)
      ? ok(normalizedIdentity(identity))
      : err(domainError('INVALID_INPUT', 'snapshot_identity', 'snapshot keys and provider fingerprint must be SHA-256 hex'));

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
      schemaVersion: 2,
      status,
      updatedAtMs: Date.now(),
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

  return {
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
          if (stored.schemaVersion !== 2 || stored.status !== 'published'
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
          coverage: latest.coverage,
          providerFingerprint: latest.providerFingerprint,
        });
      } catch (cause) {
        return (cause as NodeJS.ErrnoException).code === 'ENOENT'
          ? ok(undefined)
          : err(domainError('PERSISTENCE_FAILED', 'snapshot_manifest', 'could not enumerate published Qdrant manifests'));
      }
    },
    beginBuild: (identity) => writeManifest(identity, 'building'),
    publish: (identity) => writeManifest(identity, 'published'),
    acquireLease: async (workspaceId, indexKey) => {
      if (!validIndexKey(indexKey)) {
        return err(domainError('INVALID_INPUT', 'index_key', 'snapshot lease requires a SHA-256 index key'));
      }
      const directory = leasePath(workspaceId, indexKey);
      await mkdir(directory, { recursive: true });
      const leaseId = randomUUID();
      const path = join(directory, `${leaseId}.json`);
      try {
        await writeFile(path, JSON.stringify({
          schemaVersion: 1,
          workspaceId,
          indexKey,
          leaseId,
          processId: process.pid,
          acquiredAtMs: Date.now(),
        }), { flag: 'wx' });
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
          await rm(path, { force: true });
          const remaining = await readdir(directory).catch(() => [] as string[]);
          if (remaining.length === 0) await rm(directory, { recursive: true, force: true });
        },
      });
    },
    activeIndexKeys: async (workspaceId) => {
      const root = join(leasesRoot, workspaceKey(workspaceId));
      try {
        const keys = await readdir(root, { withFileTypes: true });
        const active = new Set<string>();
        for (const entry of keys) {
          if (!entry.isDirectory() || !validIndexKey(entry.name)) continue;
          const leases = await readdir(join(root, entry.name)).catch(() => [] as string[]);
          if (leases.some((name) => name.endsWith('.json'))) active.add(entry.name);
        }
        return ok(active);
      } catch (cause) {
        return (cause as NodeJS.ErrnoException).code === 'ENOENT'
          ? ok(new Set<string>())
          : err(domainError('PERSISTENCE_FAILED', 'snapshot_lease', 'could not inspect Qdrant snapshot leases'));
      }
    },
  };
};
