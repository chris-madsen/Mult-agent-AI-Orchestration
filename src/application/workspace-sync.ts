import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { CandidateId, RankedCandidate } from '../domain/retrieval.js';
import {
  diffWorkspaceManifests,
  workspaceManifestEqual,
  type WorkspaceManifest,
  type WorkspaceManifestDelta,
} from '../domain/workspace-manifest.js';
import type { RepoPath, WorkspaceId } from '../domain/workspace.js';

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
}

export interface WorkspaceSyncRebuildInput {
  readonly previous: WorkspaceSyncState;
  readonly nextManifest: WorkspaceManifest;
  readonly delta: WorkspaceSyncDelta;
}

export interface WorkspaceSyncOptions {
  readonly initial: WorkspaceSyncState;
  readonly observeChanges: () => Effect.Effect<Result<WorkspaceSyncProbe, DomainError>>;
  readonly rebuild: (
    input: WorkspaceSyncRebuildInput,
  ) => Effect.Effect<Result<WorkspaceSyncState, DomainError>>;
}

export interface WorkspaceSyncProbe {
  readonly changed: boolean;
  readonly manifest?: WorkspaceManifest;
  readonly delta?: WorkspaceSyncDelta;
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
        ? await Effect.runPromise(options.observeChanges())
        : ok({ changed: true, manifest: provided.manifest, delta: provided.delta });
      if (probe._tag === 'Err') return probe;
      if (!probe.value.changed) {
        return ok({
          state: active,
          delta: { changed: [], added: [], deleted: [], renamed: [], scopeChanged: false },
          refreshed: false,
        });
      }
      if (probe.value.manifest === undefined) {
        return err(domainError('NOT_READY', 'workspace_manifest', 'changed workspace has no authoritative manifest'));
      }
      const manifest = probe.value.manifest;
      const delta = probe.value.delta ?? diffWorkspaceManifests(active.workspaceManifest, manifest);
      if (workspaceManifestEqual(active.workspaceManifest, manifest)) {
        return ok({ state: active, delta, refreshed: false });
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
      return ok({ state: active, delta, refreshed: true });
    })),
  };
};
