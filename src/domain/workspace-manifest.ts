import type { ContentDigest, RepoPath, WorkspaceSnapshot } from './workspace.js';

export interface WorkspaceManifestFile {
  readonly repoPath: RepoPath;
  readonly sourceDigest: ContentDigest;
  readonly sizeBytes: number;
  readonly state: string;
}

/**
 * Authoritative working-tree identity used at the request boundary.  It is
 * intentionally independent of watcher delivery: a watcher can wake a
 * reconciler up, but it cannot make an old index current.
 */
export interface WorkspaceManifest {
  readonly schemaVersion: 1;
  readonly scopeFingerprint: string;
  readonly files: readonly WorkspaceManifestFile[];
  readonly removedPaths: readonly RepoPath[];
  readonly contentIdentity: string;
}

const sortedFiles = (files: readonly WorkspaceManifestFile[]): readonly WorkspaceManifestFile[] => [...files]
  .map((file) => ({ ...file }))
  .sort((left, right) => left.repoPath.localeCompare(right.repoPath));

const contentIdentityFor = (
  scopeFingerprint: string,
  files: readonly WorkspaceManifestFile[],
  removedPaths: readonly RepoPath[],
): string => JSON.stringify({
  scopeFingerprint,
  files: sortedFiles(files),
  removedPaths: [...removedPaths].sort(),
});

export const workspaceManifestFromSnapshot = (
  snapshot: WorkspaceSnapshot,
  scopeFingerprint: string,
): WorkspaceManifest => {
  const files = sortedFiles(snapshot.files.map((file) => ({
    repoPath: file.repoPath,
    sourceDigest: file.digest,
    sizeBytes: file.sizeBytes,
    state: file.state,
  })));
  const removedPaths = [...snapshot.removedPaths].sort();
  return {
    schemaVersion: 1,
    scopeFingerprint,
    files,
    removedPaths,
    contentIdentity: contentIdentityFor(scopeFingerprint, files, removedPaths),
  };
};

export interface WorkspaceManifestDelta {
  readonly changed: readonly RepoPath[];
  readonly added: readonly RepoPath[];
  readonly deleted: readonly RepoPath[];
  readonly renamed: readonly { readonly from: RepoPath; readonly to: RepoPath; readonly sourceDigest: ContentDigest }[];
  readonly scopeChanged: boolean;
}

export const diffWorkspaceManifests = (
  previous: WorkspaceManifest,
  current: WorkspaceManifest,
): WorkspaceManifestDelta => {
  const oldByPath = new Map(previous.files.map((file) => [file.repoPath, file] as const));
  const newByPath = new Map(current.files.map((file) => [file.repoPath, file] as const));
  const changed: RepoPath[] = [];
  const deleted: WorkspaceManifestFile[] = [];
  const added: WorkspaceManifestFile[] = [];
  for (const oldFile of previous.files) {
    const next = newByPath.get(oldFile.repoPath);
    if (next === undefined) deleted.push(oldFile);
    else if (oldFile.sourceDigest !== next.sourceDigest || oldFile.sizeBytes !== next.sizeBytes || oldFile.state !== next.state) {
      changed.push(oldFile.repoPath);
    }
  }
  for (const newFile of current.files) if (!oldByPath.has(newFile.repoPath)) added.push(newFile);
  const oldByDigest = new Map<string, WorkspaceManifestFile[]>();
  const newByDigest = new Map<string, WorkspaceManifestFile[]>();
  for (const file of deleted) oldByDigest.set(file.sourceDigest, [...(oldByDigest.get(file.sourceDigest) ?? []), file]);
  for (const file of added) newByDigest.set(file.sourceDigest, [...(newByDigest.get(file.sourceDigest) ?? []), file]);
  const renamed: WorkspaceManifestDelta['renamed'][number][] = [];
  const renamedFrom = new Set<RepoPath>();
  const renamedTo = new Set<RepoPath>();
  for (const [sourceDigest, oldFiles] of oldByDigest) {
    const newFiles = newByDigest.get(sourceDigest) ?? [];
    if (oldFiles.length !== 1 || newFiles.length !== 1) continue;
    const from = oldFiles[0];
    const to = newFiles[0];
    if (from === undefined || to === undefined) continue;
    renamed.push({ from: from.repoPath, to: to.repoPath, sourceDigest: from.sourceDigest });
    renamedFrom.add(from.repoPath);
    renamedTo.add(to.repoPath);
  }
  return {
    changed: changed.sort(),
    added: added.map((file) => file.repoPath).filter((path) => !renamedTo.has(path)).sort(),
    deleted: deleted.map((file) => file.repoPath).filter((path) => !renamedFrom.has(path)).sort(),
    renamed: renamed.sort((left, right) => left.from.localeCompare(right.from)),
    scopeChanged: previous.scopeFingerprint !== current.scopeFingerprint,
  };
};

export const workspaceManifestEqual = (
  previous: WorkspaceManifest,
  current: WorkspaceManifest,
): boolean => previous.contentIdentity === current.contentIdentity
  && previous.scopeFingerprint === current.scopeFingerprint;
