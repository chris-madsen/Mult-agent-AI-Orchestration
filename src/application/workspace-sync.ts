import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { CandidateId, RankedCandidate } from '../domain/retrieval.js';
import type { WorkspaceFilePort } from './ports.js';
import {
  diffWorkspaceManifests,
  workspaceManifestEqual,
  workspaceManifestFromFiles,
  type WorkspaceManifest,
  type WorkspaceManifestDelta,
} from '../domain/workspace-manifest.js';
import type { RepoPath, WorkingContext, WorkspaceId } from '../domain/workspace.js';

export interface WorkspaceSyncState {
  readonly workspaceId: WorkspaceId;
  readonly workspaceManifest: WorkspaceManifest;
  readonly generation: number;
  readonly indexKey: string;
  readonly candidateIdsByPath: ReadonlyMap<RepoPath, readonly CandidateId[]>;
}

export type WorkspaceSyncDelta = WorkspaceManifestDelta;

export interface WorkspaceSyncRefreshResult {
  readonly state: WorkspaceSyncState;
  readonly delta: WorkspaceSyncDelta;
  readonly refreshed: boolean;
  readonly workingContext?: WorkingContext;
}

export interface WorkspaceSyncRebuildInput {
  readonly previous: WorkspaceSyncState;
  readonly nextManifest: WorkspaceManifest;
  readonly delta: WorkspaceSyncDelta;
}

export interface WorkspaceSyncOptions {
  readonly initial: WorkspaceSyncState;
  readonly observeChanges: (current: WorkspaceSyncState) => Effect.Effect<Result<WorkspaceSyncProbe, DomainError>>;
  readonly rebuild: (
    input: WorkspaceSyncRebuildInput,
  ) => Effect.Effect<Result<WorkspaceSyncState, DomainError>>;
}

export interface WorkspaceSyncProbe {
  readonly changed: boolean;
  readonly manifest?: WorkspaceManifest;
  readonly delta?: WorkspaceSyncDelta;
  readonly workingContext?: WorkingContext;
}

export interface WorkspaceSyncObservedManifest {
  readonly manifest: WorkspaceManifest;
  readonly delta?: WorkspaceSyncDelta;
}

export interface WorkspaceSync {
  readonly initialize: () => Effect.Effect<Result<WorkspaceSyncState, DomainError>>;
  readonly refresh: (observed?: WorkspaceSyncObservedManifest) => Effect.Effect<Result<WorkspaceSyncRefreshResult, DomainError>>;
}

const candidateIdsByPath = (
  candidates: readonly RankedCandidate[],
): ReadonlyMap<RepoPath, readonly CandidateId[]> => {
  const result = new Map<RepoPath, CandidateId[]>();
  for (const ranked of candidates) {
    const current = result.get(ranked.candidate.repoPath) ?? [];
    result.set(ranked.candidate.repoPath, [...current, ranked.candidate.candidateId]);
  }
  return result;
};

export const candidateMembershipByPath = candidateIdsByPath;


const emptyDelta = (): WorkspaceSyncDelta => ({
  changed: [], added: [], deleted: [], renamed: [], scopeChanged: false,
});

const deltaHasChanges = (delta: WorkspaceSyncDelta): boolean =>
  delta.scopeChanged || delta.changed.length > 0 || delta.added.length > 0
  || delta.deleted.length > 0 || delta.renamed.length > 0;

