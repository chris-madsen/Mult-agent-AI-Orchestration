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
  readonly nameStartLine?: number;
  readonly nameStartColumn?: number;
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
  /** Optional identifier mentions supplied by a caller that already parsed the query. */
  readonly mentionedIdentifiers?: readonly string[];
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

const normalizeReferences = (references: readonly RepoMapReference[]): readonly RepoMapReference[] =>
  [...references.reduce((grouped, reference) => {
    const key = `${reference.kind}:${reference.targetId}`;
    const previous = grouped.get(key);
    const observed = reference.weight === undefined
      ? 1
      : Number.isFinite(reference.weight) && reference.weight > 0 ? reference.weight : 1;
    grouped.set(key, { ...reference, weight: (previous?.weight ?? 0) + observed });
    return grouped;
  }, new Map<string, RepoMapReference>()).values()]
    .sort((left, right) => left.targetId.localeCompare(right.targetId) || left.kind.localeCompare(right.kind));

export const makeRepoMapSymbol = (input: Omit<RepoMapSymbol, 'id'>): RepoMapSymbol => ({
  ...input,
  id: stableSymbolId(input),
  references: normalizeReferences(input.references),
});

export const emptyRepoMapGraph = (): RepoMapGraph => ({ symbols: new Map() });

export const applyRepoMapDelta = (graph: RepoMapGraph, delta: RepoMapDelta): RepoMapGraph => {
  const symbols = new Map(graph.symbols);
  const removedTargets = new Map(delta.removed.flatMap((id) => {
    const symbol = symbols.get(id);
    return symbol === undefined ? [] : [[id, symbol] as const];
  }));
  for (const id of delta.removed) symbols.delete(id);
  for (const symbol of delta.upserted) symbols.set(symbol.id, symbol);
  if (removedTargets.size > 0) {
    const replacementByName = new Map<string, RepoMapSymbol>();
    for (const symbol of [...symbols.values()].sort((left, right) => left.id.localeCompare(right.id))) {
      if (!replacementByName.has(symbol.name)) replacementByName.set(symbol.name, symbol);
    }
    for (const [id, symbol] of symbols) {
      let changed = false;
      const rebound = symbol.references.flatMap((reference): RepoMapReference[] => {
        const removed = removedTargets.get(reference.targetId);
        if (removed === undefined) return [reference];
        changed = true;
        const replacement = replacementByName.get(removed.name);
        return replacement === undefined ? [] : [{ ...reference, targetId: replacement.id }];
      });
      if (changed) symbols.set(id, { ...symbol, references: normalizeReferences(rebound) });
    }
  }
  return { symbols };
};

const queryTokens = (query: string): readonly string[] => query.toLocaleLowerCase().split(/[^\p{L}\p{N}_$]+/u).filter((token) => token.length >= 2);

const normalizedMentionedIdentifiers = (input: RepoMapRenderInput): ReadonlySet<string> => new Set(
  (input.mentionedIdentifiers ?? queryTokens(input.query)).map((value) => value.toLocaleLowerCase()),
);

const pathTokens = (path: RepoPath): readonly string[] => {
  const parts = path.toLocaleLowerCase().split(/[\\/]+/u).filter((part) => part.length > 0);
  const basename = parts.at(-1);
  const extensionAt = basename?.lastIndexOf('.') ?? -1;
  const stem = basename !== undefined && extensionAt > 0 ? basename.slice(0, extensionAt) : basename;
  return [...new Set([...parts, ...(basename === undefined ? [] : [basename]), ...(stem === undefined ? [] : [stem])])]
    .filter((token) => token.length >= 2);
};

/**
 * Adapted from the pinned Aider RepoMap weighting model. Aider weights
 * identifier relations before PageRank: mentioned/long identifiers matter
 * more, private identifiers matter less, and chat-file relations receive a
 * strong multiplier. ACE keeps its own typed graph and source verification;
 * only the ranking semantics are adapted here.
 */
const aiderIdentifierMultiplier = (
  name: string,
  input: RepoMapRenderInput,
  definitionCount: number,
): number => {
  const lowerName = name.toLocaleLowerCase();
  let multiplier = 1;
  if (normalizedMentionedIdentifiers(input).has(lowerName)) multiplier *= 10;
  const isSnake = name.includes('_') && /[A-Za-z]/u.test(name);
  const isKebab = name.includes('-') && /[A-Za-z]/u.test(name);
  const isCamel = /[A-Z]/u.test(name) && /[a-z]/u.test(name);
  if ((isSnake || isKebab || isCamel) && name.length >= 8) multiplier *= 10;
  if (name.startsWith('_')) multiplier *= 0.1;
  if (definitionCount > 5) multiplier *= 0.1;
  return multiplier;
};

interface RepoMapFileEdge {
  readonly targetPath: RepoPath;
  readonly identifier: string;
  readonly weight: number;
}

