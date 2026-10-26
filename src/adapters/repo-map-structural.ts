import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import type { SemanticAnalysisPort } from '../application/ports.js';
import type { CodeCandidate } from '../domain/retrieval.js';
import {
  makeRepoMapSymbol,
  type RepoMapDelta,
  type RepoMapReference,
  type RepoMapSymbol,
  type RepoMapSymbolId,
} from '../domain/repo-map.js';
import type { RepoPath } from '../domain/workspace.js';
import { utf16ColumnAtUtf8Byte } from '../domain/utf8-range.js';
import { err, ok, type Result } from '../domain/result.js';

export interface RepoMapStructuralInput {
  readonly candidates: readonly CodeCandidate[];
  readonly semantics: SemanticAnalysisPort;
  readonly sourceBytesByPath: ReadonlyMap<RepoPath, Uint8Array>;
  readonly snapshotIdentity?: string;
  readonly requestId: string;
}

const locationKey = (location: {
  readonly repoPath: string;
  readonly startLine: number;
  readonly startColumn: number | undefined;
  readonly endLine: number;
  readonly endColumn: number | undefined;
}): string => [
  location.repoPath,
  location.startLine,
  location.startColumn,
  location.endLine,
  location.endColumn,
].join(':');

const symbolLocationKey = (symbol: RepoMapSymbol): string => locationKey({
  repoPath: symbol.repoPath,
  startLine: symbol.range.startLine,
  startColumn: symbol.range.startColumn,
  endLine: symbol.range.endLine,
  endColumn: symbol.range.endColumn,
});

const candidateToSymbol = (candidate: CodeCandidate): RepoMapSymbol | undefined => {
  if (candidate.symbolName === undefined || candidate.structuralKind === undefined) return undefined;
  return makeRepoMapSymbol({
    repoPath: candidate.repoPath,
    name: candidate.symbolName,
    kind: candidate.structuralKind,
    sourceDigest: candidate.sourceDigest,
    range: candidate.range,
    text: candidate.text,
    ...(candidate.structuralExported === undefined ? {} : { isExported: candidate.structuralExported }),
    references: [],
  });
};

export const buildRepoMapDelta = (
  input: RepoMapStructuralInput,
): Effect.Effect<Result<RepoMapDelta, DomainError>> => Effect.gen(function* () {
  const symbols = input.candidates.flatMap((candidate) => {
    const symbol = candidateToSymbol(candidate);
    return symbol === undefined ? [] : [symbol];
  });
  const byLocation = new Map<string, RepoMapSymbolId>();
  for (const symbol of symbols) byLocation.set(symbolLocationKey(symbol), symbol.id);
  const references = new Map<RepoMapSymbolId, RepoMapReference[]>();

  for (const candidate of input.candidates) {
    const symbol = candidateToSymbol(candidate);
    const anchor = candidate.semanticAnchor;
    const source = input.sourceBytesByPath.get(candidate.repoPath);
    if (symbol === undefined || anchor === undefined || source === undefined) continue;
    const column = utf16ColumnAtUtf8Byte(source, anchor.line, anchor.byteColumn);
    if (column === undefined) {
      return err(domainError('INVALID_RETRIEVAL', candidate.repoPath, 'RepoMap semantic anchor is not valid UTF-8'));
    }
    const result = yield* input.semantics.references({
      repoPath: candidate.repoPath,
      line: anchor.line,
      column,
      requestId: input.requestId,
      ...(input.snapshotIdentity === undefined ? {} : { snapshotIdentity: input.snapshotIdentity }),
    });
    if (result._tag === 'Err') return result;
    const current = references.get(symbol.id) ?? [];
    for (const reference of result.value) {
      const targetId = byLocation.get(locationKey(reference.location));
      if (targetId === undefined) continue;
      current.push({
        targetId,
        kind: reference.isDefinition ? 'definition' : 'reference',
      });
    }
    references.set(symbol.id, current);
  }

  return ok({
    upserted: symbols.map((symbol) => ({
      ...symbol,
      references: [...new Map((references.get(symbol.id) ?? []).map((reference) => [
        `${reference.kind}:${reference.targetId}`,
        reference,
      ])).values()].sort((left, right) =>
        left.targetId.localeCompare(right.targetId) || left.kind.localeCompare(right.kind)),
    })),
    removed: [],
  });
});
