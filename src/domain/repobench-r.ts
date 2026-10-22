import { canonicalBenchmarkCandidateId, sha256 } from './retrieval-benchmark.js';
import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { RetrievalHoldout, RetrievalHoldoutCase, RetrievalHoldoutRepository } from './retrieval-quality-evaluation.js';
import {
  retrievalSourceManifestExclusions,
  retrievalSourceManifestSha256,
  type RetrievalSourceManifestEntry,
} from './retrieval-source-manifest.js';

export interface RepoBenchContextSnippet {
  readonly identifier?: string;
  readonly path: string;
  readonly snippet: string;
}

export interface RepoBenchRecord {
  readonly id: string;
  readonly repoName: string;
  /** Current file where the completion/query originates. */
  readonly filePath: string;
  /** Cross-file snippets supplied by RepoBench-R. */
  readonly context: readonly RepoBenchContextSnippet[];
  readonly goldSnippetIndex: number;
  readonly importStatement?: string;
  readonly code: string;
  readonly nextLine?: string;
}

export interface RepoBenchDatasetIdentity {
  readonly datasetId: 'tianyang/repobench-r';
  readonly config: 'python_cff' | 'python_cfr' | 'java_cff' | 'java_cfr';
  readonly split: 'test_easy' | 'test_hard' | 'train_easy' | 'train_hard';
  /** Immutable dataset revision or export identity. */
  readonly revision: string;
  /** SHA-256 of the exact input bytes used to construct the records. */
  readonly recordsSha256: string;
}

export interface RepoBenchRepositoryIdentity {
  readonly id: string;
  /** Exact checkout revision used for source verification. */
  readonly revision: string;
  /** SHA-256 of the immutable source manifest selected by the operator. */
  readonly sourceManifestSha256: string;
}

export type RepoBenchSourceManifestEntry = RetrievalSourceManifestEntry;
export const repoBenchSourceManifestExclusions = retrievalSourceManifestExclusions;
export const repoBenchSourceManifestSha256 = retrievalSourceManifestSha256;

export interface RepoBenchManifest {
  readonly schemaVersion: 1;
  readonly dataset: RepoBenchDatasetIdentity;
  readonly repositories: readonly RepoBenchRepositoryIdentity[];
}

export interface RepoBenchStructuralCandidate {
  readonly range: {
    readonly startLine: number;
    readonly endLine: number;
    readonly startColumn: number;
    readonly endColumn: number;
  };
  readonly startByteOffset: number;
  readonly endByteOffset: number;
}

export interface RepoBenchSourceFile {
  readonly repositoryId: string;
  readonly repoPath: string;
  readonly source: string;
  readonly sourceDigest: string;
  /** Exact structural candidates produced by the same ast-grep outline contract ACE indexes. */
  readonly structuralCandidates: readonly RepoBenchStructuralCandidate[];
}

export interface RepoBenchInvalidRow {
  readonly recordId: string;
  readonly repositoryId: string;
  readonly repoPath: string;
  readonly reason: 'record_invalid'
  | 'repository_unbound'
  | 'gold_index_invalid'
  | 'gold_context_invalid'
  | 'gold_snippet_empty'
  | 'gold_snippet_not_found'
  | 'gold_snippet_ambiguous'
  | 'gold_structural_candidate_not_found';
}

export interface RepoBenchMappedRow {
  readonly recordId: string;
  readonly repositoryId: string;
  readonly repoPath: string;
  readonly sourceDigest: string;
  /** Exact RepoBench gold snippet span, retained for audit. */
  readonly goldRange: {
    readonly startLine: number;
    readonly endLine: number;
    readonly startColumn: number;
    readonly endColumn: number;
  };
  /** Minimal ACE structural candidate(s) that contain the exact gold snippet. */
  readonly relevantCandidateIds: readonly string[];
  readonly querySha256: string;
}

export interface RepoBenchMapping {
  readonly holdout: RetrievalHoldout;
  readonly mappedRows: readonly RepoBenchMappedRow[];
  readonly invalidRows: readonly RepoBenchInvalidRow[];
}

