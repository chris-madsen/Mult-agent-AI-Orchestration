import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import type { WorkspaceFilePort } from './ports.js';
import { domainError, type DomainError } from '../domain/errors.js';
import type { IndexFileIdentity } from '../domain/retrieval.js';
import { err, ok, type Result } from '../domain/result.js';
import { decodeStrictSourceText } from '../domain/source-text.js';
import type { RepoPath } from '../domain/workspace.js';

export interface SemanticSnapshotIdentityInput {
  readonly indexKey: string;
  readonly tsconfigIdentity: string;
  readonly projectReferencesIdentity: string;
  readonly moduleResolutionIdentity: string;
  readonly declarationsIdentity: string;
  readonly packageLockIdentity: string;
  readonly providerIdentity: string;
}

/**
 * Semantic evidence is valid only for the complete dependency/configuration
 * identity, not merely for the set of source files that happened to produce
 * symbols.  Callers should use explicit `absent` identities for files which
 * do not exist, so deletion invalidates the snapshot as well.
 */
export const semanticSnapshotIdentity = (input: SemanticSnapshotIdentityInput): string => createHash('sha256')
  .update(JSON.stringify(input), 'utf8')
  .digest('hex');

export const readVerifiedSemanticSnapshot = (
  files: WorkspaceFilePort,
  rootPath: string,
  paths: readonly RepoPath[],
  manifest: readonly IndexFileIdentity[],
  previous?: {
    readonly files: Readonly<Record<string, string>>;
    readonly manifest: readonly IndexFileIdentity[];
  },
): Effect.Effect<Result<Readonly<Record<string, string>>, DomainError>> =>
  Effect.gen(function* () {
    const expectedByPath = new Map(manifest.map((item) => [item.repoPath, item] as const));
    const previousByPath = new Map((previous?.manifest ?? []).map((item) => [item.repoPath, item] as const));
    const entries: Array<readonly [string, string]> = [];
    for (const repoPath of paths) {
      const expected = expectedByPath.get(repoPath);
      if (expected === undefined) {
        return err(domainError(
          'INVALID_RETRIEVAL',
          'semantic_snapshot',
          'indexed path is missing from the source snapshot manifest',
        ));
      }
      const previousEntry = previousByPath.get(repoPath);
      const previousSource = previous?.files[repoPath];
      if (previousEntry?.sourceDigest === expected.sourceDigest && previousSource !== undefined) {
        entries.push([repoPath, previousSource]);
        continue;
      }
      const source = yield* files.readExact(rootPath, repoPath);
      if (source._tag === 'Err') return source;
      if (source.value.digest !== expected.sourceDigest) {
        return err(domainError(
          'WORKTREE_RACED',
          repoPath,
          'source changed between structural indexing and TypeScript language-service snapshot',
        ));
      }
      const decoded = decodeStrictSourceText(source.value.bytes);
      if (decoded._tag === 'Err') {
        return err(domainError(
          'INVALID_RETRIEVAL',
          repoPath,
          `source became non-text while constructing semantic snapshot: ${decoded.kind}`,
        ));
      }
      entries.push([repoPath, decoded.text]);
    }
    return ok(Object.fromEntries(entries));
  });
