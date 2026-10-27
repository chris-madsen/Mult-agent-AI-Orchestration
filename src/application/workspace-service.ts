import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, isErr, isOk, ok, type Result } from '../domain/result.js';
import {
  ingestRepoPath,
  makeContentDigest,
  makeWorkspaceId,
  makeWorkingTreeVersion,
  type WorkspaceId,
  type WorkspaceRecord,
} from '../domain/workspace.js';
import type { ClockPort, IdPort, WorkspaceFilePort, WorkspaceStore } from './ports.js';

export interface WorkspaceServicePorts {
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly files: WorkspaceFilePort;
  readonly store: WorkspaceStore;
}

export interface RegisterWorkspaceInput {
  readonly rootPath: unknown;
}

const getWorkspace = (
  store: WorkspaceStore,
  workspaceId: WorkspaceId,
): Effect.Effect<Result<WorkspaceRecord, DomainError>> => store.get(workspaceId);

const sameWorkingTreeObservation = (
  left: NonNullable<WorkspaceRecord['lastObservation']> | undefined,
  right: NonNullable<WorkspaceRecord['lastObservation']> | undefined,
): boolean => {
  if (left === undefined || right === undefined) return false;
  if (left.headRevision !== right.headRevision || left.removedPaths.length !== right.removedPaths.length
    || left.files.length !== right.files.length) return false;
  const leftFiles = [...left.files].sort((a, b) => a.repoPath.localeCompare(b.repoPath));
  const rightFiles = [...right.files].sort((a, b) => a.repoPath.localeCompare(b.repoPath));
  return left.removedPaths.every((repoPath, index) => repoPath === right.removedPaths[index])
    && leftFiles.every((file, index) => {
      const other = rightFiles[index];
      return other !== undefined
        && file.repoPath === other.repoPath
        && file.digest === other.digest
        && file.sizeBytes === other.sizeBytes
        && file.state === other.state;
    });
};

export const registerWorkspace = (
  ports: WorkspaceServicePorts,
  input: RegisterWorkspaceInput,
): Effect.Effect<Result<WorkspaceRecord, DomainError>> =>
  Effect.gen(function* () {
    if (typeof input.rootPath !== 'string' || input.rootPath.trim().length === 0) {
      return err(domainError('INVALID_INPUT', 'root_path', 'root path must be a non-empty string'));
    }
    const canonical = yield* ports.files.canonicalizeRoot(input.rootPath);
    if (isErr(canonical)) return canonical;
    const existing = yield* ports.store.findByRoot(canonical.value);
    if (isErr(existing)) return existing;
    if (existing.value !== undefined) return ok(existing.value);

    const workspaceIdResult = makeWorkspaceId(ports.ids.newWorkspaceId());
    if (isErr(workspaceIdResult)) return workspaceIdResult;
    const record: WorkspaceRecord = {
      workspaceId: workspaceIdResult.value,
      rootPath: canonical.value,
      observationEpoch: 0,
      createdAtMs: ports.clock.nowMs(),
    };
    const saved = yield* ports.store.save(record);
    if (isErr(saved)) return saved;
    return ok(record);
  });

export const observeWorkspace = (
  ports: WorkspaceServicePorts,
  workspaceId: WorkspaceId,
): Effect.Effect<Result<WorkspaceRecord, DomainError>> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = yield* getWorkspace(ports.store, workspaceId);
      if (isErr(current)) return current;
      const observedAtMs = ports.clock.nowMs();
      const snapshot = yield* ports.files.snapshot(current.value.rootPath, observedAtMs);
      if (isErr(snapshot)) return snapshot;
      const nextEpoch = current.value.observationEpoch + 1;
      const version = makeWorkingTreeVersion(
        snapshot.value.headRevision,
        nextEpoch,
        snapshot.value.files,
        snapshot.value.removedPaths,
        snapshot.value.gitStatus,
      );
      if (isErr(version)) return version;
      const updated: WorkspaceRecord = {
        ...current.value,
        observationEpoch: nextEpoch,
        lastObservation: version.value,
      };
      const saved = yield* ports.store.save(updated);
      if (isOk(saved)) return ok(updated);
      if (saved.error.code !== 'WORKTREE_RACED') return saved;
      const latest = yield* getWorkspace(ports.store, workspaceId);
      if (isErr(latest)) return latest;
      if (sameWorkingTreeObservation(latest.value.lastObservation, version.value)) return ok(latest.value);
      if (attempt === 2) return saved;
    }
    return err(domainError('WORKTREE_RACED', 'observation_epoch', 'workspace observation could not converge after concurrent updates'));
  });

export const readVerified = (
  ports: WorkspaceServicePorts,
  workspaceId: WorkspaceId,
  rawRepoPath: unknown,
  expectedDigest: unknown,
): Effect.Effect<Result<{ readonly bytes: Uint8Array; readonly digest: string }, DomainError>> =>
  Effect.gen(function* () {
    const current = yield* getWorkspace(ports.store, workspaceId);
    if (isErr(current)) return current;
    const repoPath = ingestRepoPath(rawRepoPath);
    if (isErr(repoPath)) return repoPath;
    if (typeof expectedDigest !== 'string') {
      return err(domainError('INVALID_INPUT', 'expected_digest', 'expected digest must be a string'));
    }
    const digest = makeContentDigest(expectedDigest);
    if (isErr(digest)) return digest;
    const read = yield* ports.files.readExact(current.value.rootPath, repoPath.value);
    if (isErr(read)) return read;
    if (read.value.digest !== digest.value) {
      return err(
        domainError('DIGEST_MISMATCH', 'expected_digest', 'source changed since the expected digest was observed', {
          expected: digest.value,
          actual: read.value.digest,
        }),
      );
    }
    return ok({ bytes: read.value.bytes, digest: read.value.digest });
  });

export const workspaceIdFrom = (value: string): Result<WorkspaceId, DomainError> => makeWorkspaceId(value);