const sha256Hex = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const revision = (value: string): boolean => /^[a-f0-9]{40,64}$/iu.test(value);
const nonEmpty = (value: string): boolean => value.trim().length > 0;
const safeRepoPath = (value: string): boolean => {
  const normalized = value.replaceAll('\\', '/');
  return normalized.length > 0
    && !normalized.startsWith('/')
    && !normalized.split('/').some((part) => part === '..' || part === '');
};

const sourceKey = (repositoryId: string, repoPath: string): string => `${repositoryId}\0${repoPath}`;

const lineStarts = (source: string): readonly number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
};

const positionFor = (
  source: string,
  starts: readonly number[],
  offset: number,
): { readonly line: number; readonly byteColumn: number } => {
  let lineIndex = 0;
  for (let index = 1; index < starts.length; index += 1) {
    if ((starts[index] as number) > offset) break;
    lineIndex = index;
  }
  const lineStart = starts[lineIndex] as number;
  return {
    line: lineIndex + 1,
    byteColumn: Buffer.byteLength(source.slice(lineStart, offset), 'utf8') + 1,
  };
};

const exactOccurrences = (source: string, snippet: string): readonly number[] => {
  const offsets: number[] = [];
  let offset = source.indexOf(snippet);
  while (offset >= 0) {
    offsets.push(offset);
    offset = source.indexOf(snippet, offset + Math.max(snippet.length, 1));
  }
  return offsets;
};

const queryFor = (record: RepoBenchRecord): string => [record.importStatement ?? '', record.code]
  .filter(nonEmpty)
  .join('\n');

const invalid = (
  record: RepoBenchRecord,
  reason: RepoBenchInvalidRow['reason'],
  repoPath: string = record.filePath,
): RepoBenchInvalidRow => ({
  recordId: record.id,
  repositoryId: record.repoName,
  repoPath,
  reason,
});

const validateManifest = (manifest: RepoBenchManifest): Result<void, DomainError> => {
  if (manifest.schemaVersion !== 1
    || manifest.dataset.datasetId !== 'tianyang/repobench-r'
    || !revision(manifest.dataset.revision)
    || !sha256Hex(manifest.dataset.recordsSha256)
    || manifest.repositories.length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'repobench_r.manifest', 'RepoBench-R manifest identity is invalid'));
  }
  const ids = new Set<string>();
  for (const repository of manifest.repositories) {
    if (!nonEmpty(repository.id) || ids.has(repository.id)
      || !revision(repository.revision) || !sha256Hex(repository.sourceManifestSha256)) {
      return err(domainError('INVALID_BENCHMARK', 'repobench_r.repositories', 'repository bindings require unique ids, revisions and source manifest digests'));
    }
    ids.add(repository.id);
  }
  return ok(undefined);
};

