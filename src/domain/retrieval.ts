import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { ContentDigest, RepoPath, WorkspaceId } from './workspace.js';
import type { SourceCoverage } from './source-coverage.js';

export type CandidateId = string & { readonly __brand: 'CandidateId' };
export type RequestId = string & { readonly __brand: 'RetrievalRequestId' };
export type Generation = number & { readonly __brand: 'IndexGeneration' };
export type EvidenceId = string & { readonly __brand: 'EvidenceId' };

export interface SourceRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn?: number;
  readonly endColumn?: number;
}

export interface SemanticAnchorRange {
  readonly line: number;
  readonly byteColumn: number;
  readonly endLine: number;
  readonly endByteColumn: number;
}

export interface CodeCandidate {
  readonly candidateId: CandidateId;
  readonly workspaceId: WorkspaceId;
  readonly repoPath: RepoPath;
  readonly range: SourceRange;
  readonly symbolName?: string;
  /** Exact identifier range. Columns are one-based UTF-8 byte offsets; end is exclusive. */
  readonly semanticAnchor?: SemanticAnchorRange;
  readonly text: string;
  readonly sourceDigest: ContentDigest;
  readonly generation: Generation;
  readonly indexedAtMs: number;
  /** Optional explicit claim topic used for cross-source contradiction checks. */
  readonly conflictKey?: string;
  readonly conflictValue?: string;
  readonly invalidated: boolean;
}

export type CandidateFreshness = 'current' | 'stale' | 'changed_during_request' | 'unknown';

export interface RankedCandidate {
  readonly candidate: CodeCandidate;
  readonly score: number;
  readonly freshness: CandidateFreshness;
  readonly warning?: string;
}

export interface CurrentDigestLookup {
  readonly digestFor: (workspaceId: WorkspaceId, repoPath: RepoPath) => ContentDigest | undefined;
}

export interface CodeIndex {
  readonly generation: Generation;
  readonly candidates: readonly CodeCandidate[];
}

export type IndexCoverageFailureKind = 'read_failed' | 'structural_failed' | 'digest_mismatch' | 'parser_partial' | 'unsupported_parser';

export interface IndexCoverageFailure {
  readonly repoPath: RepoPath;
  readonly kind: IndexCoverageFailureKind;
  readonly code?: string;
}

export interface IndexCoverageSummary {
  readonly attemptedPaths: number;
  readonly indexedPaths: number;
  readonly policyExcludedPaths: number;
  readonly outOfScopePaths: number;
  readonly failedPaths: number;
  readonly failures: readonly IndexCoverageFailure[];
}

export interface RetrievalEvidence {
  readonly evidenceId: EvidenceId;
  readonly source: 'code' | 'structural' | 'lsp' | 'documentation' | 'memory';
  readonly citation: string;
  readonly content: string;
  readonly sourceDigest?: ContentDigest;
  readonly proofClass: 'direct' | 'derived' | 'uncertain';
  readonly freshness: CandidateFreshness;
  readonly sourceRevision?: string;
  readonly sourceTimestampMs?: number;
  /** A provider-supplied claim topic; absence means no conflict inference. */
  readonly conflictKey?: string;
  readonly conflictValue?: string;
  /** An outline, not a truncated claim: full original bytes remain available. */
  readonly contentDelivery?: 'expand';
  readonly originalSpanLines?: number;
  /** Handle for authorized, byte-exact full-source expansion via ace_expand. */
  readonly expansionHandle?: string;
  /** Exact verified AST span offset in the original artifact (UTF-8 bytes). */
  readonly expansionCursor?: string;
  /** Exact span byte count. Use with expansionCursor to avoid expanding entire files. */
  readonly expansionMaxBytes?: number;
}

export interface RetrievalConflict {
  readonly conflictKey: string;
  readonly evidenceIds: readonly EvidenceId[];
  readonly message: string;
}

export interface ContextBundle {
  readonly requestId: RequestId;
  readonly query: string;
  readonly evidence: readonly RetrievalEvidence[];
  readonly warnings: readonly string[];
  readonly partialSources: readonly string[];
  readonly complete: boolean;
  readonly sourceCoverage?: readonly SourceCoverage[];
  readonly conflicts?: readonly RetrievalConflict[];
  readonly indexCoverage?: IndexCoverageSummary;
}

