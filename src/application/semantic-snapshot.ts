import { Effect } from 'effect';
import type { WorkspaceFilePort } from './ports.js';
import { domainError, type DomainError } from '../domain/errors.js';
import type { IndexFileIdentity } from '../domain/retrieval.js';
import { err, ok, type Result } from '../domain/result.js';
import { decodeStrictSourceText } from '../domain/source-text.js';
import type { RepoPath } from '../domain/workspace.js';

export const readVerifiedSemanticSnapshot = (
  files: WorkspaceFilePort,
  rootPath: string,
  paths: readonly RepoPath[],
  manifest: readonly IndexFileIdentity[],
): Effect.Effect<Result<Readonly<Record<string, string>>, DomainError>> =>
  Effect.gen(function* () {
    const expectedByPath = new Map(manifest.map((item) => [item.repoPath, item] as const));
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
