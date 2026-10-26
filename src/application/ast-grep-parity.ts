import type { StructuralAnalysis, StructuralSymbol } from '../domain/semantic.js';

export interface SymbolParityDifference {
  readonly repoPath: string;
  readonly kind: 'missing_from_cli' | 'missing_from_napi' | 'range_mismatch' | 'export_mismatch'
    | 'import_mismatch' | 'syntax_mismatch' | 'source_mismatch' | 'path_mismatch';
  readonly name: string;
  readonly detail: string;
}

export interface SymbolParityReport {
  readonly repoPath: string;
  readonly cliSymbolCount: number;
  readonly napiSymbolCount: number;
  readonly cliSourceDigest: string;
  readonly napiSourceDigest: string;
  readonly cliHasSyntaxErrors: boolean;
  readonly napiHasSyntaxErrors: boolean;
  readonly sourceDigestMatch: boolean;
  readonly differences: readonly SymbolParityDifference[];
  readonly equivalent: boolean;
}

const normalizedKind = (symbol: StructuralSymbol): string =>
  symbol.kind === 'struct' && symbol.language === 'typescript' ? 'type' : symbol.kind;

const semanticIdentity = (symbol: StructuralSymbol): string =>
  `${symbol.name}\0${normalizedKind(symbol)}`;

const location = (symbol: StructuralSymbol): string => [
  symbol.startLine, symbol.startColumn, symbol.endLine, symbol.endColumn,
  symbol.startByteOffset ?? 'missing', symbol.endByteOffset ?? 'missing',
  symbol.nameStartLine ?? 'missing', symbol.nameStartColumn ?? 'missing',
  symbol.nameEndLine ?? 'missing', symbol.nameEndColumn ?? 'missing',
].join(':');

const bySemanticIdentity = (symbols: readonly StructuralSymbol[]): Map<string, StructuralSymbol[]> => {
  // Preserve multiplicity: overloaded functions and same-named class methods
  // must not silently overwrite one another in a Map<string, Symbol>.
  const groups = new Map<string, StructuralSymbol[]>();
  for (const symbol of symbols) {
    const key = semanticIdentity(symbol);
    const group = groups.get(key) ?? [];
    group.push(symbol);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => (
      left.startLine - right.startLine
      || left.startColumn - right.startColumn
      || left.endLine - right.endLine
      || left.endColumn - right.endColumn
      || location(left).localeCompare(location(right))
    ));
  }
  return groups;
};

const declarationRange = (symbol: StructuralSymbol): string => [
  symbol.startLine, symbol.startColumn, symbol.endLine, symbol.endColumn,
  symbol.startByteOffset ?? 'missing', symbol.endByteOffset ?? 'missing',
].join(':');

const nameRange = (symbol: StructuralSymbol): string => [
  symbol.nameStartLine ?? 'missing', symbol.nameStartColumn ?? 'missing',
  symbol.nameEndLine ?? 'missing', symbol.nameEndColumn ?? 'missing',
].join(':');

export const compareStructuralAnalyses = (
  cli: StructuralAnalysis,
  napi: StructuralAnalysis,
): SymbolParityReport => {
  const cliGroups = bySemanticIdentity(cli.symbols);
  const napiGroups = bySemanticIdentity(napi.symbols);
  const differences: SymbolParityDifference[] = [];

  if (cli.repoPath !== napi.repoPath) {
    differences.push({
      repoPath: cli.repoPath,
      kind: 'path_mismatch',
      name: '<file>',
      detail: `${cli.repoPath} != ${napi.repoPath}`,
    });
  }
  if (cli.sourceDigest !== napi.sourceDigest) {
    differences.push({
      repoPath: cli.repoPath,
      kind: 'source_mismatch',
      name: '<file>',
      detail: `${cli.sourceDigest} != ${napi.sourceDigest}`,
    });
  }

  for (const identity of [...new Set([...cliGroups.keys(), ...napiGroups.keys()])].sort()) {
    const fromCli = cliGroups.get(identity) ?? [];
    const fromNapi = napiGroups.get(identity) ?? [];
    const pairs = Math.min(fromCli.length, fromNapi.length);
    for (let index = 0; index < pairs; index += 1) {
      const cliSymbol = fromCli[index]!;
      const napiSymbol = fromNapi[index]!;
      const name = cliSymbol.name;
      if (declarationRange(cliSymbol) !== declarationRange(napiSymbol)
        || nameRange(cliSymbol) !== nameRange(napiSymbol)) {
        differences.push({
          repoPath: cli.repoPath,
          kind: 'range_mismatch',
          name,
          detail: `declaration ${declarationRange(cliSymbol)} != ${declarationRange(napiSymbol)}; name ${nameRange(cliSymbol)} != ${nameRange(napiSymbol)}`,
        });
      }
      if ((cliSymbol.isExported ?? false) !== (napiSymbol.isExported ?? false)) {
        differences.push({
          repoPath: cli.repoPath, kind: 'export_mismatch', name,
          detail: `${String(cliSymbol.isExported)} != ${String(napiSymbol.isExported)}`,
        });
      }
      if ((cliSymbol.isImport ?? false) !== (napiSymbol.isImport ?? false)) {
        differences.push({
          repoPath: cli.repoPath, kind: 'import_mismatch', name,
          detail: `${String(cliSymbol.isImport)} != ${String(napiSymbol.isImport)}`,
        });
      }
    }
    for (const symbol of fromCli.slice(pairs)) {
      differences.push({
        repoPath: cli.repoPath, kind: 'missing_from_napi', name: symbol.name,
        detail: `${identity} @ ${location(symbol)}`,
      });
    }
    for (const symbol of fromNapi.slice(pairs)) {
      differences.push({
        repoPath: napi.repoPath, kind: 'missing_from_cli', name: symbol.name,
        detail: `${identity} @ ${location(symbol)}`,
      });
    }
  }
  if (cli.hasSyntaxErrors !== napi.hasSyntaxErrors) {
    differences.push({
      repoPath: cli.repoPath, kind: 'syntax_mismatch', name: '<file>',
      detail: `${String(cli.hasSyntaxErrors)} != ${String(napi.hasSyntaxErrors)}`,
    });
  }
  return {
    repoPath: cli.repoPath,
    cliSymbolCount: cli.symbols.length,
    napiSymbolCount: napi.symbols.length,
    cliSourceDigest: cli.sourceDigest,
    napiSourceDigest: napi.sourceDigest,
    cliHasSyntaxErrors: cli.hasSyntaxErrors,
    napiHasSyntaxErrors: napi.hasSyntaxErrors,
    sourceDigestMatch: cli.sourceDigest === napi.sourceDigest,
    differences,
    equivalent: differences.length === 0,
  };
};

export const symbolParityFingerprint = (report: SymbolParityReport): string =>
  JSON.stringify({
    repoPath: report.repoPath,
    cliSourceDigest: report.cliSourceDigest,
    napiSourceDigest: report.napiSourceDigest,
    cliHasSyntaxErrors: report.cliHasSyntaxErrors,
    napiHasSyntaxErrors: report.napiHasSyntaxErrors,
    cliSymbolCount: report.cliSymbolCount,
    napiSymbolCount: report.napiSymbolCount,
    differences: report.differences,
  });