export interface RetrievalProvider {
  readonly name: string;
  readonly search: (query: string) => Result<readonly RetrievalEvidence[], DomainError>;
}

export const makeCandidateId = (value: string): Result<CandidateId, DomainError> =>
  value.trim() === ''
    ? err(domainError('INVALID_RETRIEVAL', 'candidate_id', 'candidate id must not be empty'))
    : ok(value.trim() as CandidateId);

export const makeRequestId = (value: string): Result<RequestId, DomainError> =>
  value.trim() === ''
    ? err(domainError('INVALID_RETRIEVAL', 'request_id', 'request id must not be empty'))
    : ok(value.trim() as RequestId);

export const makeEvidenceId = (value: string): Result<EvidenceId, DomainError> =>
  value.trim() === ''
    ? err(domainError('INVALID_RETRIEVAL', 'evidence_id', 'evidence id must not be empty'))
    : ok(value.trim() as EvidenceId);

const validRange = (range: SourceRange): boolean =>
  Number.isSafeInteger(range.startLine) &&
  Number.isSafeInteger(range.endLine) &&
  range.startLine >= 1 &&
  range.endLine >= range.startLine;

export const makeCodeCandidate = (input: Omit<CodeCandidate, 'invalidated'> & { readonly invalidated?: boolean }): Result<CodeCandidate, DomainError> => {
  if (input.text.length === 0) return err(domainError('INVALID_RETRIEVAL', 'text', 'candidate text must not be empty'));
  if (!validRange(input.range)) return err(domainError('INVALID_RETRIEVAL', 'range', 'source range is invalid'));
  if (input.semanticAnchor !== undefined) {
    const anchor = input.semanticAnchor;
    if (![anchor.line, anchor.byteColumn, anchor.endLine, anchor.endByteColumn]
      .every((value) => Number.isSafeInteger(value) && value >= 1)
      || anchor.endLine < anchor.line
      || (anchor.endLine === anchor.line && anchor.endByteColumn <= anchor.byteColumn)) {
      return err(domainError('INVALID_RETRIEVAL', 'semantic_anchor', 'semantic anchor must be a positive non-empty one-based UTF-8 range'));
    }
  }
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
    return err(domainError('INVALID_RETRIEVAL', 'generation', 'index generation must be positive'));
  }
  return ok({ ...input, invalidated: input.invalidated ?? false });
};

export const createCodeIndex = (generation: number, candidates: readonly CodeCandidate[] = []): Result<CodeIndex, DomainError> => {
  if (!Number.isSafeInteger(generation) || generation < 1) {
    return err(domainError('INVALID_RETRIEVAL', 'generation', 'index generation must be positive'));
  }
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.candidateId)) return err(domainError('INVALID_RETRIEVAL', 'candidate_id', 'duplicate candidate id'));
    seen.add(candidate.candidateId);
  }
  return ok({ generation: generation as Generation, candidates: [...candidates] });
};

export const indexCandidate = (index: CodeIndex, candidate: CodeCandidate): Result<CodeIndex, DomainError> => {
  if (index.candidates.some((item) => item.candidateId === candidate.candidateId)) {
    return err(domainError('INVALID_RETRIEVAL', 'candidate_id', 'candidate already exists'));
  }
  return ok({ ...index, candidates: [...index.candidates, candidate] });
};

export const invalidatePath = (index: CodeIndex, repoPath: RepoPath): CodeIndex => ({
  ...index,
  candidates: index.candidates.map((candidate) =>
    candidate.repoPath === repoPath ? { ...candidate, invalidated: true } : candidate),
});

const queryTerms = (query: string): readonly string[] =>
  [...new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}_$.-]+/u).filter((term) => term.length > 0))];

