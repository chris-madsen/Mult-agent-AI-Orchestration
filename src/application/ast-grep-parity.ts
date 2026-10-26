import type { StructuralAnalysis, StructuralSymbol } from '../domain/semantic.js';

export interface SymbolParityDifference {
  readonly repoPath: string;
  readonly kind: 'missing_from_cli' | 'missing_from_napi' | 'range_mismatch' | 'export_mismatch' | 'syntax_mismatch' | 'source_mismatch';
  readonly name: string;
  readonly detail: string;
}

export interface SymbolParityReport {
  readonly repoPath: string;
  readonly cliSymbolCount: number;
  readonly napiSymbolCount: number;
  readonly sourceDigestMatch: boolean;
  readonly differences: readonly SymbolParityDifference[];
  readonly equivalent: boolean;
}

const symbolKey = (symbol: StructuralSymbol): string => [
  symbol.name,
  symbol.kind,
  symbol.startLine,
  symbol.startColumn,
  symbol.endLine,
  symbol.endColumn,
].join('\0');

const bySemanticIdentity = (symbols: readonly StructuralSymbol[]): Map<string, StructuralSymbol> =>
  new Map(symbols.map((symbol) => [`${symbol.name}\0${symbol.kind}`, symbol]));

const range = (symbol: StructuralSymbol): string => [
  symbol.startLine,
  symbol.startColumn,
  symbol.endLine,
  symbol.endColumn,
  symbol.startByteOffset ?? '',
  symbol.endByteOffset ?? '',
].join(':');

export const compareStructuralAnalyses = (
  cli: StructuralAnalysis,
  napi: StructuralAnalysis,
): SymbolParityReport => {
  const cliByIdentity = bySemanticIdentity(cli.symbols);
  const napiByIdentity = bySemanticIdentity(napi.symbols);
  const differences: SymbolParityDifference[] = [];
  if (cli.sourceDigest !== napi.sourceDigest) {
    differences.push({
      repoPath: cli.repoPath,
      kind: 'source_mismatch',
      name: '<file>',
      detail: `${cli.sourceDigest} != ${napi.sourceDigest}`,
    });
  }
  for (const [identity, cliSymbol] of cliByIdentity) {
    const napiSymbol = napiByIdentity.get(identity);
    const name = cliSymbol.name;
    if (napiSymbol === undefined) {
      differences.push({ repoPath: cli.repoPath, kind: 'missing_from_napi', name, detail: identity });
      continue;
    }
    if (range(cliSymbol) !== range(napiSymbol)) {
      differences.push({ repoPath: cli.repoPath, kind: 'range_mismatch', name, detail: `${range(cliSymbol)} != ${range(napiSymbol)}` });
    }
    if ((cliSymbol.isExported ?? false) !== (napiSymbol.isExported ?? false)) {
      differences.push({ repoPath: cli.repoPath, kind: 'export_mismatch', name, detail: `${String(cliSymbol.isExported)} != ${String(napiSymbol.isExported)}` });
    }
  }
  for (const [identity, napiSymbol] of napiByIdentity) {
    if (!cliByIdentity.has(identity)) {
      differences.push({ repoPath: napi.repoPath, kind: 'missing_from_cli', name: napiSymbol.name, detail: identity });
    }
  }
  if (cli.hasSyntaxErrors !== napi.hasSyntaxErrors) {
    differences.push({
      repoPath: cli.repoPath,
      kind: 'syntax_mismatch',
      name: '<file>',
      detail: `${String(cli.hasSyntaxErrors)} != ${String(napi.hasSyntaxErrors)}`,
    });
  }
  return {
    repoPath: cli.repoPath,
    cliSymbolCount: cli.symbols.length,
    napiSymbolCount: napi.symbols.length,
    sourceDigestMatch: cli.sourceDigest === napi.sourceDigest,
    differences,
    equivalent: differences.length === 0,
  };
};

export const symbolParityFingerprint = (report: SymbolParityReport): string =>
  JSON.stringify({
    repoPath: report.repoPath,
    cliSymbolCount: report.cliSymbolCount,
    napiSymbolCount: report.napiSymbolCount,
    differences: report.differences,
  });

void symbolKey;
