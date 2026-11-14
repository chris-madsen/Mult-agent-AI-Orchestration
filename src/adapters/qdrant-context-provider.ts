import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  evidenceFromCandidate,
  makeEvidenceId,
  makeRequestId,
  mergeEvidence,
  type CodeIndex,
  type CodeRetrievalStrategy,
  type ContextBundle,
  type IndexCoverageSummary,
  type IndexFileIdentity,
  type RankedCandidate,
  type RetrievalEvidence,
} from '../domain/retrieval.js';
import type {
  ArtifactStore,
  CodeCandidatePort,
  CodePoint,
  DocumentationPort,
  GitHistoryPort,
  MemorySearchPort,
  ProviderTraceSink,
  RerankerPort,
  SemanticAnalysisPort,
  SparseEmbeddingPort,
  SparseVector,
  VectorEmbeddingPort,
  WorkspaceFilePort,
} from '../application/ports.js';
import type { WorkspaceSync } from '../application/workspace-sync.js';
import type { RepoMapService } from '../application/repo-map-service.js';
import type { RepoMapResult } from '../domain/repo-map.js';
import {
  canonicalBenchmarkCandidateId,
  type RetrievalBenchmarkStageStatus,
  type RetrievalBenchmarkTraceSink,
} from '../domain/retrieval-benchmark.js';
import type { CodeCandidate } from '../domain/retrieval.js';
import {
  workingContextFromSnapshot,
  type RepoPath,
  type WorkingContext,
  type WorkingContextHints,
  type WorkspaceId,
} from '../domain/workspace.js';
import {
  initialSourceCoverage,
  legacySourceRequirements,
  requiredIncompleteSources,
  setSourceCoverage,
  sourceCoverageComplete,
  sourceIsRequested,
  type SourceRequirements,
} from '../domain/source-coverage.js';
import { qdrantLexicalTextForCandidate } from './http-provider-boundaries.js';
import type { QdrantSdkPort } from './qdrant-sdk-adapter.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';
import {
  diffWorkspaceManifests,
  workspaceManifestFromSnapshot,
  workspaceManifestEqual,
  type WorkspaceManifest,
  type WorkspaceManifestDelta,
} from '../domain/workspace-manifest.js';
import {
  exactUtf8ByteRange,
  utf16ColumnAtUtf8Byte,
} from '../domain/utf8-range.js';

export { exactUtf8ByteRange, exactUtf8Span } from '../domain/utf8-range.js';

export interface QdrantContextConfig {
  readonly workspaceId: WorkspaceId;
  readonly rootPath: string;
  readonly files: WorkspaceFilePort;
  readonly qdrant: CodeCandidatePort;
  readonly embeddings: VectorEmbeddingPort;
  /** Client-side sparse embeddings are mandatory for sparse/hybrid self-hosted Qdrant queries. */
  readonly sparseEmbeddings?: SparseEmbeddingPort;
  readonly artifacts: ArtifactStore;
  readonly semantics: SemanticAnalysisPort;
  readonly newRequestId: () => string;
  readonly generation?: number;
  readonly indexKey?: string;
  readonly documentation?: DocumentationPort;
  readonly memory?: MemorySearchPort;
  readonly history?: GitHistoryPort;
  readonly candidateLimit?: number;
  /** Same production adapter supports controlled dense/sparse/hybrid ablation arms. */
  readonly retrievalStrategy?: CodeRetrievalStrategy;
  /** Optional evidence-gated cross-encoder stage after Qdrant RRF fusion. */
  readonly reranker?: RerankerPort;
  /** Optional falls back to fused ranking on outage; required fails the code branch closed. */
  readonly rerankerMode?: 'optional' | 'required';
  /** Fused shortlist depth sent to the reranker before final delivery trimming. */
  readonly rerankerCandidateLimit?: number;
  readonly coverage?: IndexCoverageSummary;
  /** If set, every request must reconcile the authoritative working tree. */
  readonly workspaceManifest?: WorkspaceManifest;
  /**
   * Optional runtime-owned catch-up. The callback must publish and return a
   * complete provider configuration for exactly `currentManifest`; returning
   * another manifest is treated as a race and remains NOT_READY.
   */
  readonly reconcile?: (
    currentManifest: WorkspaceManifest,
    delta: WorkspaceManifestDelta,
  ) => Effect.Effect<Result<QdrantContextConfig, DomainError>>;
  readonly scopeFingerprint?: string;
  readonly semanticSnapshotIdentity?: string;
  readonly trace?: ProviderTraceSink;
  /** Internal benchmark boundary; never exposed as an MCP tool or payload field. */
  readonly benchmarkTrace?: RetrievalBenchmarkTraceSink;
  readonly benchmarkRepositoryId?: string;
  readonly benchmarkProviderIdentities?: Readonly<Record<string, string>>;
  /** Request-local synchronization owner; avoids a full snapshot on no-change requests. */
  readonly workspaceSync?: WorkspaceSync;
  /** Stable collection mode keeps unchanged points across changed-path mutations. */
  readonly qdrantStableCollection?: boolean;
  /** Optional bounded structural prior; Qdrant remains semantic authority. */
  readonly repoMap?: RepoMapService;
}

export const embeddingContentKey = (providerIdentity: string, chunk: string): string =>
  createHash('sha256').update(providerIdentity, 'utf8').update('\0', 'utf8').update(Buffer.from(chunk, 'utf8')).digest('hex');

export const qdrantCollectionName = (workspaceKey: string, embeddingKey: string, indexPrefix: string): string =>
  `ace_${workspaceKey}_${embeddingKey.slice(0, 16)}_${indexPrefix.slice(0, 16)}`;

export const qdrantCurrentAlias = (workspaceKey: string, embeddingKey: string): string =>
  `ace_${workspaceKey}_${embeddingKey.slice(0, 16)}_current`;

const workingContextBoost = (
  candidate: RankedCandidate,
  workingContext: WorkingContext | undefined,
  hints: WorkingContextHints | undefined,
): number => {
  let boost = 0;
  if (hints?.focusedPath === candidate.candidate.repoPath) {
    boost += 0.08;
    const range = hints.focusedRange;
    if (range !== undefined
      && candidate.candidate.range.endLine >= range.startLine
      && candidate.candidate.range.startLine <= range.endLine) boost += 0.02;
  } else if (hints?.openPaths?.includes(candidate.candidate.repoPath) === true) {
    boost += 0.04;
  }
  if (workingContext !== undefined) {
    const dirty = workingContext.stagedPaths.includes(candidate.candidate.repoPath)
      || workingContext.unstagedPaths.includes(candidate.candidate.repoPath)
      || workingContext.untrackedPaths.includes(candidate.candidate.repoPath);
    if (dirty) boost += 0.02;
  }
  return boost;
};

export const applyWorkingContextPriors = (
  candidates: readonly RankedCandidate[],
  workingContext: WorkingContext | undefined,
  hints: WorkingContextHints | undefined,
  limit: number,
): readonly RankedCandidate[] => [...candidates]
  .map((candidate) => {
    const boost = workingContextBoost(candidate, workingContext, hints);
    return { ...candidate, score: candidate.score * (1 + boost) };
  })
  .sort((left, right) => right.score - left.score || left.candidate.repoPath.localeCompare(right.candidate.repoPath))
  .slice(0, limit);

const repoMapKey = (candidate: RankedCandidate['candidate']): string => [
  candidate.repoPath,
  candidate.range.startLine,
  candidate.range.startColumn ?? '',
  candidate.range.endLine,
  candidate.range.endColumn ?? '',
  candidate.sourceDigest,
].join(':');

export const applyRepoMapPrior = (
  candidates: readonly RankedCandidate[],
  repoMap: RepoMapResult,
  limit: number,
): readonly RankedCandidate[] => {
  const rankByKey = new Map(repoMap.ranked.map((item, index) => [
    [
      item.symbol.repoPath,
      item.symbol.range.startLine,
      item.symbol.range.startColumn ?? '',
      item.symbol.range.endLine,
      item.symbol.range.endColumn ?? '',
      item.symbol.sourceDigest,
    ].join(':'),
    index,
  ]));
  return [...candidates]
    .map((candidate) => {
      const rank = rankByKey.get(repoMapKey(candidate.candidate));
      return rank === undefined
        ? candidate
        : { ...candidate, score: candidate.score + 0.05 / (rank + 1) };
    })
    .sort((left, right) => right.score - left.score || left.candidate.repoPath.localeCompare(right.candidate.repoPath))
    .slice(0, limit);
};

