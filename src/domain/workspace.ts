import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };
export type RepoPath = string & { readonly __brand: 'RepoPath' };
export type ContentDigest = string & { readonly __brand: 'ContentDigest' };

export type FileState = 'tracked' | 'untracked' | 'deleted' | 'unknown';

export interface FileObservation {
  readonly repoPath: RepoPath;
  readonly digest: ContentDigest;
  readonly sizeBytes: number;
  readonly state: FileState;
  readonly observedAtMs: number;
}

export interface WorkingTreeVersion {
  readonly headRevision: string;
  readonly observationEpoch: number;
  readonly files: readonly FileObservation[];
  readonly removedPaths: readonly RepoPath[];
}

export interface WorkspaceRecord {
  readonly workspaceId: WorkspaceId;
  readonly rootPath: string;
  readonly observationEpoch: number;
  readonly createdAtMs: number;
  readonly lastObservation?: WorkingTreeVersion;
}

export interface WorkspaceSnapshot {
  readonly headRevision: string;
  readonly files: readonly FileObservation[];
  readonly removedPaths: readonly RepoPath[];
}

export const makeWorkspaceId = (value: string): Result<WorkspaceId, DomainError> =>
  value.trim().length === 0
    ? err(domainError('INVALID_INPUT', 'workspace_id', 'workspace id must not be empty'))
    : ok(value.trim() as WorkspaceId);

export const makeContentDigest = (value: string): Result<ContentDigest, DomainError> =>
  /^[a-f0-9]{64}$/.test(value)
    ? ok(value as ContentDigest)
    : err(domainError('INVALID_INPUT', 'content_digest', 'expected a lowercase SHA-256 digest'));

export const ingestRepoPath = (value: unknown): Result<RepoPath, DomainError> => {
  if (typeof value !== 'string' || value.length === 0) {
    return err(domainError('INVALID_INPUT', 'repo_path', 'repo path must be a non-empty string'));
  }
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/')) {
    return err(domainError('PATH_ESCAPE', 'repo_path', 'repo path must be a relative POSIX path'));
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.' || segment.length === 0)) {
    return err(domainError('PATH_ESCAPE', 'repo_path', 'repo path contains an unsafe segment'));
  }
  return ok(value as RepoPath);
};

export const makeWorkingTreeVersion = (
  headRevision: string,
  observationEpoch: number,
  files: readonly FileObservation[],
  removedPaths: readonly RepoPath[] = [],
): Result<WorkingTreeVersion, DomainError> => {
  if (observationEpoch < 1 || !Number.isSafeInteger(observationEpoch)) {
    return err(domainError('INVALID_INPUT', 'observation_epoch', 'observation epoch must be a positive integer'));
  }
  return ok({ headRevision, observationEpoch, files: [...files], removedPaths: [...removedPaths] });
};
