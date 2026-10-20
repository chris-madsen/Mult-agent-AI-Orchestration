import { createHash } from 'node:crypto';
import ts from 'typescript';
import { Effect } from 'effect';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  createCodeIndex,
  indexCandidate,
  makeCandidateId,
  makeCodeCandidate,
  type CandidateId,
  type CodeIndex,
  type Generation,
  type IndexCoverageFailure,
  type IndexCoverageSummary,
  type IndexFileIdentity,
  type SemanticAnchorRange,
  type SourceRange,
} from '../domain/retrieval.js';
import type {
  CodeCandidateCachePort,
  StructuralAnalysisCachePort,
  StructuralAnalysisPort,
  WorkspaceFilePort,
} from '../application/ports.js';
import type { StructuralAnalysis } from '../domain/semantic.js';
import { decodeStrictSourceText } from '../domain/source-text.js';
import type { ContentDigest, RepoPath, WorkspaceId } from '../domain/workspace.js';
import { isSensitiveSourcePath } from '../domain/sensitive-path.js';

export interface LocalCodeIndexBuild {
  readonly index: CodeIndex;
  readonly warnings: readonly string[];
  readonly indexedPaths: readonly RepoPath[];
  readonly coverage: IndexCoverageSummary;
  readonly structuralCacheHits: number;
  readonly structuralCacheMisses: number;
  readonly candidateCacheHits: number;
  readonly candidateCacheMisses: number;
  /** Exact digest membership for every in-scope source successfully read. */
  readonly fileManifest: readonly IndexFileIdentity[];
}

export interface LocalCodeIndexerOptions {
  readonly generation: number;
  readonly extensions?: readonly string[];
  // Selected structural provider; when absent TS compiler parsing is an explicitly
  // labelled local fallback, not evidence of Tree-sitter production readiness.
  readonly structural?: StructuralAnalysisPort;
  readonly structuralCache?: StructuralAnalysisCachePort;
  /** Lowercase SHA-256 of the actual parser/grammar/helper identity. */
  readonly structuralProviderFingerprint?: string;
  readonly candidateCache?: CodeCandidateCachePort;
  /** Lowercase SHA-256 of the candidate-builder/parser identity. */
  readonly candidateProviderFingerprint?: string;
  /** Human-readable parser/grammar identity retained in the coverage manifest. */
  readonly parserVersion?: string;
}

interface Span {
  readonly name: string;
  readonly range: SourceRange;
  readonly semanticAnchor?: SemanticAnchorRange;
  readonly content: string;
}

const defaultExtensions = ['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'];
const tsExtensions = new Set(defaultExtensions);

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