const recordBenchmarkStage = (
  trace: RetrievalBenchmarkTraceSink | undefined,
  providerIdentities: Readonly<Record<string, string>> | undefined,
  requestId: string,
  stage: 'dense' | 'sparse' | 'fused' | 'working_context' | 'reranked' | 'delivered',
  candidates: readonly RankedCandidate[],
  startedAtMs: number,
  repositoryId?: string,
  status: RetrievalBenchmarkStageStatus = 'executed',
): void => {
  trace?.record({
    requestId,
    stage,
    status,
    candidates: candidates.map(({ candidate }) => ({
      runtimeCandidateId: candidate.candidateId,
      ...(repositoryId === undefined ? {} : {
        canonicalCandidateId: canonicalBenchmarkCandidateId(
          repositoryId,
          candidate.repoPath,
          candidate.sourceDigest,
          candidate.range,
        ),
      }),
      repoPath: candidate.repoPath,
      sourceDigest: candidate.sourceDigest,
      range: candidate.range,
    })),
    durationMs: Math.max(0, Date.now() - startedAtMs),
    ...(providerIdentities === undefined ? {} : { providerIdentities }),
  });
};

export const resolveQdrantAlias = (
  alias: string,
  sdk?: QdrantSdkPort,
): Effect.Effect<Result<string | undefined, DomainError>> => Effect.gen(function* () {
  if (!/^[a-zA-Z0-9_.-]{1,255}$/u.test(alias)) {
    return err(domainError('INVALID_INPUT', 'qdrant_alias', 'Qdrant alias name is invalid'));
  }
  if (sdk === undefined) return err(domainError('NOT_READY', 'qdrant_alias', 'official Qdrant SDK client is required'));
  const listed = yield* sdk.getAliases();
  if (listed._tag === 'Err') return listed;
  const aliases = listed.value;
  const target = aliases.find((item) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
    && (item as { alias_name?: unknown }).alias_name === alias);
  if (target === undefined) return ok(undefined);
  const collection = (target as { collection_name?: unknown }).collection_name;
  return typeof collection === 'string' && /^[a-zA-Z0-9_.-]{1,255}$/u.test(collection)
    ? ok(collection)
    : err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_alias', 'Qdrant alias target is malformed'));
});

export const populateQdrantFromStructuralIndex = (
  index: CodeIndex,
  qdrant: CodeCandidatePort,
  embeddings: VectorEmbeddingPort,
  indexKey?: string,
  seedVectors: ReadonlyMap<string, readonly number[]> = new Map(),
  embeddingProviderIdentity?: string,
  sparseEmbeddings?: SparseEmbeddingPort,
  candidatePaths?: ReadonlySet<RepoPath>,
): Effect.Effect<Result<number, DomainError>> => Effect.gen(function* () {
  const candidatesToPopulate = candidatePaths === undefined
    ? index.candidates
    : index.candidates.filter((candidate) => candidatePaths.has(candidate.repoPath));
  if (candidatesToPopulate.length === 0) {
    return candidatePaths === undefined
      ? err(domainError('UNSUPPORTED_PROVIDER', 'index', 'no verified structural candidates available for Qdrant'))
      : ok(0);
  }
  if (index.candidates.length === 0) {
    return err(domainError('UNSUPPORTED_PROVIDER', 'index', 'no verified structural candidates available for Qdrant'));
  }
  let count = 0;
  for (let offset = 0; offset < candidatesToPopulate.length; offset += 16) {
    const candidates = candidatesToPopulate.slice(offset, offset + 16);
    const keyFor = (candidate: CodeCandidate): string => embeddingProviderIdentity === undefined
      ? candidate.candidateId
      : embeddingContentKey(embeddingProviderIdentity, candidate.text);
    const missing = candidates.filter((candidate) => !seedVectors.has(keyFor(candidate)));
    const embedded: Result<readonly (readonly number[])[], DomainError> = missing.length === 0
      ? ok([])
      : yield* embeddings.embedMany(missing.map((candidate) => candidate.text));
    if (embedded._tag === 'Err') return embedded;
    if (embedded.value.length !== missing.length) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding', 'embedding batch size mismatch'));
    }
    const generated = new Map(missing.map((candidate, vectorIndex) => [candidate.candidateId, embedded.value[vectorIndex] ?? []] as const));
    const sparse = sparseEmbeddings === undefined
      ? ok<readonly SparseVector[]>([])
      : yield* sparseEmbeddings.embedDocuments(candidates.map(qdrantLexicalTextForCandidate));
    if (sparse._tag === 'Err') return sparse;
    if (sparseEmbeddings !== undefined && sparse.value.length !== candidates.length) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'sparse_embedding', 'sparse embedding batch size mismatch'));
    }
    const points: CodePoint[] = [];
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const embeddingKey = keyFor(candidate);
      const vector = seedVectors.get(embeddingKey) ?? generated.get(candidate.candidateId);
      if (vector === undefined || vector.length === 0 || !vector.every((value) => Number.isFinite(value))) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding', 'candidate is missing a valid vector'));
      }
      const sparseVector = sparseEmbeddings === undefined ? undefined : sparse.value[candidateIndex];
      if (sparseEmbeddings !== undefined && sparseVector === undefined) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'sparse_embedding', 'candidate is missing a sparse vector'));
      }
      points.push({
        candidate,
        vector,
        ...(sparseVector === undefined ? {} : { sparseVector }),
        ...(indexKey === undefined ? {} : { indexKey }),
        embeddingKey,
      });
    }
    const result = yield* qdrant.upsert(points);
    if (result._tag === 'Err') return result;
    count += candidates.length;
  }
  return ok(count);
});

export const mutateQdrantChangedPaths = (
  index: CodeIndex,
  qdrant: CodeCandidatePort,
  embeddings: VectorEmbeddingPort,
  workspaceId: WorkspaceId,
  changedPaths: readonly RepoPath[],
  indexKey: string,
  embeddingProviderIdentity?: string,
  sparseEmbeddings?: SparseEmbeddingPort,
  verification?: {
    readonly sdk?: QdrantSdkPort;
    readonly collection: string;
  },
  failedPaths: ReadonlySet<RepoPath> = new Set(),
): Effect.Effect<Result<{ readonly count: number; readonly reused: boolean; readonly reusedVectorCount: number }, DomainError>> => Effect.gen(function* () {
  const paths = [...new Set(changedPaths)];
  if (paths.length === 0) return ok({ count: 0, reused: false, reusedVectorCount: 0 });
  const failedChangedPaths = paths.filter((repoPath) => failedPaths.has(repoPath));
  if (failedChangedPaths.length > 0) {
    return err(domainError(
      'NOT_READY',
      'qdrant',
      'refusing stable mutation for incompletely indexed changed path(s): ' + failedChangedPaths.sort().join(', '),
    ));
  }
  if (qdrant.deletePaths === undefined) {
    return err(domainError('NOT_READY', 'qdrant', 'stable changed-path mutation requires the official Qdrant delete boundary'));
  }
  const currentPaths = new Set(index.candidates
    .filter((candidate) => paths.includes(candidate.repoPath))
    .map((candidate) => candidate.repoPath));
  const removedOrEmptyPaths = paths.filter((repoPath) => !currentPaths.has(repoPath));

  // Publish first. If embeddings or upsert fail, the last known-good points
  // remain intact and WorkspaceSync never advances to the failed generation.
  const upserted = yield* populateQdrantFromStructuralIndex(
    index,
    qdrant,
    embeddings,
    indexKey,
    new Map(),
    embeddingProviderIdentity,
    sparseEmbeddings,
    new Set(currentPaths),
  );
  if (upserted._tag === 'Err') return upserted;

  if (currentPaths.size > 0) {
    if (verification === undefined) {
      return err(domainError(
        'NOT_READY',
        'qdrant',
        'changed-path publication requires membership verification before pruning old versions',
      ));
    }
    for (const repoPath of [...currentPaths].sort()) {
      const expectedCandidateIds = index.candidates
        .filter((candidate) => candidate.repoPath === repoPath)
        .map((candidate) => candidate.candidateId);
      const verified = yield* verifyQdrantSnapshotMembership(
        verification.sdk,
        verification.collection,
        workspaceId,
        indexKey,
        expectedCandidateIds,
        repoPath,
      );
      if (verified._tag === 'Err') return verified;
      if (!verified.value) {
        return err(domainError(
          'INVALID_EXTERNAL_RESPONSE',
          'qdrant_snapshot',
          repoPath + ': changed-path publication is incomplete; refusing to prune last-known-good path versions',
        ));
      }
    }
    const cleaned = yield* qdrant.deletePaths({
      workspaceId,
      repoPaths: [...currentPaths],
      exceptIndexKey: indexKey,
    });
    if (cleaned._tag === 'Err') return cleaned;
  }
  if (removedOrEmptyPaths.length > 0) {
    const deleted = yield* qdrant.deletePaths({ workspaceId, repoPaths: removedOrEmptyPaths });
    if (deleted._tag === 'Err') return deleted;
  }
  // A successful delete response is not proof that obsolete points vanished.
  // Check physical path membership without index_key; otherwise old versions
  // can consume top-K slots even though the newly published version is valid.
  if (verification !== undefined) {
    for (const repoPath of paths.sort()) {
      const expected = index.candidates
        .filter((candidate) => candidate.repoPath === repoPath)
        .map((candidate) => candidate.candidateId);
      const checked = yield* verifyQdrantSnapshotMembership(
        verification.sdk, verification.collection,
        workspaceId, undefined, expected, repoPath,
      );
      if (checked._tag === 'Err') return checked;
      if (!checked.value) return err(domainError(
        'INVALID_EXTERNAL_RESPONSE', 'qdrant_snapshot',
        repoPath + ': obsolete points remain after deletion; refusing synchronized publication',
      ));
    }
  }
  return ok({ count: upserted.value, reused: false, reusedVectorCount: 0 });
});