export const mapRepoBenchRecords = (
  manifest: RepoBenchManifest,
  records: readonly RepoBenchRecord[],
  sources: ReadonlyMap<string, RepoBenchSourceFile>,
): Result<RepoBenchMapping, DomainError> => {
  const manifestResult = validateManifest(manifest);
  if (manifestResult._tag === 'Err') return manifestResult;
  const repositories = new Map(manifest.repositories.map((repository) => [repository.id, repository] as const));
  const cases: RetrievalHoldoutCase[] = [];
  const mappedRows: RepoBenchMappedRow[] = [];
  const invalidRows: RepoBenchInvalidRow[] = [];
  const caseIds = new Set<string>();

  for (const record of records) {
    const repository = repositories.get(record.repoName);
    if (!nonEmpty(record.id) || caseIds.has(record.id) || !safeRepoPath(record.filePath) || !nonEmpty(record.code)) {
      invalidRows.push(invalid(record, 'record_invalid'));
      continue;
    }
    caseIds.add(record.id);
    if (repository === undefined) {
      invalidRows.push(invalid(record, 'repository_unbound'));
      continue;
    }
    if (!Number.isSafeInteger(record.goldSnippetIndex)
      || record.goldSnippetIndex < 0
      || record.goldSnippetIndex >= record.context.length) {
      invalidRows.push(invalid(record, 'gold_index_invalid'));
      continue;
    }
    const goldContext = record.context[record.goldSnippetIndex];
    if (goldContext === undefined || !safeRepoPath(goldContext.path)) {
      invalidRows.push(invalid(record, 'gold_context_invalid'));
      continue;
    }
    const goldSnippet = goldContext.snippet;
    if (!nonEmpty(goldSnippet)) {
      invalidRows.push(invalid(record, 'gold_snippet_empty', goldContext.path));
      continue;
    }
    const source = sources.get(sourceKey(record.repoName, goldContext.path));
    if (source === undefined) {
      return err(domainError(
        'INVALID_BENCHMARK',
        `repobench_r.sources.${record.repoName}.${goldContext.path}`,
        'gold cross-file source snapshot is missing; benchmark must be blocked rather than synthesized',
      ));
    }
    if (source.repositoryId !== repository.id || source.repoPath !== goldContext.path || !sha256Hex(source.sourceDigest)
      || sha256(source.source) !== source.sourceDigest) {
      return err(domainError('INVALID_BENCHMARK', `repobench_r.sources.${record.id}`, 'source identity is inconsistent'));
    }
    const offsets = exactOccurrences(source.source, goldSnippet);
    if (offsets.length === 0) {
      invalidRows.push(invalid(record, 'gold_snippet_not_found', goldContext.path));
      continue;
    }
    if (offsets.length !== 1) {
      invalidRows.push(invalid(record, 'gold_snippet_ambiguous', goldContext.path));
      continue;
    }
    const startOffset = offsets[0] as number;
    const endOffset = startOffset + goldSnippet.length;
    const goldStartByteOffset = Buffer.byteLength(source.source.slice(0, startOffset), 'utf8');
    const goldEndByteOffset = Buffer.byteLength(source.source.slice(0, endOffset), 'utf8');
    const starts = lineStarts(source.source);
    const start = positionFor(source.source, starts, startOffset);
    const end = positionFor(source.source, starts, endOffset);
    const range = {
      startLine: start.line,
      endLine: end.line,
      startColumn: start.byteColumn,
      endColumn: end.byteColumn,
    };
    const containing = source.structuralCandidates.filter((candidate) =>
      candidate.startByteOffset <= goldStartByteOffset && candidate.endByteOffset >= goldEndByteOffset);
    if (containing.length === 0) {
      invalidRows.push(invalid(record, 'gold_structural_candidate_not_found', goldContext.path));
      continue;
    }
    const smallestBytes = Math.min(...containing.map((candidate) => candidate.endByteOffset - candidate.startByteOffset));
    const relevantCandidateIds = [...new Set(containing
      .filter((candidate) => candidate.endByteOffset - candidate.startByteOffset === smallestBytes)
      .map((candidate) => canonicalBenchmarkCandidateId(
        repository.id,
        goldContext.path,
        source.sourceDigest,
        candidate.range,
      )))];
    const query = queryFor(record);
    cases.push({
      id: record.id,
      query,
      relevantCandidateIds,
      repositoryId: repository.id,
      critical: true,
      kind: 'exact_symbol_or_config',
    });
    mappedRows.push({
      recordId: record.id,
      repositoryId: repository.id,
      repoPath: goldContext.path,
      sourceDigest: source.sourceDigest,
      goldRange: range,
      relevantCandidateIds,
      querySha256: sha256(query),
    });
  }

  if (mappedRows.length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'repobench_r.records', 'no unambiguous RepoBench-R rows mapped to exact source spans'));
  }
  const holdoutRepositories: RetrievalHoldoutRepository[] = manifest.repositories.map((repository) => ({
    id: repository.id,
    revision: repository.revision,
    sourceManifestSha256: repository.sourceManifestSha256,
  }));
  const usedRepositories = new Set(cases.map((item) => item.repositoryId));
  if (holdoutRepositories.some((repository) => !usedRepositories.has(repository.id))) {
    return err(domainError('INVALID_BENCHMARK', 'repobench_r.repositories', 'every bound source repository must contribute a mapped case'));
  }
  return ok({
    holdout: {
      schemaVersion: 1,
      status: 'frozen_multi_repository_holdout',
      repositories: holdoutRepositories,
      cases,
    },
    mappedRows,
    invalidRows,
  });
};

export const repoBenchSourceKey = sourceKey;
