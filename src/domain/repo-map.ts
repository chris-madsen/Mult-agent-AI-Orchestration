import { createHash } from 'node:crypto';
import type { ContentDigest, RepoPath } from './workspace.js';
import type { SourceRange } from './retrieval.js';

export type RepoMapSymbolId = string & { readonly __brand: 'RepoMapSymbolId' };

export interface RepoMapReference {
  readonly targetId: RepoMapSymbolId;
  readonly kind: 'definition' | 'reference';
}

export interface RepoMapSymbol {
  readonly id: RepoMapSymbolId;
  readonly repoPath: RepoPath;
  readonly name: string;
  readonly kind: string;
  readonly sourceDigest: ContentDigest;
  readonly range: SourceRange;
  readonly text: string;
  readonly isExported?: boolean;
  readonly references: readonly RepoMapReference[];
}

export interface RepoMapDelta {
  readonly upserted: readonly RepoMapSymbol[];
  readonly removed: readonly RepoMapSymbolId[];
}

export interface RepoMapGraph {
  readonly symbols: ReadonlyMap<RepoMapSymbolId, RepoMapSymbol>;
}

export interface RepoMapRankedSymbol {
  readonly symbol: RepoMapSymbol;
  readonly score: number;
}

export interface RepoMapRenderInput {
  readonly query: string;
  readonly openFiles: readonly RepoPath[];
  readonly mentionedFiles: readonly RepoPath[];
  readonly tokenBudget: number;
}

export interface RepoMapResult {
  readonly ranked: readonly RepoMapRankedSymbol[];
  readonly rendered: string;
  readonly estimatedTokens: number;
  readonly truncated: boolean;
}

const stableSymbolId = (symbol: Omit<RepoMapSymbol, 'id'>): RepoMapSymbolId => createHash('sha256')
  .update([
    symbol.repoPath,
    symbol.sourceDigest,
    symbol.name,
    symbol.kind,
    symbol.range.startLine,
    symbol.range.startColumn ?? '',
    symbol.range.endLine,
    symbol.range.endColumn ?? '',
  ].join('\0'), 'utf8')
  .digest('hex') as RepoMapSymbolId;

export const makeRepoMapSymbol = (input: Omit<RepoMapSymbol, 'id'>): RepoMapSymbol => ({
  ...input,
  id: stableSymbolId(input),
  references: [...input.references].sort((left, right) => left.targetId.localeCompare(right.targetId)),
});

export const emptyRepoMapGraph = (): RepoMapGraph => ({ symbols: new Map() });

export const applyRepoMapDelta = (graph: RepoMapGraph, delta: RepoMapDelta): RepoMapGraph => {
  const symbols = new Map(graph.symbols);
  for (const id of delta.removed) symbols.delete(id);
  for (const symbol of delta.upserted) symbols.set(symbol.id, symbol);
  return { symbols };
};

const queryTokens = (query: string): readonly string[] => query.toLocaleLowerCase().split(/[^\p{L}\p{N}_$]+/u).filter((token) => token.length >= 2);

const personalization = (symbol: RepoMapSymbol, input: RepoMapRenderInput): number => {
  let score = 0;
  if (input.openFiles.includes(symbol.repoPath)) score += 0.25;
  if (input.mentionedFiles.includes(symbol.repoPath)) score += 0.2;
  const lowerName = symbol.name.toLocaleLowerCase();
  const lowerPath = symbol.repoPath.toLocaleLowerCase();
  for (const token of queryTokens(input.query)) {
    if (lowerName === token) score += 0.35;
    else if (lowerName.includes(token) || lowerPath.includes(token)) score += 0.08;
  }
  if (symbol.isExported === true) score += 0.02;
  return score;
};

export const rankRepoMap = (graph: RepoMapGraph, input: RepoMapRenderInput): readonly RepoMapRankedSymbol[] => {
  const symbols = [...graph.symbols.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (symbols.length === 0) return [];
  const scores = new Map<RepoMapSymbolId, number>(symbols.map((symbol) => [symbol.id, 1 / symbols.length]));
  const inbound = new Map<RepoMapSymbolId, RepoMapSymbolId[]>();
  for (const symbol of symbols) {
    for (const reference of symbol.references) {
      if (!graph.symbols.has(reference.targetId)) continue;
      inbound.set(reference.targetId, [...(inbound.get(reference.targetId) ?? []), symbol.id]);
    }
  }
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const next = new Map<RepoMapSymbolId, number>();
    for (const symbol of symbols) {
      const incoming = inbound.get(symbol.id) ?? [];
      const propagated = incoming.reduce((sum, sourceId) => sum + (scores.get(sourceId) ?? 0) / Math.max(1, graph.symbols.get(sourceId)?.references.length ?? 0), 0);
      next.set(symbol.id, 0.15 / symbols.length + 0.85 * propagated + personalization(symbol, input) / 20);
    }
    for (const symbol of symbols) scores.set(symbol.id, next.get(symbol.id) ?? 0);
  }
  return symbols.map((symbol) => ({ symbol, score: (scores.get(symbol.id) ?? 0) + personalization(symbol, input) }))
    .sort((left, right) => right.score - left.score || left.symbol.repoPath.localeCompare(right.symbol.repoPath) || left.symbol.name.localeCompare(right.symbol.name));
};

export const renderRepoMap = (
  ranked: readonly RepoMapRankedSymbol[],
  tokenBudget: number,
): RepoMapResult => {
  const safeBudget = Number.isSafeInteger(tokenBudget) && tokenBudget > 0 ? tokenBudget : 1;
  const lines: string[] = [];
  let estimatedTokens = 0;
  let truncated = false;
  for (const item of ranked) {
    const line = `${item.symbol.repoPath}:${item.symbol.range.startLine} ${item.symbol.kind} ${item.symbol.name}`;
    const lineTokens = Math.max(1, Math.ceil(line.length / 4));
    if (estimatedTokens + lineTokens > safeBudget) {
      truncated = true;
      break;
    }
    lines.push(line);
    estimatedTokens += lineTokens;
  }
  return { ranked, rendered: lines.join('\n'), estimatedTokens, truncated };
};

export const renderRepoMapFor = (graph: RepoMapGraph, input: RepoMapRenderInput): RepoMapResult =>
  renderRepoMap(rankRepoMap(graph, input), input.tokenBudget);