const personalizedFileWeights = (
  files: readonly RepoPath[],
  input: RepoMapRenderInput,
): readonly number[] => {
  const mentionedIdentifiers = normalizedMentionedIdentifiers(input);
  const base = files.length === 0 ? 0 : 1 / files.length;
  return files.map((file) => {
    const mentionedPath = input.mentionedFiles.includes(file);
    const openPath = input.openFiles.includes(file);
    const pathMentioned = pathTokens(file).some((token) => mentionedIdentifiers.has(token));
    let weight = openPath ? base : 0;
    if (mentionedPath) weight = Math.max(weight, base);
    if (pathMentioned) weight += base;
    return weight;
  });
};

const normalizeProbabilities = (weights: readonly number[]): readonly number[] => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return total > 0 ? weights.map((weight) => weight / total) : weights.map(() => 1 / Math.max(1, weights.length));
};

const isFileAnchor = (symbol: RepoMapSymbol): boolean => symbol.kind === 'repo-map-file-anchor';

/**
 * Licensed, intentionally narrow TypeScript translation of NetworkX 3.6.1
 * pagerank_alg._pagerank_scipy (lines 455-498), which Aider calls from
 * RepoMap.get_ranked_tags() via nx.pagerank(weight="weight").
 * Source: https://github.com/networkx/networkx/blob/networkx-3.6.1/networkx/algorithms/link_analysis/pagerank_alg.py
 * Copyright 2004-2025 NetworkX Developers; BSD-3-Clause; see third_party/licenses.
 * The pre-normalized adjacency lists below replace SciPy's sparse Q @ A,
 * but the initial vector, dangling redistribution, damping, and convergence
 * contract are carried over directly, not redesigned for ACE.
 */
const pageRankFiles = (
  files: readonly RepoPath[],
  outgoing: ReadonlyMap<RepoPath, readonly RepoMapFileEdge[]>,
  personalization: readonly number[],
): ReadonlyMap<RepoPath, number> => {
  const count = files.length;
  if (count === 0) return new Map();
  const alpha = 0.85;
  const tolerance = 1.0e-6;
  const maxIterations = 100;
  const p = normalizeProbabilities(personalization);
  // NetworkX nstart=None is a uniform vector, even with personalization.
  let x = new Map<RepoPath, number>(files.map((file) => [file, 1 / count]));
  const stochastic = new Map<RepoPath, readonly RepoMapFileEdge[]>();
  for (const file of files) {
    const edges = outgoing.get(file) ?? [];
    const totalWeight = edges.reduce((sum, edge) => sum + edge.weight, 0);
    stochastic.set(file, totalWeight === 0 ? []
      : edges.map((edge) => ({ ...edge, weight: edge.weight / totalWeight })));
  }
  const dangling = files.filter((file) => stochastic.get(file)?.length === 0);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const previous = x;
    const danglingMass = alpha * dangling.reduce((sum, file) => sum + (previous.get(file) ?? 0), 0);
    x = new Map(files.map((file, index) => [
      file,
      (danglingMass + (1 - alpha)) * (p[index] ?? 0),
    ]));
    for (const file of files) {
      for (const edge of stochastic.get(file) ?? []) {
        x.set(edge.targetPath,
          (x.get(edge.targetPath) ?? 0) + alpha * (previous.get(file) ?? 0) * edge.weight);
      }
    }
    const error = files.reduce((sum, file) =>
      sum + Math.abs((x.get(file) ?? 0) - (previous.get(file) ?? 0)), 0);
    if (error < count * tolerance) return x;
  }
  throw new Error(`NetworkX PageRank power iteration failed to converge after ${maxIterations} iterations`);
};