export const searchCode = (
  index: CodeIndex,
  workspaceId: WorkspaceId,
  query: string,
  current: CurrentDigestLookup,
): readonly RankedCandidate[] => {
  const terms = queryTerms(query);
  return index.candidates
    .filter((candidate) => candidate.workspaceId === workspaceId && !candidate.invalidated)
    .map((candidate) => {
      const haystack = `${candidate.symbolName ?? ''} ${candidate.repoPath} ${candidate.text}`.toLocaleLowerCase();
      const exactIdentifier = candidate.symbolName !== undefined && terms.includes(candidate.symbolName.toLocaleLowerCase());
      const matched = terms.filter((term) => haystack.includes(term)).length;
      const score = (exactIdentifier ? 100 : 0) + matched / Math.max(terms.length, 1);
      const observed = current.digestFor(workspaceId, candidate.repoPath);
      const freshness: CandidateFreshness = observed === undefined
        ? 'unknown'
        : observed === candidate.sourceDigest ? 'current' : 'stale';
      return {
        candidate,
        score,
        freshness,
        ...(freshness === 'stale' ? { warning: 'indexed digest differs from current source' } : {}),
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.repoPath.localeCompare(right.candidate.repoPath));
};

export const mergeEvidence = (
  requestId: RequestId,
  query: string,
  evidence: readonly RetrievalEvidence[],
  warnings: readonly string[] = [],
  failedRequiredSources: readonly string[] = [],
): ContextBundle => {
  // Deduplicate only genuinely identical evidence records; distinct proof,
  // handles, claims and freshness must not be silently discarded.
  const byIdentity = new Map<string, RetrievalEvidence>();
  for (const item of evidence) {
    const key = JSON.stringify(item);
    if (!byIdentity.has(key)) byIdentity.set(key, item);
  }
  const conflictGroups = new Map<string, RetrievalEvidence[]>();
  for (const item of byIdentity.values()) {
    if (item.conflictKey === undefined) continue;
    const group = conflictGroups.get(item.conflictKey) ?? [];
    group.push(item);
    conflictGroups.set(item.conflictKey, group);
  }
  const conflicts: RetrievalConflict[] = [];
  for (const [conflictKey, group] of conflictGroups) {
    const sources = new Set(group.map((item) => item.source));
    const claims = new Set(group.map((item) => item.conflictValue ?? item.content));
    // Contradictions across any two distinct source classes are relevant.
    // Do not infer a conflict for differing claims inside a single source.
    if (sources.size < 2 || claims.size < 2) continue;
    const evidenceIds = group.map((item) => item.evidenceId);
    conflicts.push({
      conflictKey,
      evidenceIds,
      message: `evidence sources disagree for ${conflictKey}`,
    });
  }
  const conflictWarnings = conflicts.map((conflict) => `conflict: ${conflict.message}`);
  const partialSources = [...new Set([...evidence.filter((item) => item.freshness !== 'current').map((item) => item.source), ...failedRequiredSources])];
  const allWarnings = [...new Set([...warnings, ...conflictWarnings, ...evidence.flatMap((item) => item.freshness === 'current' ? [] : [`${item.source}: ${item.freshness}`])])];
  return {
    requestId,
    query,
    evidence: [...byIdentity.values()],
    warnings: allWarnings,
    partialSources,
    // A warning or contradiction is informative; missing/failed required sources
    // (partialSources) alone determine completeness.
    complete: partialSources.length === 0,
    ...(conflicts.length === 0 ? {} : { conflicts }),
  };
};

export const unavailableProvider = (name: string, reason: string): RetrievalProvider => ({
  name,
  search: () => err(domainError('UNSUPPORTED_PROVIDER', name, reason)),
});

export const evidenceFromCandidate = (item: RankedCandidate, id: EvidenceId): RetrievalEvidence => ({
  evidenceId: id,
  source: 'code',
  citation: `${item.candidate.repoPath}:${item.candidate.range.startLine}-${item.candidate.range.endLine}`,
  content: item.candidate.text,
  sourceDigest: item.candidate.sourceDigest,
  proofClass: item.freshness === 'current' ? 'direct' : 'uncertain',
  freshness: item.freshness,
  sourceRevision: item.candidate.sourceDigest,
  sourceTimestampMs: item.candidate.indexedAtMs,
  ...(item.candidate.conflictKey === undefined ? {} : { conflictKey: item.candidate.conflictKey }),
  ...(item.candidate.conflictValue === undefined ? {} : { conflictValue: item.candidate.conflictValue }),
});
