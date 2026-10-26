import type { RankedCandidate } from './retrieval.js';

export interface RepoMapOptions {
  readonly maxCandidates?: number;
  readonly maxTokens?: number;
}

export interface RepoMapSelection {
  readonly candidates: readonly RankedCandidate[];
  readonly droppedCount: number;
  readonly estimatedTokens: number;
}

const terms = (query: string): readonly string[] =>
  [...new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}_$.-]+/u).filter((term) => term.length > 0))];

const estimateTokens = (candidate: RankedCandidate): number =>
  Math.max(1, Math.ceil(candidate.candidate.text.length / 4));

export const applyRepoMapRanking = (
  candidates: readonly RankedCandidate[],
  query: string,
  options: RepoMapOptions = {},
): RepoMapSelection => {
  const queryTerms = terms(query);
  const ranked = candidates.map((candidate) => {
    const symbol = candidate.candidate.symbolName?.toLocaleLowerCase() ?? '';
    const path = candidate.candidate.repoPath.toLocaleLowerCase();
    const text = candidate.candidate.text.toLocaleLowerCase();
    const symbolExact = symbol.length > 0 && queryTerms.includes(symbol);
    const symbolMatches = queryTerms.filter((term) => symbol.includes(term)).length;
    const pathMatches = queryTerms.filter((term) => path.includes(term)).length;
    const textMatches = queryTerms.filter((term) => text.includes(term)).length;
    const boost = (symbolExact ? 50 : 0) + symbolMatches * 10 + pathMatches * 4 + textMatches;
    return {
      ...candidate,
      score: candidate.score + boost,
      warning: candidate.warning === undefined
        ? 'ranked by deterministic RepoMap symbol/path/text signals'
        : candidate.warning + '; ranked by deterministic RepoMap symbol/path/text signals',
    };
  }).sort((left, right) =>
    right.score - left.score
    || left.candidate.repoPath.localeCompare(right.candidate.repoPath)
    || left.candidate.range.startLine - right.candidate.range.startLine
    || left.candidate.candidateId.localeCompare(right.candidate.candidateId));
  const maxCandidates = options.maxCandidates ?? ranked.length;
  const maxTokens = options.maxTokens ?? Number.POSITIVE_INFINITY;
  const selected: RankedCandidate[] = [];
  let estimatedTokens = 0;
  for (const candidate of ranked) {
    if (selected.length >= maxCandidates) break;
    const candidateTokens = estimateTokens(candidate);
    if (selected.length > 0 && estimatedTokens + candidateTokens > maxTokens) continue;
    selected.push(candidate);
    estimatedTokens += candidateTokens;
  }
  return {
    candidates: selected,
    droppedCount: Math.max(0, ranked.length - selected.length),
    estimatedTokens,
  };
};