export const rankRepoMap = (graph: RepoMapGraph, input: RepoMapRenderInput): readonly RepoMapRankedSymbol[] => {
  const symbols = [...graph.symbols.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (symbols.length === 0) return [];
  const rankableSymbols = symbols.filter((symbol) => !isFileAnchor(symbol));
  if (rankableSymbols.length === 0) return [];

  const symbolsByPath = new Map<RepoPath, RepoMapSymbol[]>();
  for (const symbol of symbols) symbolsByPath.set(symbol.repoPath, [...(symbolsByPath.get(symbol.repoPath) ?? []), symbol]);
  const files = [...symbolsByPath.keys()].sort((left, right) => left.localeCompare(right));
  const definitionPaths = new Map<string, Set<RepoPath>>();
  for (const symbol of rankableSymbols) {
    const paths = definitionPaths.get(symbol.name) ?? new Set<RepoPath>();
    paths.add(symbol.repoPath);
    definitionPaths.set(symbol.name, paths);
  }
  const referenceCounts = new Map<string, { readonly sourcePath: RepoPath; readonly identifier: string; count: number }>();
  for (const source of symbols) {
    for (const reference of source.references) {
      const target = graph.symbols.get(reference.targetId);
      if (target === undefined) continue;
      const identifier = target.name;
      const key = `${source.repoPath}\0${identifier}`;
      const previous = referenceCounts.get(key);
      referenceCounts.set(key, {
        sourcePath: source.repoPath,
        identifier,
        count: (previous?.count ?? 0) + Math.max(1, reference.weight ?? 1),
      });
    }
  }
  const edgeGroups = new Map<string, RepoMapFileEdge>();
  for (const reference of referenceCounts.values()) {
    const definitions = rankableSymbols.filter((symbol) => symbol.name === reference.identifier);
    const chatFileMultiplier = input.openFiles.includes(reference.sourcePath) ? 50 : 1;
    const weight = Math.sqrt(reference.count)
      * aiderIdentifierMultiplier(reference.identifier, input, definitionPaths.get(reference.identifier)?.size ?? 0)
      * chatFileMultiplier;
    for (const targetPath of [...new Set(definitions.map((symbol) => symbol.repoPath))]) {
      const key = `${reference.sourcePath}\0${targetPath}\0${reference.identifier}`;
      const previous = edgeGroups.get(key);
      edgeGroups.set(key, {
        targetPath,
        identifier: reference.identifier,
        weight: (previous?.weight ?? 0) + weight,
      });
    }
  }
  if (referenceCounts.size === 0) {
    for (const [identifier, definers] of definitionPaths) {
      const identifierWeight = aiderIdentifierMultiplier(identifier, input, definers.size);
      for (const sourcePath of definers) {
        const weight = identifierWeight * (input.openFiles.includes(sourcePath) ? 50 : 1);
        for (const targetPath of definers) {
          edgeGroups.set(`${sourcePath}\0${targetPath}\0${identifier}`, {
            targetPath,
            identifier,
            weight,
          });
        }
      }
    }
  } else {
    const referencedIdentifiers = new Set([...referenceCounts.values()].map((reference) => reference.identifier));
    for (const definition of rankableSymbols) {
      if (referencedIdentifiers.has(definition.name)) continue;
      const key = `${definition.repoPath}\0${definition.repoPath}\0${definition.name}`;
      if (edgeGroups.has(key)) continue;
      edgeGroups.set(key, {
        targetPath: definition.repoPath,
        identifier: definition.name,
        weight: 0.1,
      });
    }
  }
  const outgoing = new Map<RepoPath, readonly RepoMapFileEdge[]>(files.map((file) => [
    file,
    [...edgeGroups.entries()]
      .filter(([key]) => key.startsWith(`${file}\0`))
      .map(([, edge]) => edge)
      .sort((left, right) => left.targetPath.localeCompare(right.targetPath) || left.identifier.localeCompare(right.identifier)),
  ]));
  const personalized = personalizedFileWeights(files, input);
  const teleport = normalizeProbabilities(personalized.some((weight) => weight > 0)
    ? personalized
    : files.map(() => 1));
  const fileScores = pageRankFiles(files, outgoing, teleport);
  const scores = new Map<RepoMapSymbolId, number>(rankableSymbols.map((symbol) => [symbol.id, 0]));
  for (const source of files) {
    const edges = outgoing.get(source) ?? [];
    const totalWeight = edges.reduce((sum, edge) => sum + edge.weight, 0);
    if (totalWeight === 0) continue;
    for (const edge of edges) {
      const definitions = (symbolsByPath.get(edge.targetPath) ?? [])
        .filter((symbol) => !isFileAnchor(symbol) && symbol.name === edge.identifier);
      if (definitions.length === 0) continue;
      const contribution = (fileScores.get(source) ?? 0) * edge.weight / totalWeight;
      for (const definition of definitions) scores.set(definition.id, (scores.get(definition.id) ?? 0) + contribution);
    }
  }
  // Pinned Aider get_ranked_tags() projects file rank ONLY through actual
  // outgoing identifier edges. It never redistributes dangling file mass
  // equally to unrelated definitions in that file.
  return rankableSymbols.map((symbol) => ({ symbol, score: scores.get(symbol.id) ?? 0 }))
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
  const grouped = new Map<RepoPath, RepoMapRankedSymbol[]>();
  for (const item of ranked) grouped.set(item.symbol.repoPath, [...(grouped.get(item.symbol.repoPath) ?? []), item]);
  let estimatedTokens = 0;
  let truncated = false;
  for (const [repoPath, items] of grouped) {
    const bodies = [...items]
      .sort((left, right) => left.symbol.range.startLine - right.symbol.range.startLine || left.symbol.name.localeCompare(right.symbol.name))
      .map((item) => {
        const firstLine = item.symbol.text.split(String.fromCharCode(10), 1)[0]?.trim();
        return `  ${item.symbol.repoPath}:${item.symbol.range.startLine} ${firstLine || `${item.symbol.kind} ${item.symbol.name}`}`;
      });
    const block = [`${repoPath}:`, ...bodies].join(String.fromCharCode(10));
    const blockTokens = Math.max(1, Math.ceil(block.length / 4));
    if (estimatedTokens + blockTokens > safeBudget) {
      truncated = true;
      continue;
    }
    lines.push(block);
    estimatedTokens += blockTokens;
  }
  return { ranked, rendered: lines.join('\n'), estimatedTokens, truncated };
};

export const renderRepoMapFor = (graph: RepoMapGraph, input: RepoMapRenderInput): RepoMapResult =>
  renderRepoMap(rankRepoMap(graph, input), input.tokenBudget);
