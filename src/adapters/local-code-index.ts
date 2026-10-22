import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  createCodeIndex,
  indexCandidate,
  makeCandidateId,
  makeCodeCandidate,
  type CandidateId,
  type CodeCandidate,
  type CodeIndex,
  type Generation,
  type IndexCoverageFailure,
  type IndexCoverageSummary,
  type IndexFileIdentity,
  type SemanticAnchorRange,
  type SourceRange,
} from '../domain/retrieval.js';
import type {
  StructuralAnalysisPort,
  WorkspaceFilePort,
} from '../application/ports.js';
import type { StructuralSymbol } from '../domain/semantic.js';
import { decodeStrictSourceText } from '../domain/source-text.js';
import type { ContentDigest, RepoPath, WorkspaceId } from '../domain/workspace.js';
import { isSensitiveSourcePath } from '../domain/sensitive-path.js';
import { workspaceManifestFromSnapshot, type WorkspaceManifest } from '../domain/workspace-manifest.js';
import { structuralExtensions, structuralLanguageForPath } from '../domain/structural-language.js';

export interface LocalCodeIndexBuild {
  readonly index: CodeIndex;
  readonly warnings: readonly string[];
  readonly indexedPaths: readonly RepoPath[];
  readonly coverage: IndexCoverageSummary;
  /** Exact digest membership for every in-scope source successfully read. */
  readonly fileManifest: readonly IndexFileIdentity[];
  /** Authoritative manifest captured by the same workspace snapshot as the index. */
  readonly workspaceManifest: WorkspaceManifest;
}

export interface LocalCodeIndexerOptions {
  readonly generation: number;
  /** Previous verified build used for request-time changed-file catch-up. */
  readonly previous?: LocalCodeIndexBuild;
  readonly extensions?: readonly string[];
  // Selected structural provider. There is deliberately no parser fallback: a
  // missing provider is an explicit coverage failure.
  readonly structural?: StructuralAnalysisPort;
  /** Human-readable parser/grammar identity retained in the coverage manifest. */
  readonly parserVersion?: string;
  /** Include/exclude configuration identity; changes invalidate warm reuse. */
  readonly scopeFingerprint?: string;
}

interface Span {
  readonly name: string;
  readonly kind: StructuralSymbol['kind'];
  readonly language?: string;
  readonly isExported?: boolean;
  readonly range: SourceRange;
  readonly semanticAnchor?: SemanticAnchorRange;
  readonly content: string;
}

const defaultExtensions = structuralExtensions();

const coverageFailureKinds: readonly IndexCoverageFailure['kind'][] = [
  'read_failed',
  'binary_source',
  'invalid_utf8',
  'digest_raced',
  'structural_failed',
  'digest_mismatch',
  'parser_partial',
  'unsupported_parser',
];

const snapshotDigest = (snapshot: {
  readonly headRevision: string;
  readonly files: readonly { readonly repoPath: RepoPath; readonly digest: ContentDigest; readonly sizeBytes: number; readonly state: string }[];
  readonly removedPaths: readonly RepoPath[];
  readonly gitStatus?: string;
}): ContentDigest => createHash('sha256')
  .update(JSON.stringify({
    headRevision: snapshot.headRevision,
    files: [...snapshot.files]
      .map((file) => [file.repoPath, file.digest, file.sizeBytes, file.state])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    removedPaths: [...snapshot.removedPaths].sort(),
    gitStatus: snapshot.gitStatus ?? null,
  }), 'utf8')
  .digest('hex') as ContentDigest;

const candidateId = (workspaceId: WorkspaceId, repoPath: RepoPath, digest: ContentDigest, span: Span): string =>
  createHash('sha256')
    .update([workspaceId, repoPath, digest, span.name, span.range.startLine, span.range.startColumn, span.range.endLine, span.range.endColumn,
      span.semanticAnchor?.line ?? '', span.semanticAnchor?.byteColumn ?? '',
      span.semanticAnchor?.endLine ?? '', span.semanticAnchor?.endByteColumn ?? ''].join(':'))
    .digest('hex');

