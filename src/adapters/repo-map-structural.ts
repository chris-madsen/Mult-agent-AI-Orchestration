import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import type { SemanticAnalysisPort } from '../application/ports.js';
import type { StructuralAnalysis } from '../domain/semantic.js';
import type { CodeCandidate, SourceRange } from '../domain/retrieval.js';
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
  /** Shared structural records from the canonical provider. */
  readonly structuralAnalyses?: readonly StructuralAnalysis[];
  readonly semantics?: SemanticAnalysisPort;
  readonly sourceBytesByPath: ReadonlyMap<RepoPath, Uint8Array>;
  readonly upsertPaths?: ReadonlySet<RepoPath>;
  readonly removedSymbolIds?: readonly RepoMapSymbolId[];
  readonly snapshotIdentity?: string;
  readonly requestId?: string;
}

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
    ...(candidate.semanticAnchor === undefined ? {} : {
      nameStartLine: candidate.semanticAnchor.line,
      nameStartColumn: candidate.semanticAnchor.byteColumn,
    }),
    references: [],
  });
};

// LSP "references" called on declaration A returns uses of A, *not*
// dependencies that A calls. Attribute each reference occurrence to its
// enclosing caller B and add B -> A. LSP columns are UTF-16; structural
// source ranges are UTF-8 bytes, so convert before locating the owner.
const referenceByteColumn = (lines: readonly string[], line: number, column: number): number | undefined => {
  if (!Number.isSafeInteger(line) || line < 1) return undefined;
  const source = lines[line - 1];
  if (source === undefined || !Number.isSafeInteger(column) || column < 1 || column > source.length + 1) return undefined;
  const prefix = source.slice(0, column - 1);
  // Reject a UTF-16 position inside a surrogate pair.
  if (/[\uD800-\uDBFF]$/u.test(prefix)) return undefined;
  return Buffer.byteLength(prefix, 'utf8') + 1;
};

const contains = (range: SourceRange, line: number, column: number): boolean => (
  line >= range.startLine && line <= range.endLine
  && (line !== range.startLine || range.startColumn === undefined || column >= range.startColumn)
  && (line !== range.endLine || range.endColumn === undefined || column < range.endColumn)
);

const spanSize = (range: SourceRange): number =>
  (range.endLine - range.startLine) * 1_000_000
  + (range.endColumn ?? 1_000_000) - (range.startColumn ?? 1);

const enclosingSymbol = (
  path: RepoPath,
  line: number,
  column: number,
  symbolsByPath: ReadonlyMap<RepoPath, readonly RepoMapSymbol[]>,
): RepoMapSymbol | undefined => {
  const matching = (symbolsByPath.get(path) ?? [])
    .filter((symbol) => contains(symbol.range, line, column))
    .sort((left, right) => spanSize(left.range) - spanSize(right.range) || left.id.localeCompare(right.id));
  // If two declarations have identical extents, ownership is ambiguous.
  if (matching.length > 1 && spanSize(matching[0]!.range) === spanSize(matching[1]!.range)) return undefined;
  return matching[0];
};

