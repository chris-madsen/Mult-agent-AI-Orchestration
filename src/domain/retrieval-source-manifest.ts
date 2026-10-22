import { sha256 } from './retrieval-benchmark.js';

export interface RetrievalSourceManifestEntry {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export const retrievalSourceManifestExclusions = [
  '.git', 'node_modules', 'dist', 'build', 'artifacts', '.cache', 'coverage', 'vendor', 'binary files',
] as const;

export const retrievalSourceManifestExcludedPath = (repoPath: string): boolean => {
  const lower = repoPath.toLocaleLowerCase();
  return repoPath.split('/').some((part) =>
    ['node_modules', 'dist', 'build', 'artifacts', '.cache', 'coverage', 'vendor'].includes(part))
    || ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.zip', '.tar', '.gz', '.exe', '.dll']
      .some((suffix) => lower.endsWith(suffix));
};

/**
 * Canonical frozen retrieval source-manifest identity. This must remain
 * byte-compatible with scripts/freeze-retrieval-holdout.ts.
 */
export const retrievalSourceManifestSha256 = (
  repositoryId: string,
  revision: string,
  entries: readonly RetrievalSourceManifestEntry[],
): string => sha256(JSON.stringify({
  schemaVersion: 1,
  repositoryId,
  revision,
  exclusions: retrievalSourceManifestExclusions,
  entries: [...entries].map((entry) => ({ ...entry })).sort((left, right) => left.path.localeCompare(right.path)),
}, null, 2) + '\n');