/** Convert an authoritative absolute UTF-8 byte range to the indexed source range. */
export const sourceRangeFromByteOffsets = (
  source: Uint8Array,
  startOffset: number,
  endOffset: number,
): SourceRange | undefined => {
  if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset)
    || startOffset < 0 || endOffset <= startOffset || endOffset > source.byteLength) return undefined;
  const bytes = Buffer.from(source);
  const lineStarts = [0];
  for (let offset = 0; offset < bytes.length; offset += 1) {
    if (bytes[offset] === 10) lineStarts.push(offset + 1);
  }
  const lineForOffset = (offset: number): number | undefined => {
    let line = 0;
    for (let index = 0; index < lineStarts.length; index += 1) {
      const lineStart = lineStarts[index];
      if (lineStart === undefined || lineStart > offset) break;
      line = index;
    }
    return line + 1;
  };
  const startLine = lineForOffset(startOffset);
  const endLine = lineForOffset(endOffset);
  if (startLine === undefined || endLine === undefined) return undefined;
  const startLineOffset = lineStarts[startLine - 1];
  const endLineOffset = lineStarts[endLine - 1];
  if (startLineOffset === undefined || endLineOffset === undefined) return undefined;
  return {
    startLine,
    startColumn: startOffset - startLineOffset + 1,
    endLine,
    endColumn: endOffset - endLineOffset + 1,
  };
};

// Structural providers report UTF-8 byte columns (zero-based) and may also
// report exact byte offsets. Prefer offsets when available so the provider's
// span and authoritative source bytes cannot drift at Unicode boundaries.
const structuralSpans = (
  source: Uint8Array,
  symbols: readonly StructuralSymbol[],
): readonly Span[] => {
  const bytes = Buffer.from(source);
  const lineStarts = [0];
  for (let offset = 0; offset < bytes.length; offset += 1) {
    if (bytes[offset] === 10) lineStarts.push(offset + 1);
  }
  return symbols.flatMap((symbol): Span[] => {
    const start = symbol.startByteOffset ?? (lineStarts[symbol.startLine - 1] ?? -1) + symbol.startColumn - 1;
    const end = symbol.endByteOffset ?? (lineStarts[symbol.endLine - 1] ?? -1) + symbol.endColumn - 1;
    if (start < 0 || end <= start || end > bytes.length) return [];
    const range = symbol.startByteOffset !== undefined && symbol.endByteOffset !== undefined
      ? sourceRangeFromByteOffsets(bytes, symbol.startByteOffset, symbol.endByteOffset)
      : { startLine: symbol.startLine, startColumn: symbol.startColumn, endLine: symbol.endLine, endColumn: symbol.endColumn };
    if (range === undefined) return [];
    return [{
      name: symbol.name,
      kind: symbol.kind,
      ...(symbol.language === undefined ? {} : { language: symbol.language }),
      ...(symbol.isExported === undefined ? {} : { isExported: symbol.isExported }),
      range,
      ...(symbol.nameStartLine === undefined || symbol.nameStartColumn === undefined
        || symbol.nameEndLine === undefined || symbol.nameEndColumn === undefined
        ? {}
        : { semanticAnchor: {
          line: symbol.nameStartLine, byteColumn: symbol.nameStartColumn,
          endLine: symbol.nameEndLine, endByteColumn: symbol.nameEndColumn,
        } }),
      content: bytes.subarray(start, end).toString('utf8'),
    }];
  });
};