export const probeQdrantService = (
  sdk?: QdrantSdkPort,
): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
  if (sdk === undefined) return err(domainError('NOT_READY', 'qdrant', 'official Qdrant SDK client is required'));
  return yield* sdk.probeService();
});

// Collection bootstrap never replaces an existing collection. After a successful
// rebuild, obsolete generations for the same workspace may be pruned explicitly.
// Vector dimension must match the configured experimental embedding provider.
export const ensureQdrantCollection = (
  collection: string,
  dimension: number,
  sdk?: QdrantSdkPort,
  mode: 'dense' | 'hybrid' = 'hybrid',
): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
  if (!Number.isSafeInteger(dimension) || dimension < 1) {
    return err(domainError('INVALID_INPUT', 'vector_dimension', 'invalid embedding dimension'));
  }
  const verifyExisting = (body: unknown): Result<void, DomainError> => {
    const direct = typeof body === 'object' && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown> : {};
    const config = typeof direct.config === 'object' && direct.config !== null && !Array.isArray(direct.config)
      ? direct.config as Record<string, unknown> : {};
    const params = typeof config.params === 'object' && config.params !== null && !Array.isArray(config.params)
      ? config.params as Record<string, unknown> : {};
    const vectors = params.vectors;
    const sparseVectors = params.sparse_vectors;
    const dense = typeof vectors === 'object' && vectors !== null && !Array.isArray(vectors)
      ? (vectors as Record<string, unknown>).dense : undefined;
    const denseConfig = typeof dense === 'object' && dense !== null && !Array.isArray(dense)
      ? dense as Record<string, unknown> : undefined;
    const sparse = typeof sparseVectors === 'object' && sparseVectors !== null && !Array.isArray(sparseVectors)
      ? (sparseVectors as Record<string, unknown>).sparse : undefined;
    const sparseConfig = typeof sparse === 'object' && sparse !== null && !Array.isArray(sparse)
      ? sparse as Record<string, unknown> : undefined;
    const denseValid = denseConfig?.size === dimension && denseConfig.distance === 'Cosine';
    const sparseValid = typeof sparseConfig?.modifier === 'string' && sparseConfig.modifier.toLowerCase() === 'idf';
    return denseValid && (mode === 'dense' || sparseValid)
      ? ok(undefined)
      : err(domainError(
        'INVALID_EXTERNAL_RESPONSE',
        'qdrant',
        mode === 'dense'
          ? 'collection schema must expose dense cosine vectors'
          : 'collection schema must expose dense cosine vectors and IDF-modified sparse vectors',
      ));
  };
  if (sdk === undefined) return err(domainError('NOT_READY', 'qdrant', 'official Qdrant SDK client is required'));
  const found = yield* sdk.getCollection(collection);
  if (found._tag === 'Ok') return verifyExisting(found.value);
  if (found.error.details?.httpStatus !== 404) return found;
  const created = yield* sdk.createCollection(collection, {
    vectors: { dense: { size: dimension, distance: 'Cosine' } },
    ...(mode === 'dense' ? {} : { sparse_vectors: { sparse: { modifier: 'idf' } } }),
  });
  const concurrentCreateConflict = created._tag === 'Err'
    && created.error.code === 'EXTERNAL_UNAVAILABLE'
    && created.error.details?.httpStatus === 409;
  if (created._tag === 'Err' && !concurrentCreateConflict) return created;
  // Acknowledged creation is not proof that the collection's actual schema
  // matches the configured vector mode. The same read-back check covers
  // successful creation and concurrent creators without a second protocol path.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const raced = yield* sdk.getCollection(collection);
    if (raced._tag === 'Ok') return verifyExisting(raced.value);
    const transient = [404, 409, 500].includes(Number(raced.error.details?.httpStatus));
    if (!transient || attempt === 4) return raced;
    yield* Effect.sleep('100 millis');
  }
  return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'could not verify concurrently created collection'));
});

/**
 * Publish a verified immutable collection through one Qdrant alias update.
 * The alias is the only read surface used by the runtime; collection creation
 * and point verification happen before this function is called.
 */
export const switchQdrantAlias = (
  alias: string,
  collection: string,
  sdk?: QdrantSdkPort,
): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
  if (!/^[a-zA-Z0-9_.-]{1,255}$/u.test(alias) || !/^[a-zA-Z0-9_.-]{1,255}$/u.test(collection)) {
    return err(domainError('INVALID_INPUT', 'qdrant_alias', 'Qdrant alias and collection names are invalid'));
  }
  if (sdk === undefined) return err(domainError('NOT_READY', 'qdrant_alias', 'official Qdrant SDK client is required'));
  const listed = yield* sdk.getAliases();
  if (listed._tag === 'Err') return listed;
  const aliases = listed.value;
  const existing = aliases.some((item) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
    && (item as { alias_name?: unknown }).alias_name === alias);
  const actions = [
    ...(existing ? [{ delete_alias: { alias_name: alias } }] : []),
    { create_alias: { collection_name: collection, alias_name: alias } },
  ];
  return yield* sdk.updateAliases({ actions });
});

/**
 * Warm-start reuse is safe only for an exact workspace + source-snapshot key.
 * Observation epochs change on every scan even when bytes do not, so they
 * MUST NOT be used as the warm-cache identity. A count mismatch forces a
 * complete rebuild; a failed
 * count request does not quietly claim the index is healthy.
 *
 * Every returned snippet is still re-read from the authoritative worktree.
 */
export const hasExactQdrantSnapshot = (
  sdk: QdrantSdkPort | undefined,
  collection: string,
  workspaceId: WorkspaceId,
  indexKey: string,
  expectedCount: number,
): Effect.Effect<Result<boolean, DomainError>> => Effect.gen(function* () {
  if (indexKey.length === 0 || !Number.isSafeInteger(expectedCount) || expectedCount <= 0) {
    return err(domainError('INVALID_INPUT', 'snapshot', 'snapshot identity and expected positive candidate count are required'));
  }
  const filter = {
    must: [
      { key: 'workspace_id', match: { value: workspaceId } },
      { key: 'index_key', match: { value: indexKey } },
    ],
  };
  if (sdk === undefined) return err(domainError('NOT_READY', 'qdrant_count', 'official Qdrant SDK client is required'));
  const counted = yield* sdk.countPoints(collection, { exact: true, filter });
  if (counted._tag === 'Err') return counted;
  return ok(counted.value === expectedCount);
});

export const codeIndexKey = (
  index: CodeIndex,
  coverage?: IndexCoverageSummary,
  providerFingerprint?: string,
  fileManifest: readonly IndexFileIdentity[] = [],
): string => {
  const stable = [...index.candidates]
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
    .map((candidate) => [
      candidate.candidateId,
      candidate.repoPath,
      candidate.sourceDigest,
      candidate.symbolName ?? null,
      candidate.structuralKind ?? null,
      candidate.structuralLanguage ?? null,
      candidate.structuralExported ?? null,
      candidate.semanticAnchor?.line ?? null,
      candidate.semanticAnchor?.byteColumn ?? null,
      candidate.semanticAnchor?.endLine ?? null,
      candidate.semanticAnchor?.endByteColumn ?? null,
      candidate.range.startLine,
      candidate.range.startColumn ?? null,
      candidate.range.endLine,
      candidate.range.endColumn ?? null,
      candidate.text,
    ]);
  const coverageIdentity = coverage === undefined ? undefined : {
    schemaVersion: coverage.schemaVersion,
    parserVersion: coverage.parserVersion,
    // Source membership/digests already come from fileManifest and candidates.
    // Do not fold observation-only HEAD/state or out-of-scope diagnostic counts
    // back into the stable Qdrant identity via sourceSnapshotDigest.
    failedPaths: coverage.failedPaths,
    failureCounts: coverage.failureCounts,
    failures: [...coverage.failures]
      .map((failure) => [failure.repoPath, failure.kind, failure.code ?? null])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  };
  const files = [...fileManifest]
    .map((file) => ({
      repoPath: file.repoPath,
      sourceDigest: file.sourceDigest,
      candidateIds: [...file.candidateIds].sort(),
    }))
    .sort((left, right) => left.repoPath.localeCompare(right.repoPath));
  return createHash('sha256')
    .update(JSON.stringify({
      stable,
      files,
      coverage: coverageIdentity ?? null,
      providerFingerprint: providerFingerprint ?? null,
    }), 'utf8')
    .digest('hex');
};

