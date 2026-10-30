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
    // Rebind only to an unambiguous replacement at the SAME source path.
    // A global name match is not a proven semantic binding and can redirect a
    // caller to an unrelated function in another module after deletion.
    const replacementByPathNameKind = new Map<string, RepoMapSymbol[]>();
    const keyFor = (symbol: RepoMapSymbol): string =>
      [symbol.repoPath, symbol.name, symbol.kind].join('\0');
    for (const current of symbols.values()) {
      const key = keyFor(current);
      replacementByPathNameKind.set(key, [...(replacementByPathNameKind.get(key) ?? []), current]);
    }
    for (const [id, symbol] of symbols) {
      let changed = false;
      const rebound = symbol.references.flatMap((reference): RepoMapReference[] => {
        const removed = removedTargets.get(reference.targetId);
        if (removed === undefined) return [reference];
        changed = true;
        const candidates = replacementByPathNameKind.get(keyFor(removed)) ?? [];
        // An ambiguous source transition must be rebuilt from source tags;
        // choosing a random same-name symbol would fabricate a reference.
        return candidates.length !== 1 ? [] : [{ ...reference, targetId: candidates[0]!.id }];
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
 * Source-faithful adaptation of Aider RepoMap.get_ranked_tags(), pinned at
 * Aider-AI/aider@5dc9490bb35f9729ef2c95d00a19ccd30c26339c
 * aider/repomap.py:365-574. Apache-2.0; see third_party/licenses.
 *
 * ACE-specific boundary: all tags are verified, immutable structural records;
 * no Aider CLI, file reads, Tree-sitter rerun, or Python subprocess here.
 * The graph construction, definitions/references, multipliers, fallback edges,
 * personalization, and rank projection follow the upstream source's sequence.
 */
interface RepoMapFileEdge {
  readonly targetPath: RepoPath;
  readonly identifier: string;
  readonly weight: number;
}

const normalizeProbabilities = (weights: readonly number[]): readonly number[] => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return total > 0 ? weights.map((weight) => weight / total)
    : weights.map(() => 1 / Math.max(1, weights.length));
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
  const rankable = symbols.filter((symbol) => !isFileAnchor(symbol));
  if (rankable.length === 0) return [];

  // Aider: defines[name], references[name], definitions[(file, name)].
  const defines = new Map<string, Set<RepoPath>>();
  const definitions = new Map<string, RepoMapSymbol[]>();
  const definitionKey = (file: RepoPath, name: string): string => JSON.stringify([file, name]);
  for (const definition of rankable) {
    const paths = defines.get(definition.name) ?? new Set<RepoPath>();
    paths.add(definition.repoPath);
    defines.set(definition.name, paths);
    const key = definitionKey(definition.repoPath, definition.name);
    definitions.set(key, [...(definitions.get(key) ?? []), definition]);
  }

  // One ast-grep identifier occurrence is linked to EACH defining file. As
  // in pinned Aider Counter(references[ident]), count that occurrence once,
  // not N times for N possible definitions. Count distinct source symbols
  // separately; an occurrence record remains the authority on multiplicity.
  const references = new Map<string, Map<RepoPath, number>>();
  for (const source of symbols) {
    const occurrences = new Map<string, number>();
    for (const reference of source.references) {
      const target = graph.symbols.get(reference.targetId);
      if (target === undefined || isFileAnchor(target)) continue;
      const count = Math.max(1, reference.weight ?? 1);
      occurrences.set(target.name, Math.max(occurrences.get(target.name) ?? 0, count));
    }
    for (const [name, count] of occurrences) {
      const referencers = references.get(name) ?? new Map<RepoPath, number>();
      referencers.set(source.repoPath, (referencers.get(source.repoPath) ?? 0) + count);
      references.set(name, referencers);
    }
  }

  // Aider lines 465-466: only when there are ZERO references globally,
  // definitions become one fallback reference per defining file.
  if (references.size === 0) {
    for (const [name, definers] of defines) {
      references.set(name, new Map([...definers].map((file) => [file, 1])));
    }
  }

  // Aider lines 470-514: MultiDiGraph edges, including the special 0.1
  // self-edge for an unreferenced definition. Preserve parallel identifiers.
  const outgoing = new Map<RepoPath, RepoMapFileEdge[]>();
  const addEdge = (source: RepoPath, edge: RepoMapFileEdge): void => {
    outgoing.set(source, [...(outgoing.get(source) ?? []), edge]);
  };
  const mentioned = normalizedMentionedIdentifiers(input);
  for (const [name, definers] of defines) {
    if (references.has(name)) continue;
    for (const definer of definers) {
      addEdge(definer, { targetPath: definer, identifier: name, weight: 0.1 });
    }
  }
  for (const [name, referencers] of references) {
    const definers = defines.get(name);
    if (definers === undefined) continue;
    let multiplier = 1;
    const isSnake = name.includes('_') && /\p{L}/u.test(name);
    const isKebab = name.includes('-') && /\p{L}/u.test(name);
    const isCamel = /\p{Lu}/u.test(name) && /\p{Ll}/u.test(name);
    if (mentioned.has(name.toLocaleLowerCase())) multiplier *= 10;
    if ((isSnake || isKebab || isCamel) && [...name].length >= 8) multiplier *= 10;
    if (name.startsWith('_')) multiplier *= 0.1;
    if (definers.size > 5) multiplier *= 0.1;
    for (const [source, numRefs] of referencers) {
      const weight = multiplier * Math.sqrt(numRefs) * (input.openFiles.includes(source) ? 50 : 1);
      for (const targetPath of definers) {
        addEdge(source, { targetPath, identifier: name, weight });
      }
    }
  }

  // NetworkX MultiDiGraph contains edge endpoints only, NOT every unrelated
  // symbol file from the source snapshot.
  const nodes = [...new Set([...outgoing].flatMap(([source, edges]) =>
    [source, ...edges.map((edge) => edge.targetPath)]))].sort((a, b) => a.localeCompare(b));
  if (nodes.length === 0) return rankable.map((symbol) => ({ symbol, score: 0 }));

  // Aider lines 381-445: file mentions / opened files / identifier-matched
  // path components. NetworkX normalizes the positive personalization vector.
  const pathPersonalization = nodes.map((file) => {
    let weight = input.openFiles.includes(file) ? 1 : 0;
    if (input.mentionedFiles.includes(file)) weight = Math.max(weight, 1);
    if (pathTokens(file).some((part) => mentioned.has(part))) weight += 1;
    return weight;
  });
  const scores = pageRankFiles(nodes, outgoing,
    pathPersonalization.some((value) => value > 0)
      ? pathPersonalization
      : nodes.map(() => 1));

  // Aider lines 533-558: project source node rank over its outgoing weighted
  // edges and then onto (destination file, identifier) definitions.
  const projected = new Map<string, number>();
  for (const source of nodes) {
    const edges = outgoing.get(source) ?? [];
    const totalWeight = edges.reduce((sum, edge) => sum + edge.weight, 0);
    if (!(totalWeight > 0)) continue;
    for (const edge of edges) {
      const key = definitionKey(edge.targetPath, edge.identifier);
      const contribution = (scores.get(source) ?? 0) * edge.weight / totalWeight;
      projected.set(key, (projected.get(key) ?? 0) + contribution);
    }
  }

  return rankable.map((symbol) => ({
    symbol,
    score: projected.get(definitionKey(symbol.repoPath, symbol.name)) ?? 0,
  })).sort((left, right) =>
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
