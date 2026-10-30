import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import type { DomainError } from '../domain/errors.js';
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
import { ok, type Result } from '../domain/result.js';

export interface RepoMapStructuralInput {
  readonly candidates: readonly CodeCandidate[];
  /** Shared structural records from the canonical provider. */
  readonly structuralAnalyses?: readonly StructuralAnalysis[];
  readonly sourceBytesByPath: ReadonlyMap<RepoPath, Uint8Array>;
  readonly upsertPaths?: ReadonlySet<RepoPath>;
  readonly removedSymbolIds?: readonly RepoMapSymbolId[];
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
      // Aider relates each identifier occurrence to every defining FILE,
      // not each same-named declaration within that file. Retain one symbol
      // anchor per defining path so counting does not multiply references.
      const targetByPath = new Map<RepoPath, RepoMapSymbol>();
      for (const target of symbolsByName.get(identifier.name) ?? []) {
        if (!targetByPath.has(target.repoPath)) targetByPath.set(target.repoPath, target);
      }
      if (targetByPath.size === 0) continue;
      const caller = enclosingSymbol(path, identifier.startLine, identifier.startColumn, byPath)
        ?? fileAnchorFor(path);
      if (caller === undefined) continue;
      for (const target of targetByPath.values()) {
        references.set(caller.id, [
          ...(references.get(caller.id) ?? []),
          { targetId: target.id, kind: 'reference' },
        ]);
      }
    }
  }

  const referenceAffectedSymbols = new Set<RepoMapSymbolId>();
  if (input.upsertPaths !== undefined) {
    const symbolsById = new Map(symbols.map((symbol) => [symbol.id, symbol] as const));
    for (const [sourceId, sourceReferences] of references) {
      if (sourceReferences.some((reference) => {
        const target = symbolsById.get(reference.targetId);
        return target !== undefined && input.upsertPaths?.has(target.repoPath) === true;
      })) referenceAffectedSymbols.add(sourceId);
    }
  }

  return ok({
    sourceByPath: [...input.sourceBytesByPath].flatMap(([path, bytes]) => {
      if (input.upsertPaths !== undefined && !input.upsertPaths.has(path)) return [];
      const analysis = structuralByPath.get(path);
      if (analysis === undefined) return [];
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== analysis.sourceDigest) return [];
      return [{
        repoPath: path,
        sourceDigest: analysis.sourceDigest,
        text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        ...(analysis.scopes === undefined ? {} : { scopes: analysis.scopes }),
      }];
    }),
    upserted: symbols.filter((symbol) => input.upsertPaths === undefined
      || input.upsertPaths.has(symbol.repoPath)
      || referenceAffectedSymbols.has(symbol.id)).map((symbol) => ({
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