export const observeWorkspaceManifest = (
  files: WorkspaceFilePort,
  rootPath: string,
  current: WorkspaceManifest,
  includePath: (repoPath: RepoPath) => boolean = () => true,
): Effect.Effect<Result<WorkspaceSyncProbe, DomainError>> => Effect.gen(function* () {
  const observation = yield* files.observeChanges(rootPath, current.headRevision);
  if (observation._tag === 'Err') return observation;

  const byPath = new Map(current.files.map((file) => [file.repoPath, { ...file }] as const));
  const renameState = new Map<RepoPath, string>();
  for (const entry of observation.value.renamed) {
    if (!includePath(entry.from) && !includePath(entry.to)) continue;
    const prior = byPath.get(entry.from);
    if (prior !== undefined) renameState.set(entry.to, prior.state);
    byPath.delete(entry.from);
  }
  for (const repoPath of observation.value.deletedPaths) {
    if (includePath(repoPath)) byPath.delete(repoPath);
  }

  const deleted = new Set(observation.value.deletedPaths);
  const renamedFrom = new Set(observation.value.renamed.map((entry) => entry.from));
  const untracked = new Set(observation.value.untrackedPaths ?? []);
  const toRead = new Set<RepoPath>([
    ...observation.value.changedPaths,
    ...observation.value.addedPaths,
    ...observation.value.renamed.map((entry) => entry.to),
  ]);

  for (const repoPath of [...toRead].sort()) {
    if (deleted.has(repoPath) || renamedFrom.has(repoPath) || !includePath(repoPath)) continue;
    const exact = yield* files.readExact(rootPath, repoPath);
    if (exact._tag === 'Err') {
      return exact.error.code === 'FILE_NOT_FOUND'
        ? err(domainError('WORKTREE_RACED', 'repo_path', 'workspace path changed after Git observation'))
        : exact;
    }
    const prior = byPath.get(repoPath);
    byPath.set(repoPath, {
      repoPath,
      sourceDigest: exact.value.digest,
      sizeBytes: exact.value.bytes.byteLength,
      state: untracked.has(repoPath) ? 'untracked' : prior?.state ?? renameState.get(repoPath) ?? 'tracked',
    });
  }

  const manifest = workspaceManifestFromFiles({
    headRevision: observation.value.headRevision,
    scopeFingerprint: current.scopeFingerprint,
    files: [...byPath.values()],
    removedPaths: observation.value.deletedPaths,
  });
  const delta = diffWorkspaceManifests(current, manifest);
  return ok({
    changed: manifest.headRevision !== current.headRevision || deltaHasChanges(delta),
    manifest,
    delta,
    workingContext: {
      headRevision: observation.value.headRevision,
      ...(observation.value.branch === undefined ? {} : { branch: observation.value.branch }),
      stagedPaths: observation.value.stagedPaths ?? [],
      unstagedPaths: observation.value.unstagedPaths ?? [],
      untrackedPaths: observation.value.untrackedPaths ?? [],
      deletedPaths: observation.value.deletedPaths,
    },
  });
});

export const makeWorkspaceSync = (options: WorkspaceSyncOptions): WorkspaceSync => {
  let active = options.initial;
  let queue = Promise.resolve();

  const enqueue = <Value>(operation: () => Promise<Result<Value, DomainError>>): Promise<Result<Value, DomainError>> => {
    const run = queue.then(operation, operation);
    queue = run.then(() => undefined, () => undefined);
    return run;
  };

  return {
    initialize: () => Effect.succeed(ok(active)),
    refresh: (provided) => Effect.promise(() => enqueue<WorkspaceSyncRefreshResult>(async () => {
      const probe = provided === undefined
        ? await Effect.runPromise(options.observeChanges(active))
        : ok({ changed: true, manifest: provided.manifest, delta: provided.delta });
      if (probe._tag === 'Err') return probe;
      if (!probe.value.changed) {
        return ok({
          state: active,
          delta: emptyDelta(),
          refreshed: false,
          ...(probe.value.workingContext === undefined ? {} : { workingContext: probe.value.workingContext }),
        });
      }
      if (probe.value.manifest === undefined) {
        return err(domainError('NOT_READY', 'workspace_manifest', 'changed workspace has no authoritative manifest'));
      }
      const manifest = probe.value.manifest;
      const delta = probe.value.delta ?? diffWorkspaceManifests(active.workspaceManifest, manifest);
      if (workspaceManifestEqual(active.workspaceManifest, manifest)) {
        if (active.workspaceManifest.headRevision !== manifest.headRevision) {
          active = { ...active, workspaceManifest: manifest };
        }
        return ok({
          state: active,
          delta,
          refreshed: false,
          ...(probe.value.workingContext === undefined ? {} : { workingContext: probe.value.workingContext }),
        });
      }
      const rebuilt = await Effect.runPromise(options.rebuild({
        previous: active,
        nextManifest: manifest,
        delta,
      }));
      if (rebuilt._tag === 'Err') return rebuilt;
      if (!workspaceManifestEqual(rebuilt.value.workspaceManifest, manifest)) {
        return err(domainError(
          'WORKTREE_RACED',
          'workspace_manifest',
          'workspace changed while rebuilding synchronized context',
        ));
      }
      active = rebuilt.value;
      return ok({
        state: active,
        delta,
        refreshed: true,
        ...(probe.value.workingContext === undefined ? {} : { workingContext: probe.value.workingContext }),
      });
    })),
  };
};