const compilerSpans = (repoPath: RepoPath, source: string): readonly Span[] => {
  const scriptKind = repoPath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(repoPath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const spans: Span[] = [];
  const visit = (node: ts.Node): void => {
    const named = ts.isFunctionDeclaration(node)
      || ts.isClassDeclaration(node)
      || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node)
      || ts.isEnumDeclaration(node)
      || ts.isMethodDeclaration(node)
      || ts.isVariableDeclaration(node);
    const declaration = node as ts.NamedDeclaration;
    if (named && declaration.name !== undefined && ts.isIdentifier(declaration.name)) {
      const start = node.getStart(file);
      const end = node.getEnd();
      if (end > start) {
        const a = file.getLineAndCharacterOfPosition(start);
        const b = file.getLineAndCharacterOfPosition(end);
        const startLineOffset = file.getPositionOfLineAndCharacter(a.line, 0);
        const endLineOffset = file.getPositionOfLineAndCharacter(b.line, 0);
        const startByteColumn = Buffer.byteLength(source.slice(startLineOffset, start), 'utf8') + 1;
        const endByteColumn = Buffer.byteLength(source.slice(endLineOffset, end), 'utf8') + 1;
        const nameStart = declaration.name.getStart(file);
        const nameEnd = declaration.name.getEnd();
        const namePoint = file.getLineAndCharacterOfPosition(nameStart);
        const nameEndPoint = file.getLineAndCharacterOfPosition(nameEnd);
        const nameLineStart = file.getPositionOfLineAndCharacter(namePoint.line, 0);
        const nameEndLineStart = file.getPositionOfLineAndCharacter(nameEndPoint.line, 0);
        const nameByteColumn = Buffer.byteLength(source.slice(nameLineStart, nameStart), 'utf8') + 1;
        const nameEndByteColumn = Buffer.byteLength(source.slice(nameEndLineStart, nameEnd), 'utf8') + 1;
        spans.push({
          name: declaration.name.text,
          range: { startLine: a.line + 1, startColumn: startByteColumn, endLine: b.line + 1, endColumn: endByteColumn },
          semanticAnchor: {
            line: namePoint.line + 1, byteColumn: nameByteColumn,
            endLine: nameEndPoint.line + 1, endByteColumn: nameEndByteColumn,
          },
          content: source.slice(start, end),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return spans;
};

// Tree-sitter columns are UTF-8 byte offsets (zero-based). Use original bytes,
// not JS string offsets, to preserve the exact symbol text including Unicode.
const treeSitterSpans = (
  source: Uint8Array,
  symbols: readonly {
    readonly name: string;
    readonly startLine: number;
    readonly startColumn: number;
    readonly endLine: number;
    readonly endColumn: number;
    readonly nameStartLine?: number;
    readonly nameStartColumn?: number;
    readonly nameEndLine?: number;
    readonly nameEndColumn?: number;
  }[],
): readonly Span[] => {
  const bytes = Buffer.from(source);
  const lineStarts = [0];
  for (let offset = 0; offset < bytes.length; offset += 1) {
    if (bytes[offset] === 10) lineStarts.push(offset + 1);
  }
  return symbols.flatMap((symbol): Span[] => {
    const start = (lineStarts[symbol.startLine - 1] ?? -1) + symbol.startColumn - 1;
    const end = (lineStarts[symbol.endLine - 1] ?? -1) + symbol.endColumn - 1;
    if (start < 0 || end <= start || end > bytes.length) return [];
    return [{
      name: symbol.name,
      range: { startLine: symbol.startLine, startColumn: symbol.startColumn, endLine: symbol.endLine, endColumn: symbol.endColumn },
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
    const indexResult = createCodeIndex(options.generation);
    if (indexResult._tag === 'Err') return indexResult;
    const generation = options.generation as Generation;
    const extensions = new Set(options.extensions ?? defaultExtensions);
    const snapshot = yield* files.snapshot(rootPath, Date.now());
    if (snapshot._tag === 'Err') return snapshot;
    const sourceSnapshotDigest = snapshotDigest(snapshot.value);
    const parserVersion = options.parserVersion
      ?? (options.structural === undefined ? `typescript/${ts.version}|compiler-spans-v1` : 'unverified-structural-provider');
    let index = indexResult.value;
    const warnings: string[] = [];
    const indexedPaths: RepoPath[] = [];
    const coverageFailures: IndexCoverageFailure[] = [];
    const fileManifest = new Map<RepoPath, { sourceDigest: ContentDigest; candidateIds: CandidateId[] }>();
    let attemptedPaths = 0;
    let policyExcludedPaths = 0;
    let outOfScopePaths = 0;
    let structuralCacheHits = 0;
    let structuralCacheMisses = 0;
    let candidateCacheHits = 0;
    let candidateCacheMisses = 0;
    if (options.structuralCache !== undefined
      && (options.structuralProviderFingerprint === undefined
        || !/^[a-f0-9]{64}$/u.test(options.structuralProviderFingerprint))) {
      return err(domainError(
        'INVALID_INPUT',
        'structural_provider_fingerprint',
        'structural cache requires an explicit lowercase SHA-256 provider fingerprint',
      ));
    }
    if (options.candidateCache !== undefined
      && (options.candidateProviderFingerprint === undefined
        || !/^[a-f0-9]{64}$/u.test(options.candidateProviderFingerprint))) {
      return err(domainError(
        'INVALID_INPUT',
        'candidate_provider_fingerprint',
        'candidate cache requires an explicit lowercase SHA-256 provider fingerprint',
      ));
    }
    if (options.structural === undefined) {
      warnings.push('Local TypeScript compiler parser fallback; approved Tree-sitter provider not configured');
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
        if (options.candidateCache !== undefined && options.candidateProviderFingerprint !== undefined) {
          const persisted = yield* options.candidateCache.put({
            workspaceId,
            repoPath: observation.repoPath,
            sourceDigest: exact.value.digest,
            providerFingerprint: options.candidateProviderFingerprint,
            entry: { candidates: [], parserPartial: false },
          });
          if (persisted._tag === 'Err') warnings.push(observation.repoPath + ': candidate cache write failed (' + persisted.error.code + ')');
        }
        indexedPaths.push(observation.repoPath);
        continue;
      }
      if (options.candidateCache !== undefined && options.candidateProviderFingerprint !== undefined) {
        const cached = yield* options.candidateCache.get({
          workspaceId,
          repoPath: observation.repoPath,
          sourceDigest: exact.value.digest,
          providerFingerprint: options.candidateProviderFingerprint,
        });
        if (cached._tag === 'Err') {
          candidateCacheMisses += 1;
          warnings.push(observation.repoPath + ': candidate cache unavailable (' + cached.error.code + '); rebuilding candidates');
        } else if (cached.value !== undefined) {
          candidateCacheHits += 1;
          if (cached.value.parserPartial) {
            warnings.push(observation.repoPath + ': cached structural analysis reports syntax errors; parseable symbols are partial evidence');
            coverageFailures.push({ repoPath: observation.repoPath, kind: 'parser_partial' });
          }
          for (const candidate of cached.value.candidates) {
            const refreshed = makeCodeCandidate({
              ...candidate,
              generation,
              indexedAtMs: Date.now(),
              invalidated: false,
            });
            if (refreshed._tag === 'Err') return refreshed;
            const next = indexCandidate(index, refreshed.value);
            if (next._tag === 'Err') return next;
            index = next.value;
            fileManifest.get(observation.repoPath)?.candidateIds.push(refreshed.value.candidateId);
          }
          indexedPaths.push(observation.repoPath);
          continue;
        } else {
          candidateCacheMisses += 1;
        }
      }

      let spans: readonly Span[];
      let parserPartial = false;
      if (options.structural !== undefined) {
        if (!tsExtensions.has(extension)) {
          warnings.push(observation.repoPath + ': Tree-sitter grammar not configured for this language');
          coverageFailures.push({ repoPath: observation.repoPath, kind: 'unsupported_parser' });
          continue;
        }
        let analyzedValue: StructuralAnalysis | undefined;
        if (options.structuralCache !== undefined && options.structuralProviderFingerprint !== undefined) {
          const cached = yield* options.structuralCache.get({
            repoPath: observation.repoPath,
            sourceDigest: exact.value.digest,
            providerFingerprint: options.structuralProviderFingerprint,
          });
          if (cached._tag === 'Ok' && cached.value !== undefined) {
            structuralCacheHits += 1;
            analyzedValue = cached.value;
          } else {
            structuralCacheMisses += 1;
            if (cached._tag === 'Err') {
              warnings.push(observation.repoPath + ': structural cache unavailable (' + cached.error.code + '); reparsing');
            }
          }
        }
        if (analyzedValue === undefined) {
          const analyzed = yield* options.structural.extract({ repoPath: observation.repoPath, source: exact.value.bytes });
          if (analyzed._tag === 'Err') {
            warnings.push(observation.repoPath + ': structural provider unavailable (' + analyzed.error.code + ')');
            coverageFailures.push({ repoPath: observation.repoPath, kind: 'structural_failed', code: analyzed.error.code });
            continue;
          }
          analyzedValue = analyzed.value;
          if (options.structuralCache !== undefined && options.structuralProviderFingerprint !== undefined) {
            const persisted = yield* options.structuralCache.put({
              analysis: analyzedValue,
              providerFingerprint: options.structuralProviderFingerprint,
            });
            if (persisted._tag === 'Err') {
              warnings.push(observation.repoPath + ': structural cache write failed (' + persisted.error.code + ')');
            }
          }
        }
        if (analyzedValue.sourceDigest !== exact.value.digest) {
          warnings.push(observation.repoPath + ': structural source digest mismatch');
          coverageFailures.push({ repoPath: observation.repoPath, kind: 'digest_mismatch' });
          continue;
        }
        if (analyzedValue.hasSyntaxErrors) {
          warnings.push(observation.repoPath + ': Tree-sitter reports syntax errors; parseable symbols are partial evidence');
          coverageFailures.push({ repoPath: observation.repoPath, kind: 'parser_partial' });
          parserPartial = true;
        }
        spans = treeSitterSpans(exact.value.bytes, analyzedValue.symbols);
      } else if (tsExtensions.has(extension)) {
        spans = compilerSpans(observation.repoPath, source);
      } else {
        warnings.push(observation.repoPath + ': no supported structural parser; file skipped');
        coverageFailures.push({ repoPath: observation.repoPath, kind: 'unsupported_parser' });
        continue;
      }
      const builtCandidates = [];
      for (const span of spans) {
        const id = makeCandidateId(candidateId(workspaceId, observation.repoPath, exact.value.digest, span));
        if (id._tag === 'Err') return id;
        const candidate = makeCodeCandidate({
          candidateId: id.value,
          workspaceId,
          repoPath: observation.repoPath,
          range: span.range,
          symbolName: span.name,
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
        builtCandidates.push(candidate.value);
      }
      if (options.candidateCache !== undefined && options.candidateProviderFingerprint !== undefined) {
        const persisted = yield* options.candidateCache.put({
          workspaceId,
          repoPath: observation.repoPath,
          sourceDigest: exact.value.digest,
          providerFingerprint: options.candidateProviderFingerprint,
          entry: { candidates: builtCandidates, parserPartial },
        });
        if (persisted._tag === 'Err') warnings.push(observation.repoPath + ': candidate cache write failed (' + persisted.error.code + ')');
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
      structuralCacheHits,
      structuralCacheMisses,
      candidateCacheHits,
      candidateCacheMisses,
      fileManifest: [...fileManifest.entries()]
        .map(([repoPath, value]) => ({
          repoPath,
          sourceDigest: value.sourceDigest,
          candidateIds: [...value.candidateIds].sort(),
        }))
        .sort((left, right) => left.repoPath.localeCompare(right.repoPath)),
    });
  });