export const buildRepoMapDelta = (
  input: RepoMapStructuralInput,
): Effect.Effect<Result<RepoMapDelta, DomainError>> => Effect.gen(function* () {
  const symbols = [...new Map(input.candidates.flatMap((candidate) => {
    const symbol = candidateToSymbol(candidate);
    return symbol === undefined ? [] : [[symbol.id, symbol] as const];
  })).values()];
  const byPath = new Map<RepoPath, RepoMapSymbol[]>();
  for (const symbol of symbols) byPath.set(symbol.repoPath, [...(byPath.get(symbol.repoPath) ?? []), symbol]);
  // Parsing a whole source file for each returned LSP reference would turn
  // graph assembly into O(references * source_bytes) rather than O(source_bytes).
  const sourceLines = new Map<RepoPath, readonly string[]>(
    [...input.sourceBytesByPath].map(([path, bytes]) => [
      path,
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        .split('\n').map((line) => line.replace(/\r$/u, '')),
    ]),
  );
  const references = new Map<RepoMapSymbolId, RepoMapReference[]>();

  const structuralByPath = new Map<RepoPath, StructuralAnalysis>(
    (input.structuralAnalyses ?? []).map((analysis) => [analysis.repoPath as RepoPath, analysis]),
  );
  const fileAnchorFor = (path: RepoPath): RepoMapSymbol | undefined => {
    const existing = (byPath.get(path) ?? []).find((symbol) => symbol.kind === 'repo-map-file-anchor');
    if (existing !== undefined) return existing;
    const analysis = structuralByPath.get(path);
    const lines = sourceLines.get(path);
    if (analysis === undefined || lines === undefined) return undefined;
    const endLine = Math.max(1, lines.length);
    const endColumn = Buffer.byteLength(lines[endLine - 1] ?? '', 'utf8') + 1;
    const anchor = makeRepoMapSymbol({
      repoPath: path,
      name: path,
      kind: 'repo-map-file-anchor',
      sourceDigest: analysis.sourceDigest,
      range: { startLine: 1, startColumn: 1, endLine, endColumn },
      text: '',
      references: [],
    });
    symbols.push(anchor);
    byPath.set(path, [...(byPath.get(path) ?? []), anchor]);
    return anchor;
  };
  const symbolsByName = new Map<string, RepoMapSymbol[]>();
  for (const symbol of symbols) {
    const namedSymbols = symbolsByName.get(symbol.name);
    if (namedSymbols === undefined) symbolsByName.set(symbol.name, [symbol]);
    else namedSymbols.push(symbol);
  }
  for (const namedSymbols of symbolsByName.values()) {
    namedSymbols.sort((left, right) => left.id.localeCompare(right.id));
  }
  for (const [path, analysis] of structuralByPath) {
    const pathSymbols = byPath.get(path) ?? [];
    for (const identifier of analysis.identifiers ?? []) {
      const isDeclaration = pathSymbols.some((symbol) => symbol.name === identifier.name
        && symbol.nameStartLine === identifier.startLine
        && symbol.nameStartColumn === identifier.startColumn);
      if (isDeclaration) continue;
      const caller = enclosingSymbol(path, identifier.startLine, identifier.startColumn, byPath)
        ?? fileAnchorFor(path);
      const target = symbolsByName.get(identifier.name)?.[0];
      if (caller === undefined || target === undefined) continue;
      references.set(caller.id, [
        ...(references.get(caller.id) ?? []),
        { targetId: target.id, kind: 'reference' },
      ]);
    }
  }

  if (input.semantics !== undefined) {
    for (const candidate of input.candidates) {
      const target = candidateToSymbol(candidate);
      const anchor = candidate.semanticAnchor;
      const source = input.sourceBytesByPath.get(candidate.repoPath);
      if (target === undefined || anchor === undefined || source === undefined) continue;
      const column = utf16ColumnAtUtf8Byte(source, anchor.line, anchor.byteColumn);
      if (column === undefined) {
        return err(domainError('INVALID_RETRIEVAL', candidate.repoPath, 'RepoMap semantic anchor is not valid UTF-8'));
      }
      const result = yield* input.semantics.references({
        repoPath: candidate.repoPath,
        line: anchor.line,
        column,
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        ...(input.snapshotIdentity === undefined ? {} : { snapshotIdentity: input.snapshotIdentity }),
      });
      if (result._tag === 'Err') return result;
      for (const reference of result.value) {
        if (reference.isDefinition) continue;
        const path = reference.location.repoPath as RepoPath;
        const lines = sourceLines.get(path);
        if (lines === undefined) continue; // never trust references to unverified sources
        const byteColumn = referenceByteColumn(lines, reference.location.startLine, reference.location.startColumn);
        if (byteColumn === undefined) continue;
        const caller = enclosingSymbol(path, reference.location.startLine, byteColumn, byPath)
          ?? fileAnchorFor(path);
        if (caller === undefined) continue;
        references.set(caller.id, [
          ...(references.get(caller.id) ?? []),
          { targetId: target.id, kind: 'reference' },
        ]);
      }
    }
  }

  return ok({
    upserted: symbols.filter((symbol) => input.upsertPaths === undefined || input.upsertPaths.has(symbol.repoPath)).map((symbol) => ({
      ...symbol,
      references: [...(references.get(symbol.id) ?? []).reduce((grouped, reference) => {
        const key = `${reference.kind}:${reference.targetId}`;
        const previous = grouped.get(key);
        const count = (previous?.weight ?? 0) + 1;
        // Keep the running count in the accumulator even for the first
        // occurrence. Omitting weight:1 here would reset the next increment
        // back to one and silently erase reference multiplicity.
        grouped.set(key, {
          targetId: reference.targetId,
          kind: reference.kind,
          weight: count,
        });
        return grouped;
      }, new Map<string, RepoMapReference>()).values()]
        .map((reference) => reference.weight === 1
          ? { targetId: reference.targetId, kind: reference.kind }
          : reference)
        .sort((left, right) =>
          left.targetId.localeCompare(right.targetId) || left.kind.localeCompare(right.kind)),
    })),
    removed: [...(input.removedSymbolIds ?? [])],
  });
});
