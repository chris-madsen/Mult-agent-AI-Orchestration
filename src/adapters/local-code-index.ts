import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { domainError } from '../domain/errors.js';
import { ok, type Result } from '../domain/result.js';
import {
  createCodeIndex,
  indexCandidate,
  makeCandidateId,
  makeCodeCandidate,
  type CodeIndex,
  type Generation,
} from '../domain/retrieval.js';
import type { WorkspaceFilePort } from '../application/ports.js';
import type { ContentDigest, RepoPath, WorkspaceId } from '../domain/workspace.js';

export interface LocalCodeIndexBuild {
  readonly index: CodeIndex;
  readonly warnings: readonly string[];
  readonly indexedPaths: readonly RepoPath[];
}

export interface LocalCodeIndexerOptions {
  readonly generation: number;
  readonly extensions?: readonly string[];
}

const defaultExtensions = ['.cjs', '.js', '.jsx', '.mjs', '.py', '.rs', '.ts', '.tsx'];
const symbolPattern = /\b(?:class|function|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/gu;

const candidateId = (workspaceId: WorkspaceId, repoPath: RepoPath, digest: ContentDigest, symbolName: string | undefined) =>
  createHash('sha256').update(`${workspaceId}:${repoPath}:${digest}:${symbolName ?? ''}`).digest('hex');

const symbolNames = (text: string): readonly string[] => {
  const values = new Set<string>();
  for (const match of text.matchAll(symbolPattern)) {
    const symbol = match[1];
    if (symbol !== undefined) values.add(symbol);
  }
  return [...values];
};

export const buildLocalCodeIndex = (
  files: WorkspaceFilePort,
  workspaceId: WorkspaceId,
  rootPath: string,
  options: LocalCodeIndexerOptions,
): Effect.Effect<Result<LocalCodeIndexBuild, ReturnType<typeof domainError>>> =>
  Effect.gen(function* () {
    const indexResult = createCodeIndex(options.generation);
    if (indexResult._tag === 'Err') return indexResult;
    const generation = options.generation as Generation;
    const extensions = new Set(options.extensions ?? defaultExtensions);
    const snapshot = yield* files.snapshot(rootPath, Date.now());
    if (snapshot._tag === 'Err') return snapshot;
    let index = indexResult.value;
    const warnings: string[] = [];
    const indexedPaths: RepoPath[] = [];
    for (const observation of snapshot.value.files) {
      const extension = observation.repoPath.slice(observation.repoPath.lastIndexOf('.')).toLocaleLowerCase();
      if (!extensions.has(extension)) continue;
      const exact = yield* files.readExact(rootPath, observation.repoPath);
      if (exact._tag === 'Err') {
        warnings.push(`${observation.repoPath}: ${exact.error.code}`);
        continue;
      }
      const text = Buffer.from(exact.value.bytes).toString('utf8');
      if (text.length === 0) continue;
      const names = symbolNames(text);
      const symbols = names.length === 0 ? [undefined] : names;
      const endLine = text.split('\n').length;
      for (const symbolName of symbols) {
        const id = makeCandidateId(candidateId(workspaceId, observation.repoPath, exact.value.digest, symbolName));
        if (id._tag === 'Err') return id;
        const candidate = makeCodeCandidate({
          candidateId: id.value,
          workspaceId,
          repoPath: observation.repoPath,
          range: { startLine: 1, endLine },
          ...(symbolName === undefined ? {} : { symbolName }),
          text,
          sourceDigest: exact.value.digest,
          generation,
          indexedAtMs: Date.now(),
        });
        if (candidate._tag === 'Err') return candidate;
        const next = indexCandidate(index, candidate.value);
        if (next._tag === 'Err') return next;
        index = next.value;
      }
      indexedPaths.push(observation.repoPath);
    }
    return ok({ index, warnings, indexedPaths });
  });
