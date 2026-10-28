import type { ContentDigest, RepoPath } from './workspace.js';
import type { SourceRange } from './retrieval.js';

export type RepoMapSymbolId = string & { readonly __brand: 'RepoMapSymbolId' };

export interface RepoMapReference {
  readonly targetId: RepoMapSymbolId;
  readonly kind: 'definition' | 'reference';
  /** Number of observed references represented by this edge. */
  readonly weight?: number;
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

const stableSymbolId = (symbol: Omit<RepoMapSymbol, 'id'>): RepoMapSymbolId => [
  symbol.repoPath,
  symbol.sourceDigest,
  symbol.name,
  symbol.kind,
  symbol.range.startLine,
  symbol.range.startColumn ?? '',
  symbol.range.endLine,
  symbol.range.endColumn ?? '',
].join('\0') as RepoMapSymbolId;

export const makeRepoMapSymbol = (input: Omit<RepoMapSymbol, 'id'>): RepoMapSymbol => ({
  ...input,
  id: stableSymbolId(input),
  references: [...input.references.reduce((grouped, reference) => {
    const key = `${reference.kind}:${reference.targetId}`;
    const previous = grouped.get(key);
    const observed = reference.weight === undefined
      ? 1
      : Number.isFinite(reference.weight) && reference.weight > 0 ? reference.weight : 1;
    grouped.set(key, { ...reference, weight: (previous?.weight ?? 0) + observed });
    return grouped;
  }, new Map<string, RepoMapReference>()).values()]
    .sort((left, right) => left.targetId.localeCompare(right.targetId) || left.kind.localeCompare(right.kind)),
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

const identifierWeight = (name: string, input: RepoMapRenderInput): number => {
  const token = name.toLocaleLowerCase();
  if (queryTokens(input.query).includes(token)) return 4;
  if (input.mentionedFiles.some((path) => path.toLocaleLowerCase().includes(token))) return 2;
  return 1;
};

const edgeWeight = (
  reference: RepoMapReference,
  target: RepoMapSymbol,
  source: RepoMapSymbol,
  input: RepoMapRenderInput,
): number => {
  const frequency = Math.max(1, reference.weight ?? 1);
  const chatFileBoost = input.openFiles.includes(source.repoPath) ? 2 : 1;
  return Math.sqrt(frequency) * chatFileBoost * identifierWeight(target.name, input);
};

export const rankRepoMap = (graph: RepoMapGraph, input: RepoMapRenderInput): readonly RepoMapRankedSymbol[] => {
  const symbols = [...graph.symbols.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (symbols.length === 0) return [];

  // Calculate personalized teleport probabilities once. A vertex with no
  // outgoing *valid* references must redistribute its rank instead of losing
  // it. This also prevents unresolved references from diluting live edges.
  const personalWeights = symbols.map((symbol) => 1 + 8 * Math.min(1, personalization(symbol, input)));
  const totalPersonalWeight = personalWeights.reduce((sum, weight) => sum + weight, 0);
  const teleport = personalWeights.map((weight) => weight / totalPersonalWeight);
  // Adapted from the pinned Aider RepoMap idea: repeated identifier references
  // carry frequency, chat/open files personalize the graph, and rank flows
  // through weighted edges rather than a deduplicated unweighted adjacency set.
  const outgoing = new Map<RepoMapSymbolId, readonly { readonly targetId: RepoMapSymbolId; readonly weight: number }[]>(
    symbols.map((symbol) => [symbol.id, symbol.references.flatMap((reference) => {
      const target = graph.symbols.get(reference.targetId);
      return target === undefined ? [] : [{
        targetId: target.id,
        weight: edgeWeight(reference, target, symbol, input),
      }];
    })]),
  );
  const scores = new Map<RepoMapSymbolId, number>(
    symbols.map((symbol, index) => [symbol.id, teleport[index] ?? 0]),
  );
  const damping = 0.85;
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const danglingMass = symbols.reduce((sum, symbol) => (
      (outgoing.get(symbol.id)?.length ?? 0) === 0 ? sum + (scores.get(symbol.id) ?? 0) : sum
    ), 0);
    const next = new Map<RepoMapSymbolId, number>(
      symbols.map((symbol, index) => [
        symbol.id,
        ((1 - damping) + damping * danglingMass) * (teleport[index] ?? 0),
      ]),
    );
    for (const symbol of symbols) {
      const targets = outgoing.get(symbol.id) ?? [];
      if (targets.length === 0) continue;
      const totalWeight = targets.reduce((sum, target) => sum + target.weight, 0);
      for (const target of targets) {
        const share = damping * (scores.get(symbol.id) ?? 0) * target.weight / totalWeight;
        next.set(target.targetId, (next.get(target.targetId) ?? 0) + share);
      }
    }
    for (const symbol of symbols) scores.set(symbol.id, next.get(symbol.id) ?? 0);
  }
  return symbols.map((symbol) => ({ symbol, score: scores.get(symbol.id) ?? 0 }))
    .sort((left, right) =>
      right.score - left.score
      || left.symbol.repoPath.localeCompare(right.symbol.repoPath)
      || left.symbol.name.localeCompare(right.symbol.name)
      || left.symbol.id.localeCompare(right.symbol.id));
};

export const renderRepoMap = (
  ranked: readonly RepoMapRankedSymbol[],
  tokenBudget: number,
): RepoMapResult => {
  const safeBudget = Number.isSafeInteger(tokenBudget) && tokenBudget > 0 ? tokenBudget : 1;
  const lines: string[] = [];
  const renderedPaths = new Set<RepoPath>();
  let estimatedTokens = 0;
  let truncated = false;
  for (const item of ranked) {
    const header = renderedPaths.has(item.symbol.repoPath) ? '' : `${item.symbol.repoPath}:`;
    const firstLine = item.symbol.text.split(String.fromCharCode(10), 1)[0]?.trim();
    const body = `  ${item.symbol.repoPath}:${item.symbol.range.startLine} ${firstLine || `${item.symbol.kind} ${item.symbol.name}`}`;
    const line = header === '' ? body : [header, body].join(String.fromCharCode(10));
    const lineTokens = Math.max(1, Math.ceil(line.length / 4));
    if (estimatedTokens + lineTokens > safeBudget) {
      // A long high-ranked path must not prevent shorter lower-ranked entries
      // from using the remaining budget.
      truncated = true;
      continue;
    }
    lines.push(line);
    renderedPaths.add(item.symbol.repoPath);
    estimatedTokens += lineTokens;
  }
  return { ranked, rendered: lines.join('\n'), estimatedTokens, truncated };
};

export const renderRepoMapFor = (graph: RepoMapGraph, input: RepoMapRenderInput): RepoMapResult =>
  renderRepoMap(rankRepoMap(graph, input), input.tokenBudget);