export const verifyQdrantSnapshotMembership = (
  sdk: QdrantSdkPort | undefined,
  collection: string,
  workspaceId: WorkspaceId,
  indexKey: string | undefined,
  expectedCandidateIds: readonly string[],
  repoPath?: RepoPath,
): Effect.Effect<Result<boolean, DomainError>> => Effect.gen(function* () {
  const observed: string[] = [];
  let offset: string | number | undefined;
  const filter = { must: [
    { key: 'workspace_id', match: { value: workspaceId } },
    ...(indexKey === undefined ? [] : [{ key: 'index_key', match: { value: indexKey } }]),
    ...(repoPath === undefined ? [] : [{ key: 'repo_path', match: { value: repoPath } }]),
  ] };
  for (let page = 0; page < 10_000; page += 1) {
    if (sdk === undefined) return err(domainError('NOT_READY', 'qdrant_scroll', 'official Qdrant SDK client is required'));
    const scrolled = yield* sdk.scrollPoints(collection, {
      limit: 256,
      with_payload: ['candidate_id'],
      with_vector: false,
      filter,
      ...(offset === undefined ? {} : { offset }),
    });
    if (scrolled._tag === 'Err') return scrolled;
    for (const point of scrolled.value.points) {
      if (typeof point !== 'object' || point === null || Array.isArray(point)) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'snapshot point must be an object'));
      }
      const payload = (point as { payload?: unknown }).payload;
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)
        || typeof (payload as { candidate_id?: unknown }).candidate_id !== 'string') {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'snapshot point requires candidate_id payload'));
      }
      observed.push((payload as { candidate_id: string }).candidate_id);
    }
    if (scrolled.value.nextPageOffset === undefined || scrolled.value.nextPageOffset === null) break;
    offset = scrolled.value.nextPageOffset;
    if (page === 9_999) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'snapshot membership pagination did not terminate'));
    }
  }
  const expected = [...expectedCandidateIds].sort();
  observed.sort();
  return ok(expected.length === observed.length && expected.every((value, index) => value === observed[index]));
});

export const readQdrantSnapshotVectors = (
  sdk: QdrantSdkPort | undefined,
  collection: string,
  workspaceId: WorkspaceId,
  indexKey?: string,
): Effect.Effect<Result<ReadonlyMap<string, readonly number[]>, DomainError>> => Effect.gen(function* () {
  const vectors = new Map<string, readonly number[]>();
  let offset: string | number | undefined;
  const filter = { must: [
    { key: 'workspace_id', match: { value: workspaceId } },
    ...(indexKey === undefined ? [] : [{ key: 'index_key', match: { value: indexKey } }]),
  ] };
  for (let page = 0; page < 10_000; page += 1) {
    if (sdk === undefined) return err(domainError('NOT_READY', 'qdrant_scroll', 'official Qdrant SDK client is required'));
    const scrolled = yield* sdk.scrollPoints(collection, {
      limit: 256,
      with_payload: ['candidate_id', 'embedding_key'],
      with_vector: true,
      filter,
      ...(offset === undefined ? {} : { offset }),
    });
    if (scrolled._tag === 'Err') return scrolled;
    for (const point of scrolled.value.points) {
      if (typeof point !== 'object' || point === null || Array.isArray(point)) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'prior snapshot point must be an object'));
      }
      const record = point as { payload?: unknown; vector?: unknown };
      if (typeof record.payload !== 'object' || record.payload === null || Array.isArray(record.payload)) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'prior snapshot point requires a payload object'));
      }
      const candidateId = (record.payload as { candidate_id?: unknown }).candidate_id;
      const embeddingKey = (record.payload as { embedding_key?: unknown }).embedding_key;
      if (typeof candidateId !== 'string' || candidateId.trim().length === 0) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'prior snapshot point requires a non-empty candidate_id payload'));
      }
      if (embeddingKey !== undefined && (typeof embeddingKey !== 'string' || embeddingKey.trim().length === 0)) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'prior snapshot point has an invalid embedding_key payload'));
      }
      const denseVector = Array.isArray(record.vector)
        ? record.vector
        : typeof record.vector === 'object' && record.vector !== null && !Array.isArray(record.vector)
          ? (record.vector as Record<string, unknown>).dense
          : undefined;
      if (!Array.isArray(denseVector) || denseVector.length === 0
        || !denseVector.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_vector', 'prior snapshot contains an invalid dense vector'));
      }
      const cacheKey = typeof embeddingKey === 'string' ? embeddingKey : candidateId;
      const previous = vectors.get(cacheKey);
      if (previous !== undefined
        && (previous.length !== denseVector.length
          || previous.some((value, index) => value !== denseVector[index]))) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_vector', 'prior snapshot has conflicting vectors for the same cache key'));
      }
      vectors.set(cacheKey, denseVector as number[]);
    }
    if (scrolled.value.nextPageOffset === undefined || scrolled.value.nextPageOffset === null) break;
    offset = scrolled.value.nextPageOffset;
    if (page === 9_999) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'prior vector pagination did not terminate'));
    }
  }
  return ok(vectors);
});

export const reuseOrPopulateQdrantSnapshot = (
  index: CodeIndex,
  qdrant: CodeCandidatePort,
  embeddings: VectorEmbeddingPort,
  sdk: QdrantSdkPort | undefined,
  collection: string,
  workspaceId: WorkspaceId,
  indexKey: string,
  reuseAllowed = true,
  priorIndexKey?: string,
  embeddingProviderIdentity?: string,
  priorCollection?: string,
  sparseEmbeddings?: SparseEmbeddingPort,
  stableCollection = false,
): Effect.Effect<Result<{ readonly count: number; readonly reused: boolean; readonly reusedVectorCount: number }, DomainError>> => Effect.gen(function* () {
  const expectedCandidateIds = index.candidates.map((candidate) => candidate.candidateId);
  if (reuseAllowed) {
    const checked = yield* hasExactQdrantSnapshot(
      sdk, collection, workspaceId, indexKey, index.candidates.length,
    );
    if (checked._tag === 'Err') return checked;
    if (checked.value) {
      const membership = yield* verifyQdrantSnapshotMembership(
        sdk, collection, workspaceId, indexKey, expectedCandidateIds,
      );
      if (membership._tag === 'Err') return membership;
      if (membership.value) {
        // Exact current-key membership proves every expected candidate is already
        // published under indexKey. Stable cleanup is generation-fenced so an
        // older writer cannot delete points from a newer observation epoch.
        if (qdrant.deleteWorkspaceVersions !== undefined) {
          const cleaned = yield* qdrant.deleteWorkspaceVersions({
            workspaceId,
            exceptIndexKey: indexKey,
            ...(stableCollection ? { beforeGeneration: index.generation } : {}),
          });
          if (cleaned._tag === 'Err') return cleaned;
        }
        if (stableCollection) {
          const physical = yield* verifyQdrantSnapshotMembership(
            sdk, collection, workspaceId, undefined, expectedCandidateIds,
          );
          if (physical._tag === 'Err') return physical;
          if (!physical.value) return err(domainError(
            'INVALID_EXTERNAL_RESPONSE',
            'qdrant_snapshot',
            'stale workspace points remain after verified current-key cleanup',
          ));
        }
        return ok({ count: index.candidates.length, reused: true, reusedVectorCount: index.candidates.length });
      }
    }
  }
  if (reuseAllowed && stableCollection) {
    // Incremental publication only updates index_key on changed candidates.
    // The complete *physical* membership is authoritative for warm reuse:
    // unchanged points may legitimately retain earlier publication keys.
    // An exact set match proves there are no crash leftovers to prune. Never
    // deleteWorkspaceVersions here: that would erase still-current old-key points.
    const membership = yield* verifyQdrantSnapshotMembership(
      sdk, collection, workspaceId, undefined, expectedCandidateIds,
    );
    if (membership._tag === 'Err') return membership;
    if (membership.value) {
      return ok({ count: index.candidates.length, reused: true, reusedVectorCount: index.candidates.length });
    }
  }
  // A mismatched physical membership requires a full, verified publication
  // before obsolete workspace points may be pruned.
  let seedVectors: ReadonlyMap<string, readonly number[]> = new Map();
  if (priorCollection !== undefined || priorIndexKey !== undefined) {
    const prior = yield* readQdrantSnapshotVectors(
      sdk,
      priorCollection ?? collection,
      workspaceId,
      priorIndexKey === indexKey ? undefined : priorIndexKey,
    );
    if (prior._tag === 'Err') return prior;
    const currentKeys = new Set<string>(index.candidates.map((candidate) => embeddingProviderIdentity === undefined
      ? candidate.candidateId
      : embeddingContentKey(embeddingProviderIdentity, candidate.text)));
    seedVectors = new Map([...prior.value].filter(([key]) => currentKeys.has(key)));
  }
  // Upsert the complete current snapshot before pruning any older points.
  // This keeps the last known-good index recoverable if embeddings/upsert fail.
  const indexed = yield* populateQdrantFromStructuralIndex(
    index,
    qdrant,
    embeddings,
    indexKey,
    seedVectors,
    embeddingProviderIdentity,
    sparseEmbeddings,
  );
  if (indexed._tag === 'Err') return indexed;
  const verified = yield* verifyQdrantSnapshotMembership(
    sdk, collection, workspaceId, indexKey, expectedCandidateIds,
  );
  if (verified._tag === 'Err') return verified;
  if (!verified.value) {
    return err(domainError(
      'INVALID_EXTERNAL_RESPONSE',
      'qdrant_snapshot',
      'rebuilt snapshot membership is incomplete; refusing to prune the last-known-good workspace version',
    ));
  }
  // Full publication rewrites every current candidate with indexKey. Stable
  // cleanup is additionally fenced by generation, preserving points written
  // by any newer concurrent observation.
  if (qdrant.deleteWorkspaceVersions !== undefined) {
    const cleaned = yield* qdrant.deleteWorkspaceVersions({
      workspaceId,
      exceptIndexKey: indexKey,
      ...(stableCollection ? { beforeGeneration: index.generation } : {}),
    });
    if (cleaned._tag === 'Err') return cleaned;
  }
  if (stableCollection) {
    const physical = yield* verifyQdrantSnapshotMembership(
      sdk, collection, workspaceId, undefined, expectedCandidateIds,
    );
    if (physical._tag === 'Err') return physical;
    if (!physical.value) return err(domainError(
      'INVALID_EXTERNAL_RESPONSE',
      'qdrant_snapshot',
      'stale workspace points remain after full verified publication cleanup',
    ));
  }
  return ok({ count: indexed.value, reused: false, reusedVectorCount: seedVectors.size });
});

