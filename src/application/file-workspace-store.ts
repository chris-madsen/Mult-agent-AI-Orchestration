import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { Effect } from 'effect';
import { domainError } from '../domain/errors.js';
import { err, isErr, ok, type Result } from '../domain/result.js';
import {
  ingestRepoPath,
  makeContentDigest,
  makeWorkspaceId,
  type FileObservation,
  type RepoPath,
  type WorkspaceId,
  type WorkspaceRecord,
} from '../domain/workspace.js';
import type { WorkspaceStore } from './ports.js';
import type { DomainError } from '../domain/errors.js';
import { recoverResult } from './effect-result.js';

interface PersistedState {
  readonly schemaVersion: 1;
  readonly workspaces: readonly WorkspaceRecord[];
}

const emptyState: PersistedState = { schemaVersion: 1, workspaces: [] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const nodeErrorCode = (cause: unknown): string | undefined => {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined;
  const code = cause.code;
  return typeof code === 'string' ? code : undefined;
};

const parseWorkingTreeVersion = (value: unknown): NonNullable<WorkspaceRecord['lastObservation']> | undefined => {
  if (!isRecord(value) || typeof value.headRevision !== 'string' || typeof value.observationEpoch !== 'number' || !Number.isSafeInteger(value.observationEpoch)) return undefined;
  if (!Array.isArray(value.files) || !Array.isArray(value.removedPaths)) return undefined;
  const files: FileObservation[] = [];
  for (const item of value.files) {
    if (!isRecord(item) || typeof item.repoPath !== 'string' || typeof item.digest !== 'string' || typeof item.sizeBytes !== 'number' || typeof item.observedAtMs !== 'number') return undefined;
    const repoPath = ingestRepoPath(item.repoPath);
    const digest = makeContentDigest(item.digest);
    if (repoPath._tag === 'Err' || digest._tag === 'Err' || item.sizeBytes < 0 || !Number.isSafeInteger(item.sizeBytes)) return undefined;
    if (item.mtimeMs !== undefined && (typeof item.mtimeMs !== 'number' || !Number.isFinite(item.mtimeMs))) return undefined;
    const state = item.state;
    if (state !== 'tracked' && state !== 'untracked' && state !== 'deleted' && state !== 'unknown') return undefined;
    files.push({
      repoPath: repoPath.value,
      digest: digest.value,
      sizeBytes: item.sizeBytes,
      ...(item.mtimeMs === undefined ? {} : { mtimeMs: item.mtimeMs }),
      state,
      observedAtMs: item.observedAtMs,
    });
  }
  const removedPaths: RepoPath[] = [];
  for (const item of value.removedPaths) {
    if (typeof item !== 'string') return undefined;
    const repoPath = ingestRepoPath(item);
    if (repoPath._tag === 'Err') return undefined;
    removedPaths.push(repoPath.value);
  }
  const gitStatus = value.gitStatus;
  if (gitStatus !== undefined && gitStatus !== 'available' && gitStatus !== 'not_repository') return undefined;
  return {
    headRevision: value.headRevision,
    observationEpoch: value.observationEpoch,
    files,
    removedPaths,
    ...(gitStatus === undefined ? {} : { gitStatus }),
  };
};

const parseState = (value: unknown): Result<PersistedState, ReturnType<typeof domainError>> => {
  if (!isRecord(value)) return err(domainError('PERSISTENCE_FAILED', 'state', 'state must be an object'));
  const record = value;
  if (record.schemaVersion !== 1 || !Array.isArray(record.workspaces)) {
    return err(domainError('PERSISTENCE_FAILED', 'state', 'unsupported workspace state schema'));
  }
  const workspaces: WorkspaceRecord[] = [];
  for (const item of record.workspaces) {
    if (!isRecord(item)) return err(domainError('PERSISTENCE_FAILED', 'workspaces', 'invalid workspace record'));
    const candidate = item;
    const id = typeof candidate.workspaceId === 'string' ? makeWorkspaceId(candidate.workspaceId) : err(domainError('PERSISTENCE_FAILED', 'workspace_id', 'invalid workspace id'));
    if (isErr(id) || typeof candidate.rootPath !== 'string' || typeof candidate.observationEpoch !== 'number' || typeof candidate.createdAtMs !== 'number') {
      return err(domainError('PERSISTENCE_FAILED', 'workspaces', 'invalid workspace record'));
    }
    const lastObservation = candidate.lastObservation === undefined ? undefined : parseWorkingTreeVersion(candidate.lastObservation);
    if (candidate.lastObservation !== undefined && lastObservation === undefined) {
      return err(domainError('PERSISTENCE_FAILED', 'last_observation', 'invalid workspace observation'));
    }
    const workspace: WorkspaceRecord = {
      workspaceId: id.value,
      rootPath: candidate.rootPath,
      observationEpoch: candidate.observationEpoch,
      createdAtMs: candidate.createdAtMs,
    };
    workspaces.push(
      lastObservation === undefined
        ? workspace
        : { ...workspace, lastObservation },
    );
  }
  return ok({ schemaVersion: 1, workspaces });
};

export const makeFileWorkspaceStore = (statePath: string): WorkspaceStore => {
  const lockPath = `${statePath}.write-lock`;
  const sleep = (milliseconds: number): Promise<void> =>
    new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); });
  // mkdir is atomic across independent Node processes on the same local FS.
  // Never steal a suspected stale lock: an ambiguous writer must fail closed.
  const withWriteFence = async <T>(operation: () => Promise<T>): Promise<T> => {
    await mkdir(dirname(statePath), { recursive: true });
    const deadline = Date.now() + 20_000;
    while (true) {
      try {
        await mkdir(lockPath);
        break;
      } catch (cause) {
        if (nodeErrorCode(cause) !== 'EEXIST') throw cause;
        if (Date.now() >= deadline) throw new Error('workspace state write fence remained held');
        await sleep(30);
      }
    }
    try {
      return await operation();
    } finally {
      await rmdir(lockPath);
    }
  };
  const load = (): Effect.Effect<Result<PersistedState, ReturnType<typeof domainError>>> =>
    recoverResult(Effect.tryPromise<Result<PersistedState, DomainError>, DomainError>({
      try: async () => {
        try {
          const raw = await readFile(statePath, 'utf8');
          return parseState(JSON.parse(raw));
        } catch (cause) {
          return nodeErrorCode(cause) === 'ENOENT'
            ? ok(emptyState)
            : err(domainError('PERSISTENCE_FAILED', 'state', 'could not read workspace state'));
        }
      },
      catch: () => domainError('PERSISTENCE_FAILED', 'state', 'workspace state read failed'),
    }));

  const saveState = (state: PersistedState): Effect.Effect<Result<void, ReturnType<typeof domainError>>> =>
    recoverResult(Effect.tryPromise<Result<void, DomainError>, DomainError>({
      try: async () => {
        await mkdir(dirname(statePath), { recursive: true });
        const temporary = `${statePath}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        await rename(temporary, statePath);
        return ok<void>(undefined);
      },
      catch: () => domainError('PERSISTENCE_FAILED', 'state', 'workspace state write failed'),
    }));

  return {
    get: (workspaceId: WorkspaceId) =>
      Effect.gen(function* () {
        const state = yield* load();
        if (isErr(state)) return state;
        const record = state.value.workspaces.find((item) => item.workspaceId === workspaceId);
        return record === undefined
          ? err(domainError('WORKSPACE_NOT_FOUND', 'workspace_id', 'workspace is not registered'))
          : ok(record);
      }),
    findByRoot: (rootPath: string) =>
      Effect.gen(function* () {
        const state = yield* load();
        if (isErr(state)) return state;
        return ok(state.value.workspaces.find((item) => item.rootPath === rootPath));
      }),
    save: (record: WorkspaceRecord) =>
      recoverResult(Effect.tryPromise<Result<void, DomainError>, DomainError>({
        try: () => withWriteFence(async () => {
          // Re-read under the cross-process fence. A read-modify-write from
          // before acquiring the lock would still lose concurrent updates.
          const state = await Effect.runPromise(load());
          if (isErr(state)) return state;
          const existing = state.value.workspaces.find((item) => item.workspaceId === record.workspaceId);
          if (existing === undefined) {
            if (record.observationEpoch !== 0
              || state.value.workspaces.some((item) => item.rootPath === record.rootPath)) {
              return err(domainError('WORKTREE_RACED', 'workspace', 'new workspace registration conflicts with committed state'));
            }
          } else if (existing.rootPath !== record.rootPath
            || record.observationEpoch !== existing.observationEpoch + 1) {
            return err(domainError('WORKTREE_RACED', 'observation_epoch', 'workspace update conflicts with a newer persisted observation'));
          }
          const workspaces = state.value.workspaces.filter((item) => item.workspaceId !== record.workspaceId);
          return Effect.runPromise(saveState({ schemaVersion: 1, workspaces: [...workspaces, record] }));
        }),
        catch: () => domainError('PERSISTENCE_FAILED', 'state', 'workspace state mutation or write fence failed'),
      })),
  };
};