export const buildLocalCodeIndex = (
  files: WorkspaceFilePort,
  workspaceId: WorkspaceId,
  rootPath: string,
  options: LocalCodeIndexerOptions,
): Effect.Effect<Result<LocalCodeIndexBuild, ReturnType<typeof domainError>>> =>
  Effect.gen(function* () {
    const extensions = new Set(options.extensions ?? defaultExtensions);
    const snapshot = yield* files.snapshot(rootPath, Date.now());
    if (snapshot._tag === 'Err') return snapshot;
    const sourceSnapshotDigest = snapshotDigest(snapshot.value);
    const workspaceManifest = workspaceManifestFromSnapshot(
      snapshot.value,
      options.scopeFingerprint ?? createHash('sha256').update(JSON.stringify({
        extensions: [...extensions].sort(),
        sensitivePathPolicy: 'default-v1',
      }), 'utf8').digest('hex'),
    );
    const generation = options.generation as Generation;
    const parserVersion = options.parserVersion
      ?? (options.structural === undefined ? 'unconfigured-structural-provider' : 'unverified-structural-provider');
    const warnings: string[] = [];
    const indexedPaths: RepoPath[] = [];
    const coverageFailures: IndexCoverageFailure[] = [];
    const fileManifest = new Map<RepoPath, { sourceDigest: ContentDigest; candidateIds: CandidateId[] }>();
    let attemptedPaths = 0;
    let policyExcludedPaths = 0;
    let outOfScopePaths = 0;
    const previous = options.previous;
    const canReusePreviousFiles = previous !== undefined
      && previous.workspaceManifest.scopeFingerprint === workspaceManifest.scopeFingerprint;
    const previousFiles = new Map(previous?.fileManifest.map((file) => [file.repoPath, file] as const) ?? []);
    const previousCandidates = new Map<RepoPath, readonly CodeCandidate[]>(
      [...(previous?.index.candidates ?? [])].reduce((entries, candidate) => {
        const current = entries.get(candidate.repoPath) ?? [];
        entries.set(candidate.repoPath, [...current, candidate]);
        return entries;
      }, new Map<RepoPath, readonly CodeCandidate[]>()),
    );
    const previousFailures = new Map<RepoPath, readonly IndexCoverageFailure[]>(
      [...(previous?.coverage.failures ?? [])].reduce((entries, failure) => {
        const current = entries.get(failure.repoPath) ?? [];
        entries.set(failure.repoPath, [...current, failure]);
        return entries;
      }, new Map<RepoPath, readonly IndexCoverageFailure[]>()),
    );
    const previousWarnings = new Map<RepoPath, readonly string[]>(
      [...(previous?.warnings ?? [])].reduce((entries, warning) => {
        const path = warning.split(':', 1)[0] as RepoPath;
        const current = entries.get(path) ?? [];
        entries.set(path, [...current, warning]);
        return entries;
      }, new Map<RepoPath, readonly string[]>()),
    );
    const reusableCandidates: CodeCandidate[] = [];
    const reusablePaths = new Set<RepoPath>();
    if (canReusePreviousFiles && previous !== undefined) {
      for (const observation of snapshot.value.files) {
        const prior = previousFiles.get(observation.repoPath);
        if (prior === undefined || prior.sourceDigest !== observation.digest) continue;
        const candidates = previousCandidates.get(observation.repoPath) ?? [];
        reusableCandidates.push(...candidates.map((candidate) => ({
          ...candidate,
          generation,
          indexedAtMs: Date.now(),
        })));
        reusablePaths.add(observation.repoPath);
        for (const failure of previousFailures.get(observation.repoPath) ?? []) {
          coverageFailures.push(failure);
        }
        warnings.push(...(previousWarnings.get(observation.repoPath) ?? []));
      }
    }
    const indexResult = createCodeIndex(options.generation, reusableCandidates);
    if (indexResult._tag === 'Err') return indexResult;
    let index = indexResult.value;
    if (options.structural === undefined) {
      warnings.push('Structural provider is not configured; no parser fallback is used');
    }
    for (const observation of snapshot.value.files) {
      // Explicitly enforce the default local source exclusions before source text
      // can reach an embedding provider. Filtering just on extension is unsafe.
      if (isSensitiveSourcePath(observation.repoPath)) {
        policyExcludedPaths += 1;
        continue;
      }
      const extension = observation.repoPath.slice(observation.repoPath.lastIndexOf('.')).toLocaleLowerCase();
      if (!extensions.has(extension)) {
        outOfScopePaths += 1;
        continue;
      }
      attemptedPaths += 1;
      if (reusablePaths.has(observation.repoPath)) {
        const prior = previousFiles.get(observation.repoPath);
        if (prior === undefined || prior.sourceDigest !== observation.digest) {
          return err(domainError('WORKTREE_RACED', observation.repoPath, 'reused structural identity no longer matches the authoritative snapshot'));
        }
        fileManifest.set(observation.repoPath, {
          sourceDigest: observation.digest,
          candidateIds: [...(previousCandidates.get(observation.repoPath) ?? [])].map((candidate) => candidate.candidateId),
        });
        if (previous?.indexedPaths.includes(observation.repoPath)) indexedPaths.push(observation.repoPath);
        continue;
      }
      const exact = yield* files.readExact(rootPath, observation.repoPath);
      if (exact._tag === 'Err') {
        warnings.push(observation.repoPath + ': ' + exact.error.code);
        coverageFailures.push({
          repoPath: observation.repoPath,
          kind: exact.error.code === 'WORKTREE_RACED' ? 'digest_raced' : 'read_failed',
          code: exact.error.code,
        });
        continue;
      }
      if (exact.value.digest !== observation.digest) {
        warnings.push(observation.repoPath + ': source digest changed after workspace snapshot');
        coverageFailures.push({ repoPath: observation.repoPath, kind: 'digest_raced' });
        continue;
      }
      fileManifest.set(observation.repoPath, {
        sourceDigest: exact.value.digest,
        candidateIds: [],
      });
      const decoded = decodeStrictSourceText(exact.value.bytes);
      if (decoded._tag === 'Err') {
        warnings.push(observation.repoPath + ': ' + decoded.kind);
        coverageFailures.push({ repoPath: observation.repoPath, kind: decoded.kind });
        continue;
      }
      const source = decoded.text;
      if (source.length === 0) {
        indexedPaths.push(observation.repoPath);
        continue;
      }

      let spans: readonly Span[];
      if (options.structural !== undefined) {
        if (structuralLanguageForPath(observation.repoPath) === undefined) {
          warnings.push(observation.repoPath + ': ast-grep language not configured for this language');
          coverageFailures.push({ repoPath: observation.repoPath, kind: 'unsupported_parser' });
          continue;
        }
        const analyzed = yield* options.structural.extract({ repoPath: observation.repoPath, source: exact.value.bytes });
        if (analyzed._tag === 'Err') {
          warnings.push(observation.repoPath + ': structural provider unavailable (' + analyzed.error.code + ')');
          coverageFailures.push({ repoPath: observation.repoPath, kind: 'structural_failed', code: analyzed.error.code });
          continue;
        }
        const analyzedValue = analyzed.value;
        if (analyzedValue.sourceDigest !== exact.value.digest) {
          warnings.push(observation.repoPath + ': structural source digest mismatch');
          coverageFailures.push({ repoPath: observation.repoPath, kind: 'digest_mismatch' });
          continue;
        }
        if (analyzedValue.hasSyntaxErrors) {
          warnings.push(observation.repoPath + ': structural provider reports syntax errors; parseable symbols are partial evidence');
          coverageFailures.push({ repoPath: observation.repoPath, kind: 'parser_partial' });
        }
        spans = structuralSpans(exact.value.bytes, analyzedValue.symbols);
      } else {
        warnings.push(observation.repoPath + ': structural provider is not configured; file skipped');
        coverageFailures.push({ repoPath: observation.repoPath, kind: 'structural_failed', code: 'PROVIDER_NOT_CONFIGURED' });
        continue;
      }
      for (const span of spans) {
        const id = makeCandidateId(candidateId(workspaceId, observation.repoPath, exact.value.digest, span));
        if (id._tag === 'Err') return id;
        const candidate = makeCodeCandidate({
          candidateId: id.value,
          workspaceId,
          repoPath: observation.repoPath,
          range: span.range,
          symbolName: span.name,
          structuralKind: span.kind,
          ...(span.language === undefined ? {} : { structuralLanguage: span.language }),
          ...(span.isExported === undefined ? {} : { structuralExported: span.isExported }),
          ...(span.semanticAnchor === undefined ? {} : { semanticAnchor: span.semanticAnchor }),
          text: span.content,
          sourceDigest: exact.value.digest,
          generation,
          indexedAtMs: Date.now(),
        });
        if (candidate._tag === 'Err') return candidate;
        const next = indexCandidate(index, candidate.value);
        if (next._tag === 'Err') return next;
        index = next.value;
        fileManifest.get(observation.repoPath)?.candidateIds.push(candidate.value.candidateId);
      }
      indexedPaths.push(observation.repoPath);
    }
    return ok({
      index,
      warnings,
      indexedPaths,
      coverage: {
        schemaVersion: 1,
        sourceSnapshotDigest,
        parserVersion,
        attemptedPaths,
        indexedPaths: indexedPaths.length,
        policyExcludedPaths,
        outOfScopePaths,
        failedPaths: coverageFailures.length,
        failureCounts: coverageFailureKinds.reduce<Record<IndexCoverageFailure['kind'], number>>((counts, kind) => {
          counts[kind] = coverageFailures.filter((failure) => failure.kind === kind).length;
          return counts;
        }, {
          read_failed: 0,
          binary_source: 0,
          invalid_utf8: 0,
          digest_raced: 0,
          structural_failed: 0,
          digest_mismatch: 0,
          parser_partial: 0,
          unsupported_parser: 0,
        }),
        failures: coverageFailures,
      },
      fileManifest: [...fileManifest.entries()]
        .map(([repoPath, value]) => ({
          repoPath,
          sourceDigest: value.sourceDigest,
          candidateIds: [...value.candidateIds].sort(),
        }))
        .sort((left, right) => left.repoPath.localeCompare(right.repoPath)),
      workspaceManifest,
    });
  });