export const makeQdrantContextProvider = (config: QdrantContextConfig) => {
  let activeConfig = config;
  /* eslint-disable @typescript-eslint/indent -- the generator body retains the existing Effect indentation. */
  const search = (
    input: {
      readonly workspaceId: WorkspaceId;
      readonly query: string;
      readonly includeCode?: boolean;
      readonly includeDocs: boolean;
      readonly includeMemory: boolean;
      readonly includeHistory?: boolean;
      readonly sourceRequirements?: SourceRequirements;
      readonly workingContextHints?: WorkingContextHints;
    },
    retryBudget = 0,
  ): Effect.Effect<Result<ContextBundle, DomainError>> => Effect.gen(function* () {
      if (input.workspaceId !== activeConfig.workspaceId) {
        return err(domainError('POLICY_DENIED', 'workspace_id', 'Qdrant provider belongs to another workspace'));
      }
      let requestWorkingContext: WorkingContext | undefined;
      if (activeConfig.workspaceManifest !== undefined) {
        if (activeConfig.qdrantStableCollection && activeConfig.workspaceSync === undefined) {
          return err(domainError(
            'NOT_READY',
            'workspace_sync',
            'stable synchronized retrieval requires the WorkspaceSync owner',
          ));
        }
        if (activeConfig.workspaceSync !== undefined) {
          const refreshed = yield* activeConfig.workspaceSync.refresh();
          if (refreshed._tag === 'Err') return refreshed;
          requestWorkingContext = refreshed.value.workingContext;
          const configBehindSync = activeConfig.indexKey !== undefined
            && refreshed.value.state.indexKey !== activeConfig.indexKey;
          if (refreshed.value.refreshed || configBehindSync) {
            if (activeConfig.reconcile === undefined) {
              return err(domainError(
                'NOT_READY',
                'workspace_manifest',
                'workspace synchronization is ahead of the active provider config; reconciliation is required before delivery',
              ));
            }
            const reconciled = yield* activeConfig.reconcile(
              refreshed.value.state.workspaceManifest,
              refreshed.value.delta,
            );
            if (reconciled._tag === 'Err') return reconciled;
            if (reconciled.value.workspaceManifest === undefined
            || !workspaceManifestEqual(reconciled.value.workspaceManifest, refreshed.value.state.workspaceManifest)) {
              return err(domainError(
                'NOT_READY',
                'workspace_manifest',
                'workspace changed again while reconciliation was publishing; refusing stale semantic context',
              ));
            }
            activeConfig = reconciled.value;
          }
        } else {
          const currentSnapshot = yield* activeConfig.files.snapshot(activeConfig.rootPath, Date.now());
          if (currentSnapshot._tag === 'Err') return currentSnapshot;
          requestWorkingContext = workingContextFromSnapshot(currentSnapshot.value);
          const currentManifest = workspaceManifestFromSnapshot(
            currentSnapshot.value,
            activeConfig.scopeFingerprint ?? activeConfig.workspaceManifest.scopeFingerprint,
          );
          if (!workspaceManifestEqual(activeConfig.workspaceManifest, currentManifest)) {
            const delta = diffWorkspaceManifests(activeConfig.workspaceManifest, currentManifest);
            if (activeConfig.reconcile === undefined) {
              return err(domainError(
                'NOT_READY',
                'workspace_manifest',
                'authoritative workspace manifest changed; indexed context requires reconciliation before complete delivery',
                {
                  changed: delta.changed.length,
                  added: delta.added.length,
                  deleted: delta.deleted.length,
                  renamed: delta.renamed.length,
                  scopeChanged: delta.scopeChanged,
                },
              ));
            }
            const reconciled = yield* activeConfig.reconcile(currentManifest, delta);
            if (reconciled._tag === 'Err') return reconciled;
            if (reconciled.value.workspaceManifest === undefined
            || !workspaceManifestEqual(reconciled.value.workspaceManifest, currentManifest)) {
              return err(domainError(
                'NOT_READY',
                'workspace_manifest',
                'workspace changed again while reconciliation was publishing; refusing stale semantic context',
              ));
            }
            activeConfig = reconciled.value;
          }
        }
      }
      const requestId = makeRequestId(activeConfig.newRequestId());
      if (requestId._tag === 'Err') return requestId;
      const includeCode = input.includeCode ?? true;
      const requirements = input.sourceRequirements ?? legacySourceRequirements({
        includeCode,
        includeDocs: input.includeDocs,
        includeMemory: input.includeMemory,
      });
      const lspRequirement = requirements.lsp ?? { requirement: 'not_requested' as const, allowed: true };
      const useLsp = sourceIsRequested(lspRequirement);
      let sourceCoverage = initialSourceCoverage(requirements);
      const evidence: RetrievalEvidence[] = [];
      const warnings: string[] = [];
      const failed: string[] = [];
      let codeProviderError: DomainError | undefined;
      let rankedResults: readonly RankedCandidate[] = [];
      let repoMapResult: RepoMapResult | undefined;
      let repoMapError: DomainError | undefined;
      let lspConfirmedCount = 0;
      if (includeCode) {
        const retrievalStrategy = activeConfig.retrievalStrategy
          ?? (activeConfig.sparseEmbeddings === undefined ? 'dense' : 'hybrid_rrf');
        const benchmarkStageStatus = (stage: 'dense' | 'sparse' | 'fused'): RetrievalBenchmarkStageStatus =>
          stage === retrievalStrategy
            ? 'unavailable'
            : retrievalStrategy === 'hybrid_rrf' && stage === 'fused'
              ? 'unavailable'
              : 'not_applicable';
        recordBenchmarkStage(
          activeConfig.benchmarkTrace,
          activeConfig.benchmarkProviderIdentities,
          requestId.value,
          'dense',
          [],
          0,
          activeConfig.benchmarkRepositoryId,
          benchmarkStageStatus('dense'),
        );
        recordBenchmarkStage(
          activeConfig.benchmarkTrace,
          activeConfig.benchmarkProviderIdentities,
          requestId.value,
          'sparse',
          [],
          0,
          activeConfig.benchmarkRepositoryId,
          benchmarkStageStatus('sparse'),
        );
        recordBenchmarkStage(
          activeConfig.benchmarkTrace,
          activeConfig.benchmarkProviderIdentities,
          requestId.value,
          'fused',
          [],
          0,
          activeConfig.benchmarkRepositoryId,
          benchmarkStageStatus('fused'),
        );
        recordBenchmarkStage(
          activeConfig.benchmarkTrace,
          activeConfig.benchmarkProviderIdentities,
          requestId.value,
          'working_context',
          [],
          0,
          activeConfig.benchmarkRepositoryId,
          'unavailable',
        );
        recordBenchmarkStage(
          activeConfig.benchmarkTrace,
          activeConfig.benchmarkProviderIdentities,
          requestId.value,
          'reranked',
          [],
          0,
          activeConfig.benchmarkRepositoryId,
          activeConfig.reranker === undefined
            ? activeConfig.rerankerMode === 'optional' ? 'unavailable' : 'not_applicable'
            : 'unavailable',
        );
        recordBenchmarkStage(
          activeConfig.benchmarkTrace,
          activeConfig.benchmarkProviderIdentities,
          requestId.value,
          'delivered',
          [],
          0,
          activeConfig.benchmarkRepositoryId,
          'unavailable',
        );
        let vector: readonly number[] | undefined;
        let sparseVector: SparseVector | undefined;
        if (retrievalStrategy !== 'sparse') {
          const vectors = yield* activeConfig.embeddings.embedMany([input.query], requestId.value);
          if (vectors._tag === 'Err') {
            codeProviderError = vectors.error;
          } else {
            vector = vectors.value[0];
            if (vector === undefined) {
              codeProviderError = domainError('INVALID_EXTERNAL_RESPONSE', 'embedding', 'empty query vector');
            }
          }
        }
        if (codeProviderError === undefined && retrievalStrategy !== 'dense') {
          if (activeConfig.sparseEmbeddings === undefined) {
            codeProviderError = domainError(
              'NOT_READY',
              'sparse_embedding',
              `${retrievalStrategy} retrieval requires the verified local sparse embedding provider`,
            );
          } else {
            const sparse = yield* activeConfig.sparseEmbeddings.embedQueries([input.query], requestId.value);
            if (sparse._tag === 'Err') {
              codeProviderError = sparse.error;
            } else {
              sparseVector = sparse.value[0];
              if (sparseVector === undefined) {
                codeProviderError = domainError('INVALID_EXTERNAL_RESPONSE', 'sparse_embedding', 'empty sparse query vector');
              }
            }
          }
        }
        if (codeProviderError === undefined) {
          const deliveryLimit = activeConfig.candidateLimit ?? 6;
          const hasWorkingPrior = input.workingContextHints !== undefined
            || (requestWorkingContext !== undefined
              && (requestWorkingContext.stagedPaths.length > 0
                || requestWorkingContext.unstagedPaths.length > 0
                || requestWorkingContext.untrackedPaths.length > 0));
          const rerankerEnabled = activeConfig.reranker !== undefined;
          const rerankerCandidateLimit = activeConfig.rerankerCandidateLimit
            ?? Math.min(50, Math.max(deliveryLimit, deliveryLimit * 4));
          const retrievalLimit = rerankerEnabled
            ? rerankerCandidateLimit
            : hasWorkingPrior ? Math.min(20, deliveryLimit * 2) : deliveryLimit;
          const retrievalStartedAtMs = Date.now();
          const result = yield* activeConfig.qdrant.search({
            workspaceId: input.workspaceId,
            ...(vector === undefined ? {} : { vector }),
            ...(sparseVector === undefined ? {} : { sparseVector }),
            queryText: input.query,
            strategy: retrievalStrategy,
            limit: retrievalLimit,
            ...(activeConfig.qdrantStableCollection || activeConfig.generation === undefined ? {} : { generation: activeConfig.generation }),
            ...(activeConfig.qdrantStableCollection || activeConfig.indexKey === undefined ? {} : { indexKey: activeConfig.indexKey }),
            requestId: requestId.value,
          });
          if (result._tag === 'Err') {
            codeProviderError = result.error;
          } else {
            recordBenchmarkStage(
              activeConfig.benchmarkTrace,
              activeConfig.benchmarkProviderIdentities,
              requestId.value,
              retrievalStrategy === 'dense' ? 'dense' : retrievalStrategy === 'sparse' ? 'sparse' : 'fused',
              result.value,
              retrievalStartedAtMs,
              activeConfig.benchmarkRepositoryId,
            );
            const workingContextStartedAtMs = Date.now();
            let prioritized = applyWorkingContextPriors(
              result.value,
              requestWorkingContext,
              input.workingContextHints,
              result.value.length,
            );
            if (activeConfig.repoMap !== undefined) {
              const repoMap = yield* activeConfig.repoMap.render({
                query: input.query,
                openFiles: input.workingContextHints?.openPaths
                  ?? (requestWorkingContext?.unstagedPaths ?? []),
                mentionedFiles: input.workingContextHints?.focusedPath === undefined
                  ? []
                  : [input.workingContextHints.focusedPath],
                tokenBudget: Math.max(128, retrievalLimit * 16),
              });
              if (repoMap._tag === 'Err') {
                repoMapError = repoMap.error;
                warnings.push('RepoMap unavailable: ' + repoMap.error.code);
              } else {
                repoMapResult = repoMap.value;
                prioritized = applyRepoMapPrior(prioritized, repoMap.value, retrievalLimit);
              }
            }
            prioritized = prioritized.slice(0, retrievalLimit);
            recordBenchmarkStage(
              activeConfig.benchmarkTrace,
              activeConfig.benchmarkProviderIdentities,
              requestId.value,
              'working_context',
              prioritized,
              workingContextStartedAtMs,
              activeConfig.benchmarkRepositoryId,
            );
            if (activeConfig.reranker === undefined) {
              if (activeConfig.rerankerMode === 'required') {
                codeProviderError = domainError(
                  'NOT_READY',
                  'reranker',
                  'reranking is required by runtime policy but no verified reranker is available',
                );
              } else {
                if (activeConfig.rerankerMode === 'optional') {
                  warnings.push('reranker configured but unavailable; using configured retrieval ranking');
                }
                rankedResults = prioritized.slice(0, deliveryLimit);
                recordBenchmarkStage(
                  activeConfig.benchmarkTrace,
                  activeConfig.benchmarkProviderIdentities,
                  requestId.value,
                  'reranked',
                  [],
                  0,
                  activeConfig.benchmarkRepositoryId,
                  'not_applicable',
                );
              }
            } else if (prioritized.length === 0) {
              rankedResults = [];
              recordBenchmarkStage(
                activeConfig.benchmarkTrace,
                activeConfig.benchmarkProviderIdentities,
                requestId.value,
                'reranked',
                [],
                0,
                activeConfig.benchmarkRepositoryId,
                'not_applicable',
              );
            } else {
              const rerankStartedAtMs = Date.now();
              const reranked = yield* activeConfig.reranker.rerank({
                query: input.query,
                documents: prioritized.map((item) => [
                  item.candidate.repoPath,
                  item.candidate.symbolName ?? '',
                  item.candidate.text,
                ].filter((value) => value.length > 0).join('\n')),
                requestId: requestId.value,
              });
              if (reranked._tag === 'Err') {
                if (activeConfig.rerankerMode === 'required') {
                  codeProviderError = reranked.error;
                } else {
                  warnings.push('reranker unavailable: ' + reranked.error.code + '; using configured retrieval ranking');
                  rankedResults = prioritized.slice(0, deliveryLimit);
                }
              } else {
                const reordered: RankedCandidate[] = [];
                for (const score of reranked.value) {
                  const original = prioritized[score.index];
                  if (original === undefined) continue;
                  reordered.push({
                    ...original,
                    score: score.score,
                    warning: original.warning === undefined
                      ? `ranked by configured cross-encoder after ${retrievalStrategy}`
                      : original.warning + `; ranked by configured cross-encoder after ${retrievalStrategy}`,
                  });
                }
                rankedResults = reordered.slice(0, deliveryLimit);
                recordBenchmarkStage(
                  activeConfig.benchmarkTrace,
                  activeConfig.benchmarkProviderIdentities,
                  requestId.value,
                  'reranked',
                  reordered,
                  rerankStartedAtMs,
                  activeConfig.benchmarkRepositoryId,
                );
              }
            }
            recordBenchmarkStage(
              activeConfig.benchmarkTrace,
              activeConfig.benchmarkProviderIdentities,
              requestId.value,
              'delivered',
              rankedResults,
              retrievalStartedAtMs,
              activeConfig.benchmarkRepositoryId,
            );
          }
        }
        if (codeProviderError !== undefined) {
          if (input.sourceRequirements === undefined) return err(codeProviderError);
          warnings.push('code retrieval unavailable: ' + codeProviderError.code);
          failed.push('code', 'lsp');
        }
      }

      const fullSources = new Map<RepoPath, {
        readonly bytes: Uint8Array;
        readonly digest: string;
        readonly handle: string;
        readonly sizeBytes: number;
      }>();
      const stalePaths: RepoPath[] = [];

      const initialFailures = new Map<RepoPath, string>();
      for (const ranked of rankedResults) {
        const candidate = ranked.candidate;
        // One authoritative exact read and one immutable artifact per source,
        // not one read per Qdrant symbol. All selected sources are revalidated
        // a second time at the request boundary below.
        let full = fullSources.get(candidate.repoPath);
        if (full === undefined) {
          const priorError = initialFailures.get(candidate.repoPath);
          if (priorError !== undefined) {
            failed.push('code');
            continue;
          }
          const read = yield* activeConfig.files.readExact(activeConfig.rootPath, candidate.repoPath);
          if (read._tag === 'Err') {
            initialFailures.set(candidate.repoPath, read.error.code);
            // A path may disappear between the cheap workspace observation and
            // the first Qdrant hit. Give the bounded exact-refresh path a chance
            // to reconcile the deletion rather than returning only stale hits.
            stalePaths.push(candidate.repoPath);
            warnings.push(candidate.repoPath + ': ' + read.error.code);
            failed.push('code');
            continue;
          }
          const stored = yield* activeConfig.artifacts.storeExact(read.value.bytes);
          if (stored._tag === 'Err') return stored;
          full = {
            bytes: read.value.bytes,
            digest: read.value.digest,
            handle: stored.value.handle,
            sizeBytes: stored.value.sizeBytes,
          };
          fullSources.set(candidate.repoPath, full);
        }
        // Both the digest AND the byte-exact AST slice must match. Never deliver
        // unverified Qdrant payload as if it were the workspace's current source.
        const current = full.digest === candidate.sourceDigest;
        const exactSpan = exactUtf8ByteRange(full.bytes, candidate.range);
        const verifiedText = exactSpan === undefined ? undefined
          : Buffer.from(full.bytes).subarray(exactSpan.offset, exactSpan.offset + exactSpan.length).toString('utf8');
        const verified = current && verifiedText !== undefined && verifiedText === candidate.text;
        const freshness = current ? (verified ? 'current' : 'unknown') : 'stale';
        if (!verified) {
          // Stable collections can still contain crash leftovers from a prior
          // source generation. Initial verification must trigger the same
          // bounded repair as a race at the final exact-source boundary.
          stalePaths.push(candidate.repoPath);
          warnings.push(candidate.repoPath + ': stale index or AST slice disagrees with current original bytes');
          failed.push('code');
        }
        const evidenceId = makeEvidenceId('code-' + createHash('sha256')
          .update([
            candidate.workspaceId,
            candidate.candidateId,
            candidate.repoPath,
            candidate.sourceDigest,
            candidate.symbolName ?? '',
            String(candidate.range.startLine),
            String(candidate.range.startColumn ?? ''),
            String(candidate.range.endLine),
            String(candidate.range.endColumn ?? ''),
          ].join('\0'), 'utf8')
          .digest('hex'));
        if (evidenceId._tag === 'Err') return evidenceId;
        // Even a partial response must never present an unverified indexed snippet as direct evidence.
        if (!verified || verifiedText === undefined) continue;
        const semanticColumn = candidate.semanticAnchor === undefined
          ? undefined
          : utf16ColumnAtUtf8Byte(full.bytes, candidate.semanticAnchor.line, candidate.semanticAnchor.byteColumn);
        const semanticEndColumn = candidate.semanticAnchor === undefined
          ? undefined
          : utf16ColumnAtUtf8Byte(full.bytes, candidate.semanticAnchor.endLine, candidate.semanticAnchor.endByteColumn);
        if (useLsp) {
          if (candidate.semanticAnchor === undefined || semanticColumn === undefined || semanticEndColumn === undefined) {
            warnings.push(candidate.repoPath + ': exact structural identifier anchor is unavailable for requested LSP enrichment');
            failed.push('lsp');
          } else {
            const definitions = yield* activeConfig.semantics.definition({
              repoPath: candidate.repoPath,
              line: candidate.semanticAnchor.line,
              column: semanticColumn,
              requestId: requestId.value,
              ...(activeConfig.semanticSnapshotIdentity === undefined ? {} : { snapshotIdentity: activeConfig.semanticSnapshotIdentity }),
            });
            if (definitions._tag === 'Err') {
              warnings.push(candidate.repoPath + ': language service unavailable (' + definitions.error.code + ')');
              failed.push('lsp');
            } else {
              const lspConfirmed = definitions.value.some((entry) =>
                entry.location.repoPath === candidate.repoPath
              && entry.location.startLine === candidate.semanticAnchor?.line
              && entry.location.startColumn === semanticColumn
              && entry.location.endLine === candidate.semanticAnchor?.endLine
              && entry.location.endColumn === semanticEndColumn
              && (candidate.symbolName === undefined || entry.name === undefined || entry.name === candidate.symbolName));
              if (!lspConfirmed) {
                warnings.push(candidate.repoPath + ': LSP definition does not agree with the selected structural node');
                failed.push('lsp');
              } else {
                lspConfirmedCount += 1;
              }
            }
          }
        }
        const baseEvidence = evidenceFromCandidate({ ...ranked, freshness }, evidenceId.value);
        evidence.push({
          ...baseEvidence,
          content: verifiedText,
          expansionHandle: full.handle,
          expansionTotalBytes: full.sizeBytes,
          ...(exactSpan === undefined ? {} : {
            expansionCursor: String(exactSpan.offset),
            expansionMaxBytes: exactSpan.length,
          }),
        });
      }

      if (input.includeDocs) {
        if (activeConfig.documentation === undefined) {
          warnings.push('documentation provider not configured');
          failed.push('documentation');
          if (sourceIsRequested(requirements.documentation)) {
            sourceCoverage = setSourceCoverage(sourceCoverage, 'documentation', 'unavailable', 'provider_not_configured');
          }
        } else {
          const documents = yield* activeConfig.documentation.search({
            workspaceId: input.workspaceId,
            query: input.query,
            topK: 5,
            requestId: requestId.value,
          });
          if (documents._tag === 'Err') {
            warnings.push('Vertex documentation unavailable: ' + documents.error.code);
            failed.push('documentation');
            if (sourceIsRequested(requirements.documentation)) {
              sourceCoverage = setSourceCoverage(
                sourceCoverage,
                'documentation',
                documents.error.code === 'POLICY_DENIED' ? 'denied' : 'unavailable',
                documents.error.code,
              );
            }
          } else {
            evidence.push(...documents.value);
            if (documents.value.length === 0) {
              warnings.push('Vertex documentation corpus returned no contexts');
              failed.push('documentation');
              if (sourceIsRequested(requirements.documentation)) {
                sourceCoverage = setSourceCoverage(sourceCoverage, 'documentation', 'empty', 'no_contexts');
              }
            } else if (documents.value.some((item) => item.freshness !== 'current')) {
              failed.push('documentation');
              if (sourceIsRequested(requirements.documentation)) {
                sourceCoverage = setSourceCoverage(sourceCoverage, 'documentation', 'partial', 'freshness_not_current');
              }
            } else if (sourceIsRequested(requirements.documentation)) {
              sourceCoverage = setSourceCoverage(sourceCoverage, 'documentation', 'satisfied');
            }
          }
        }
      }
      if (input.includeHistory === true) {
        const historyRequirement = requirements.history
          ?? { requirement: 'not_requested' as const, allowed: true };
        if (activeConfig.history === undefined) {
          warnings.push('Git history provider not configured');
          failed.push('history');
          if (sourceIsRequested(historyRequirement)) {
            sourceCoverage = setSourceCoverage(sourceCoverage, 'history', 'unavailable', 'provider_not_configured');
          }
        } else {
          const history = yield* activeConfig.history.search({
            rootPath: activeConfig.rootPath,
            query: input.query,
            limit: 5,
            requestId: requestId.value,
          });
          if (history._tag === 'Err') {
            warnings.push('Git history unavailable: ' + history.error.code);
            failed.push('history');
            if (sourceIsRequested(historyRequirement)) {
              sourceCoverage = setSourceCoverage(sourceCoverage, 'history', 'unavailable', history.error.code);
            }
          } else {
            evidence.push(...history.value);
            if (sourceIsRequested(historyRequirement)) {
              sourceCoverage = setSourceCoverage(
                sourceCoverage,
                'history',
                history.value.length === 0 ? 'empty' : 'satisfied',
                history.value.length === 0 ? 'no_matching_commits' : undefined,
              );
            }
            if (history.value.length === 0) failed.push('history');
          }
        }
      }

      if (input.includeMemory) {
        if (activeConfig.memory === undefined) {
          warnings.push('memory provider not configured');
          failed.push('memory');
          if (sourceIsRequested(requirements.memory)) {
            sourceCoverage = setSourceCoverage(sourceCoverage, 'memory', 'unavailable', 'provider_not_configured');
          }
        } else {
          const memories = yield* activeConfig.memory.search({
            workspaceId: input.workspaceId,
            query: input.query,
            includeOriginal: false,
            requestId: requestId.value,
          });
          if (memories._tag === 'Err') {
            warnings.push('temporal memory unavailable: ' + memories.error.code);
            failed.push('memory');
            if (sourceIsRequested(requirements.memory)) {
              sourceCoverage = setSourceCoverage(
                sourceCoverage,
                'memory',
                memories.error.code === 'POLICY_DENIED' ? 'denied' : 'unavailable',
                memories.error.code,
              );
            }
          } else {
            const boundedMemoryEvidence = memories.value.evidenceCompleteness === 'provider_bounded_top_k';
            if (boundedMemoryEvidence) {
              warnings.push('memory: provider_bounded_top_k does not establish exhaustive history');
              failed.push('memory');
            }
            if (sourceIsRequested(requirements.memory)) {
              sourceCoverage = setSourceCoverage(
                sourceCoverage,
                'memory',
                boundedMemoryEvidence ? 'partial' : 'satisfied',
                boundedMemoryEvidence ? 'provider_bounded_top_k' : undefined,
              );
            }
            for (const hit of memories.value.hits) {
              const evidenceId = makeEvidenceId('memory-' + createHash('sha256')
                .update([
                  hit.episode.episodeId,
                  hit.episode.contentDigest,
                  hit.episode.sourcePointer,
                  hit.matchingExcerpt,
                ].join('\0'), 'utf8')
                .digest('hex'));
              if (evidenceId._tag === 'Err') return evidenceId;
              evidence.push({
                evidenceId: evidenceId.value,
                source: 'memory',
                citation: hit.episode.sourcePointer,
                content: hit.matchingExcerpt,
                sourceDigest: hit.episode.contentDigest,
                proofClass: 'derived',
                // "current" here means the Graphiti edge was linked back to
                // byte-verified immutable archive provenance, not current source code.
                freshness: 'current',
                sourceRevision: hit.episode.contentDigest,
                sourceTimestampMs: hit.episode.occurredAtMs,
              });
            }
          }
        }
      }
      if (repoMapResult !== undefined && repoMapResult.rendered.trim().length > 0) {
        const evidenceId = makeEvidenceId('repo-map-' + createHash('sha256')
          .update([
            input.workspaceId,
            input.query,
            activeConfig.semanticSnapshotIdentity ?? activeConfig.indexKey ?? 'unbound',
            repoMapResult.rendered,
          ].join('\0'), 'utf8')
          .digest('hex'));
        if (evidenceId._tag === 'Err') return evidenceId;
        evidence.push({
          evidenceId: evidenceId.value,
          source: 'structural',
          citation: `repo-map:${activeConfig.semanticSnapshotIdentity ?? activeConfig.indexKey ?? 'unbound'}`,
          content: repoMapResult.rendered,
          proofClass: 'derived',
          // The rendered map may include sources outside the selected Qdrant
          // candidates, so the request-boundary exact reread below does not
          // prove the aggregate map current. Fail closed until RepoMap exposes
          // source-bound provenance that can be revalidated per rendered path.
          freshness: 'unknown',
          ...(activeConfig.semanticSnapshotIdentity === undefined
            ? {}
            : { sourceRevision: activeConfig.semanticSnapshotIdentity }),
        });
      }
      if (includeCode && (activeConfig.coverage?.failedPaths ?? 0) > 0) {
        warnings.push(`index coverage degraded: ${activeConfig.coverage?.failedPaths ?? 0} in-scope path(s) were not fully indexed`);
        failed.push('code');
      }
      // Revalidate as the LAST I/O step, after even slow Vertex/document calls.
      for (const [path, original] of fullSources) {
        const verificationStartedAtMs = Date.now();
        const current = yield* activeConfig.files.readExact(activeConfig.rootPath, path);
        const verifiedCurrent = current._tag === 'Ok' && current.value.digest === original.digest;
        providerTraceEvent(activeConfig.trace ?? noopProviderTrace, {
          provider: 'source_verification',
          providerVersion: 'workspace-file/v1',
          operation: 'read_exact_final',
          status: verifiedCurrent ? 'success' : 'failure',
          durationMs: Math.max(0, Date.now() - verificationStartedAtMs),
          requestId: requestId.value,
          ...(!verifiedCurrent ? {
            errorCode: current._tag === 'Err' ? current.error.code : 'DIGEST_MISMATCH',
          } : {}),
        });
        if (!verifiedCurrent) {
          warnings.push(path + ': source changed during retrieval');
          // Semantic confirmation was computed from the same pre-race source
          // generation, so a final digest race invalidates both direct code
          // freshness and LSP coverage.
          failed.push('code', 'lsp');
          stalePaths.push(path);
          for (let i = 0; i < evidence.length; i += 1) {
            if (evidence[i]?.citation.startsWith(path + ':')) {
              const existing = evidence[i];
              if (existing !== undefined) evidence[i] = { ...existing, freshness: 'changed_during_request', proofClass: 'uncertain' };
            }
          }
        }
      }
      if (stalePaths.length > 0 && retryBudget === 0
        && activeConfig.workspaceSync !== undefined
        && activeConfig.reconcile !== undefined) {
        const refreshed = yield* activeConfig.workspaceSync.refreshExact(stalePaths);
        if (refreshed._tag === 'Ok') {
          const reconciled = yield* activeConfig.reconcile(
            refreshed.value.state.workspaceManifest,
            refreshed.value.delta,
          );
          if (reconciled._tag === 'Ok') {
            activeConfig = reconciled.value;
            return yield* search(input, 1);
          }
        }
      }
      const merged = mergeEvidence(requestId.value, input.query, evidence, warnings, failed);
      if (requirements.code.requirement !== 'not_requested' && requirements.code.allowed) {
        sourceCoverage = setSourceCoverage(
          sourceCoverage,
          'code',
          !includeCode || codeProviderError !== undefined ? 'unavailable' : failed.includes('code') ? 'partial' : 'satisfied',
          !includeCode ? 'not_executed' : codeProviderError?.code,
        );
      }
      if (requirements.structural.requirement !== 'not_requested' && requirements.structural.allowed) {
        const renderedRepoMap = repoMapResult?.rendered.trim() ?? '';
        const structuralStatus = !includeCode || codeProviderError !== undefined
          ? 'unavailable'
          : activeConfig.repoMap === undefined || repoMapError !== undefined || repoMapResult === undefined
            ? 'unavailable'
            : renderedRepoMap.length === 0
              ? 'empty'
              : 'partial';
        sourceCoverage = setSourceCoverage(
          sourceCoverage,
          'structural',
          structuralStatus,
          !includeCode
            ? 'not_executed'
            : codeProviderError?.code
              ?? repoMapError?.code
              ?? (activeConfig.repoMap === undefined || repoMapResult === undefined
                ? 'repo_map_unavailable'
                : renderedRepoMap.length === 0 ? undefined : 'repo_map_not_exact_reread'),
        );
      }
      if (lspRequirement.requirement !== 'not_requested' && lspRequirement.allowed) {
        sourceCoverage = setSourceCoverage(
          sourceCoverage,
          'lsp',
          !includeCode || codeProviderError !== undefined
            ? 'unavailable'
            : rankedResults.length === 0
              ? 'empty'
              : failed.includes('lsp') || lspConfirmedCount < rankedResults.length ? 'partial' : 'satisfied',
          !includeCode ? 'not_executed' : codeProviderError?.code,
        );
      }
      const incomplete = requiredIncompleteSources(sourceCoverage);
      const covered = {
        ...merged,
        sourceCoverage,
        sourcePlan: requirements,
        partialSources: incomplete,
        complete: sourceCoverageComplete(sourceCoverage),
        ...(activeConfig.coverage === undefined ? {} : { indexCoverage: activeConfig.coverage }),
      };
      return ok(covered);
    }) as Effect.Effect<Result<ContextBundle, DomainError>>;
  /* eslint-enable @typescript-eslint/indent */
  return { search };
};
