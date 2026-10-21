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
  HttpPort,
  MemorySearchPort,
  ProviderTraceSink,
  RerankerPort,
  SemanticAnalysisPort,
  SparseEmbeddingPort,
  SparseVector,
  VectorEmbeddingPort,
  WorkspaceFilePort,
} from '../application/ports.js';
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
import {
  qdrantLexicalTextForCandidate,
  validateLocalQdrantBaseUrl,
} from './http-provider-boundaries.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';
import {
  diffWorkspaceManifests,
  workspaceManifestFromSnapshot,
  workspaceManifestEqual,
  type WorkspaceManifest,
  type WorkspaceManifestDelta,
} from '../domain/workspace-manifest.js';

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
  http: HttpPort,
  baseUrl: string,
  alias: string,
  allowedHosts: readonly string[] = [],
): Effect.Effect<Result<string | undefined, DomainError>> => Effect.gen(function* () {
  const endpoint = validateLocalQdrantBaseUrl(baseUrl, allowedHosts);
  if (endpoint._tag === 'Err') return endpoint;
  if (!/^[a-zA-Z0-9_.-]{1,255}$/u.test(alias)) {
    return err(domainError('INVALID_INPUT', 'qdrant_alias', 'Qdrant alias name is invalid'));
  }
  const listed = yield* http.request({ method: 'GET', url: `${endpoint.value}/aliases` });
  if (listed._tag === 'Err') return listed;
  if (listed.value.status < 200 || listed.value.status >= 300) {
    return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant_alias', 'could not inspect Qdrant aliases'));
  }
  const body = listed.value.body as { result?: { aliases?: unknown } };
  if (!Array.isArray(body.result?.aliases)) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_alias', 'Qdrant alias response is malformed'));
  }
  const target = body.result.aliases.find((item) =>
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
): Effect.Effect<Result<number, DomainError>> => Effect.gen(function* () {
  if (index.candidates.length === 0) {
    return err(domainError('UNSUPPORTED_PROVIDER', 'index', 'no verified structural candidates available for Qdrant'));
  }
  let count = 0;
  for (let offset = 0; offset < index.candidates.length; offset += 16) {
    const candidates = index.candidates.slice(offset, offset + 16);
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

export const probeQdrantService = (
  http: HttpPort,
  baseUrl: string,
  allowedHosts: readonly string[] = [],
): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
  const endpoint = validateLocalQdrantBaseUrl(baseUrl, allowedHosts);
  if (endpoint._tag === 'Err') return endpoint;
  const response = yield* http.request({
    method: 'GET',
    url: endpoint.value + '/collections',
  });
  if (response._tag === 'Err') return response;
  return response.value.status >= 200 && response.value.status < 300
    ? ok(undefined)
    : err(domainError(
      'EXTERNAL_UNAVAILABLE',
      'qdrant',
      'Qdrant service probe failed: HTTP ' + response.value.status,
    ));
});

// Collection bootstrap never replaces an existing collection. After a successful
// rebuild, obsolete generations for the same workspace may be pruned explicitly.
// Vector dimension must match the configured experimental embedding provider.
export const ensureQdrantCollection = (
  http: HttpPort,
  baseUrl: string,
  collection: string,
  dimension: number,
  allowedHosts: readonly string[] = [],
  apiKey?: string,
): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
  const endpoint = validateLocalQdrantBaseUrl(baseUrl, allowedHosts);
  if (endpoint._tag === 'Err') return endpoint;
  if (!Number.isSafeInteger(dimension) || dimension < 1) {
    return err(domainError('INVALID_INPUT', 'vector_dimension', 'invalid embedding dimension'));
  }
  const url = endpoint.value + '/collections/' + encodeURIComponent(collection);
  const headers = apiKey === undefined ? {} : { 'api-key': apiKey };
  const verifyExisting = (body: unknown): Result<void, DomainError> => {
    const payload = body as {
      result?: {
        config?: {
          params?: {
            vectors?: unknown;
            sparse_vectors?: unknown;
          };
        };
      };
    };
    const vectors = payload?.result?.config?.params?.vectors;
    const sparseVectors = payload?.result?.config?.params?.sparse_vectors;
    const dense = typeof vectors === 'object' && vectors !== null && !Array.isArray(vectors)
      ? (vectors as Record<string, unknown>).dense
      : undefined;
    const denseConfig = typeof dense === 'object' && dense !== null && !Array.isArray(dense)
      ? dense as Record<string, unknown>
      : undefined;
    const sparse = typeof sparseVectors === 'object' && sparseVectors !== null && !Array.isArray(sparseVectors)
      ? (sparseVectors as Record<string, unknown>).sparse
      : undefined;
    const sparseConfig = typeof sparse === 'object' && sparse !== null && !Array.isArray(sparse)
      ? sparse as Record<string, unknown>
      : undefined;
    return denseConfig?.size === dimension
      && denseConfig.distance === 'Cosine'
      && typeof sparseConfig?.modifier === 'string'
      && sparseConfig.modifier.toLowerCase() === 'idf'
      ? ok(undefined)
      : err(domainError(
        'INVALID_EXTERNAL_RESPONSE',
        'qdrant',
        'collection schema must expose dense cosine vectors and IDF-modified sparse vectors',
      ));
  };
  const found = yield* http.request({ method: 'GET', url, headers });
  if (found._tag === 'Err') return found;
  if (found.value.status === 200) {
    return verifyExisting(found.value.body);
  }
  if (found.value.status !== 404) {
    return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'cannot inspect collection: HTTP ' + found.value.status));
  }
  const created = yield* http.request({
    method: 'PUT',
    url,
    headers,
    body: {
      vectors: { dense: { size: dimension, distance: 'Cosine' } },
      sparse_vectors: { sparse: { modifier: 'idf' } },
    },
  });
  if (created._tag === 'Err') return created;
  if (created.value.status >= 200 && created.value.status < 300) return ok(undefined);
  if (created.value.status === 409) {
    // Two ACE writers may both observe 404 and race to create the same
    // content-addressed collection. Qdrant's 409 is success only after the
    // winner's resulting schema is re-read and verified. Older Qdrant builds
    // can briefly return 404/409/500 while the winner materializes metadata.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const raced = yield* http.request({ method: 'GET', url, headers });
      if (raced._tag === 'Ok' && raced.value.status === 200) return verifyExisting(raced.value.body);
      const transient = raced._tag === 'Err'
        || raced.value.status === 404
        || raced.value.status === 409
        || raced.value.status >= 500;
      if (!transient || attempt === 4) {
        return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'could not verify concurrently created collection'));
      }
      yield* Effect.sleep('100 millis');
    }
  }
  return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'could not create dedicated collection'));
});

/**
 * Publish a verified immutable collection through one Qdrant alias update.
 * The alias is the only read surface used by the runtime; collection creation
 * and point verification happen before this function is called.
 */
export const switchQdrantAlias = (
  http: HttpPort,
  baseUrl: string,
  alias: string,
  collection: string,
  allowedHosts: readonly string[] = [],
): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
  const endpoint = validateLocalQdrantBaseUrl(baseUrl, allowedHosts);
  if (endpoint._tag === 'Err') return endpoint;
  if (!/^[a-zA-Z0-9_.-]{1,255}$/u.test(alias) || !/^[a-zA-Z0-9_.-]{1,255}$/u.test(collection)) {
    return err(domainError('INVALID_INPUT', 'qdrant_alias', 'Qdrant alias and collection names are invalid'));
  }
  const listed = yield* http.request({ method: 'GET', url: `${endpoint.value}/aliases` });
  if (listed._tag === 'Err') return listed;
  if (listed.value.status < 200 || listed.value.status >= 300) {
    return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant_alias', 'could not inspect Qdrant aliases'));
  }
  const body = listed.value.body as { result?: { aliases?: unknown } };
  if (!Array.isArray(body.result?.aliases)) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_alias', 'Qdrant alias response is malformed'));
  }
  const existing = body.result.aliases.find((item) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
    && (item as { alias_name?: unknown }).alias_name === alias);
  const actions: Array<Readonly<Record<string, unknown>>> = [];
  if (existing !== undefined) actions.push({ delete_alias: { alias_name: alias } });
  actions.push({ create_alias: { collection_name: collection, alias_name: alias } });
  const switched = yield* http.request({
    method: 'POST',
    url: `${endpoint.value}/collections/aliases`,
    body: { actions },
  });
  if (switched._tag === 'Err') return switched;
  return switched.value.status >= 200 && switched.value.status < 300
    ? ok(undefined)
    : err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant_alias', 'atomic Qdrant alias switch failed'));
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
  http: HttpPort,
  baseUrl: string,
  collection: string,
  workspaceId: WorkspaceId,
  indexKey: string,
  expectedCount: number,
  allowedHosts: readonly string[] = [],
): Effect.Effect<Result<boolean, DomainError>> => Effect.gen(function* () {
  const endpoint = validateLocalQdrantBaseUrl(baseUrl, allowedHosts);
  if (endpoint._tag === 'Err') return endpoint;
  if (indexKey.length === 0 || !Number.isSafeInteger(expectedCount) || expectedCount <= 0) {
    return err(domainError('INVALID_INPUT', 'snapshot', 'snapshot identity and expected positive candidate count are required'));
  }
  const response = yield* http.request({
    method: 'POST',
    url: endpoint.value + '/collections/' + encodeURIComponent(collection) + '/points/count',
    body: {
      exact: true,
      filter: {
        must: [
          { key: 'workspace_id', match: { value: workspaceId } },
          { key: 'index_key', match: { value: indexKey } },
        ],
      },
    },
  });
  if (response._tag === 'Err') return response;
  if (response.value.status < 200 || response.value.status >= 300) {
    return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'could not verify current snapshot count'));
  }
  const body = response.value.body as { result?: { count?: unknown } };
  const count = body?.result?.count;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_count', 'invalid exact snapshot count'));
  }
  return ok(count === expectedCount);
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
    sourceSnapshotDigest: coverage.sourceSnapshotDigest,
    parserVersion: coverage.parserVersion,
    attemptedPaths: coverage.attemptedPaths,
    indexedPaths: coverage.indexedPaths,
    policyExcludedPaths: coverage.policyExcludedPaths,
    outOfScopePaths: coverage.outOfScopePaths,
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
  http: HttpPort,
  baseUrl: string,
  collection: string,
  workspaceId: WorkspaceId,
  indexKey: string,
  expectedCandidateIds: readonly string[],
  allowedHosts: readonly string[] = [],
): Effect.Effect<Result<boolean, DomainError>> => Effect.gen(function* () {
  const endpoint = validateLocalQdrantBaseUrl(baseUrl, allowedHosts);
  if (endpoint._tag === 'Err') return endpoint;
  const observed: string[] = [];
  let offset: unknown;
  for (let page = 0; page < 10_000; page += 1) {
    const response = yield* http.request({
      method: 'POST',
      url: endpoint.value + '/collections/' + encodeURIComponent(collection) + '/points/scroll',
      body: {
        limit: 256,
        with_payload: ['candidate_id'],
        with_vector: false,
        filter: { must: [
          { key: 'workspace_id', match: { value: workspaceId } },
          { key: 'index_key', match: { value: indexKey } },
        ] },
        ...(offset === undefined ? {} : { offset }),
      },
    });
    if (response._tag === 'Err') return response;
    if (response.value.status < 200 || response.value.status >= 300) {
      return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'could not verify snapshot membership'));
    }
    const body = response.value.body as { result?: { points?: unknown; next_page_offset?: unknown } };
    const points = body?.result?.points;
    if (!Array.isArray(points)) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'snapshot membership response must contain points'));
    }
    for (const point of points) {
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
    const nextPageOffset = body?.result?.next_page_offset;
    if (nextPageOffset === undefined || nextPageOffset === null) break;
    offset = nextPageOffset;
    if (page === 9_999) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'snapshot membership pagination did not terminate'));
    }
  }
  const expected = [...expectedCandidateIds].sort();
  observed.sort();
  return ok(expected.length === observed.length && expected.every((value, index) => value === observed[index]));
});

export const readQdrantSnapshotVectors = (
  http: HttpPort,
  baseUrl: string,
  collection: string,
  workspaceId: WorkspaceId,
  indexKey?: string,
  allowedHosts: readonly string[] = [],
): Effect.Effect<Result<ReadonlyMap<string, readonly number[]>, DomainError>> => Effect.gen(function* () {
  const endpoint = validateLocalQdrantBaseUrl(baseUrl, allowedHosts);
  if (endpoint._tag === 'Err') return endpoint;
  const vectors = new Map<string, readonly number[]>();
  let offset: unknown;
  for (let page = 0; page < 10_000; page += 1) {
    const response = yield* http.request({
      method: 'POST',
      url: endpoint.value + '/collections/' + encodeURIComponent(collection) + '/points/scroll',
      body: {
        limit: 256,
        with_payload: ['candidate_id'],
        with_vector: true,
        filter: { must: [
          { key: 'workspace_id', match: { value: workspaceId } },
          ...(indexKey === undefined ? [] : [{ key: 'index_key', match: { value: indexKey } }]),
        ] },
        ...(offset === undefined ? {} : { offset }),
      },
    });
    if (response._tag === 'Err') return response;
    if (response.value.status < 200 || response.value.status >= 300) {
      return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'could not read prior snapshot vectors'));
    }
    const body = response.value.body as { result?: { points?: unknown; next_page_offset?: unknown } };
    if (!Array.isArray(body?.result?.points)) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'prior snapshot vector response requires points'));
    }
    for (const point of body.result.points) {
      if (typeof point !== 'object' || point === null || Array.isArray(point)) continue;
      const record = point as { payload?: unknown; vector?: unknown };
      if (typeof record.payload !== 'object' || record.payload === null || Array.isArray(record.payload)) continue;
      const candidateId = (record.payload as { candidate_id?: unknown }).candidate_id;
      const embeddingKey = (record.payload as { embedding_key?: unknown }).embedding_key;
      if (typeof candidateId !== 'string') continue;
      const denseVector = Array.isArray(record.vector)
        ? record.vector
        : typeof record.vector === 'object' && record.vector !== null && !Array.isArray(record.vector)
          ? (record.vector as Record<string, unknown>).dense
          : undefined;
      if (!Array.isArray(denseVector) || denseVector.length === 0
        || !denseVector.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_vector', 'prior snapshot contains an invalid dense vector'));
      }
      vectors.set(typeof embeddingKey === 'string' ? embeddingKey : candidateId, denseVector as number[]);
    }
    const next = body.result.next_page_offset;
    if (next === undefined || next === null) break;
    offset = next;
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
  http: HttpPort,
  baseUrl: string,
  collection: string,
  workspaceId: WorkspaceId,
  indexKey: string,
  allowedHosts: readonly string[] = [],
  reuseAllowed = true,
  priorIndexKey?: string,
  embeddingProviderIdentity?: string,
  priorCollection?: string,
  sparseEmbeddings?: SparseEmbeddingPort,
): Effect.Effect<Result<{ readonly count: number; readonly reused: boolean; readonly reusedVectorCount: number }, DomainError>> => Effect.gen(function* () {
  const expectedCandidateIds = index.candidates.map((candidate) => candidate.candidateId);
  if (reuseAllowed) {
    const checked = yield* hasExactQdrantSnapshot(
      http, baseUrl, collection, workspaceId, indexKey, index.candidates.length, allowedHosts,
    );
    if (checked._tag === 'Err') return checked;
    if (checked.value) {
      const membership = yield* verifyQdrantSnapshotMembership(
        http, baseUrl, collection, workspaceId, indexKey, expectedCandidateIds, allowedHosts,
      );
      if (membership._tag === 'Err') return membership;
      if (membership.value) return ok({ count: index.candidates.length, reused: true, reusedVectorCount: index.candidates.length });
    }
  }
  // Do not delete an in-use snapshot while another process may still read it.
  // Snapshot-scoped deterministic point IDs make same-snapshot writes idempotent
  // and different snapshots independent.
  let seedVectors: ReadonlyMap<string, readonly number[]> = new Map();
  if (priorCollection !== undefined || priorIndexKey !== undefined) {
    const prior = yield* readQdrantSnapshotVectors(
      http,
      baseUrl,
      priorCollection ?? collection,
      workspaceId,
      priorIndexKey === indexKey ? undefined : priorIndexKey,
      allowedHosts,
    );
    if (prior._tag === 'Err') return prior;
    const currentKeys = new Set<string>(index.candidates.map((candidate) => embeddingProviderIdentity === undefined
      ? candidate.candidateId
      : embeddingContentKey(embeddingProviderIdentity, candidate.text)));
    seedVectors = new Map([...prior.value].filter(([key]) => currentKeys.has(key)));
  }
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
    http, baseUrl, collection, workspaceId, indexKey, expectedCandidateIds, allowedHosts,
  );
  if (verified._tag === 'Err') return verified;
  if (!verified.value) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_snapshot', 'rebuilt snapshot membership does not match the structural index'));
  }
  return ok({ count: indexed.value, reused: false, reusedVectorCount: seedVectors.size });
});

/** ast-grep uses one-based line/column coordinates here, but columns count UTF-8 bytes.
 * Re-slice authoritative workspace bytes and compare them with the Qdrant payload.
 * Qdrant ranking never confers source-of-truth status. */
export const exactUtf8ByteRange = (
  bytes: Uint8Array,
  range: { readonly startLine: number; readonly endLine: number; readonly startColumn?: number; readonly endColumn?: number },
): { readonly offset: number; readonly length: number } | undefined => {
  if (range.startColumn === undefined || range.endColumn === undefined) return undefined;
  if (![range.startLine, range.endLine, range.startColumn, range.endColumn]
    .every((value) => Number.isSafeInteger(value) && (value as number) >= 1)
    || range.startLine > range.endLine) return undefined;
  const raw = Buffer.from(bytes);
  const lineOffsets = [0];
  for (let i = 0; i < raw.length; i += 1) if (raw[i] === 10) lineOffsets.push(i + 1);
  const a = lineOffsets[range.startLine - 1];
  const b = lineOffsets[range.endLine - 1];
  if (a === undefined || b === undefined) return undefined;
  // An untrusted column must not spill into another line.
  const startLineEnd = lineOffsets[range.startLine] === undefined
    ? raw.length : (lineOffsets[range.startLine] as number) - 1;
  const endLineEnd = lineOffsets[range.endLine] === undefined
    ? raw.length : (lineOffsets[range.endLine] as number) - 1;
  const from = a + (range.startColumn as number) - 1;
  const until = b + (range.endColumn as number) - 1;
  if (from < a || from >= startLineEnd || until < b || until > endLineEnd || until <= from) return undefined;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(from, until));
  } catch {
    return undefined;
  }
  return { offset: from, length: until - from };
};

const utf16ColumnAtUtf8Byte = (
  bytes: Uint8Array,
  line: number,
  byteColumn: number,
): number | undefined => {
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(byteColumn) || byteColumn < 1) return undefined;
  const raw = Buffer.from(bytes);
  const lineOffsets = [0];
  for (let i = 0; i < raw.length; i += 1) if (raw[i] === 10) lineOffsets.push(i + 1);
  const start = lineOffsets[line - 1];
  if (start === undefined) return undefined;
  const end = lineOffsets[line] === undefined ? raw.length : (lineOffsets[line] as number) - 1;
  const target = start + byteColumn - 1;
  if (target < start || target > end) return undefined;
  try {
    const prefix = new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(start, target));
    return prefix.length + 1;
  } catch {
    return undefined;
  }
};

export const exactUtf8Span = (
  bytes: Uint8Array,
  range: { readonly startLine: number; readonly endLine: number; readonly startColumn?: number; readonly endColumn?: number },
): string | undefined => {
  const span = exactUtf8ByteRange(bytes, range);
  return span === undefined
    ? undefined
    : Buffer.from(bytes).subarray(span.offset, span.offset + span.length).toString('utf8');
};

export const makeQdrantContextProvider = (config: QdrantContextConfig) => {
  let activeConfig = config;
  return {
    search: (input: {
      readonly workspaceId: WorkspaceId;
      readonly query: string;
      readonly includeCode?: boolean;
      readonly includeDocs: boolean;
      readonly includeMemory: boolean;
      readonly includeHistory?: boolean;
      readonly sourceRequirements?: SourceRequirements;
      readonly workingContextHints?: WorkingContextHints;
    }): Effect.Effect<Result<ContextBundle, DomainError>> => Effect.gen(function* () {
      if (input.workspaceId !== activeConfig.workspaceId) {
        return err(domainError('POLICY_DENIED', 'workspace_id', 'Qdrant provider belongs to another workspace'));
      }
      let requestWorkingContext: WorkingContext | undefined;
      if (activeConfig.workspaceManifest !== undefined) {
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
      const requestId = makeRequestId(activeConfig.newRequestId());
      if (requestId._tag === 'Err') return requestId;
      const includeCode = input.includeCode ?? true;
      const requirements = input.sourceRequirements ?? legacySourceRequirements({
        includeCode,
        includeDocs: input.includeDocs,
        includeMemory: input.includeMemory,
      });
      let sourceCoverage = initialSourceCoverage(requirements);
      const evidence: RetrievalEvidence[] = [];
      const warnings: string[] = [];
      const failed: string[] = [];
      let codeProviderError: DomainError | undefined;
      let rankedResults: readonly RankedCandidate[] = [];
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
            ...(activeConfig.generation === undefined ? {} : { generation: activeConfig.generation }),
            ...(activeConfig.indexKey === undefined ? {} : { indexKey: activeConfig.indexKey }),
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
            const prioritized = applyWorkingContextPriors(
              result.value,
              requestWorkingContext,
              input.workingContextHints,
              retrievalLimit,
            );
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
        let lspConfirmed = false;
        if (candidate.semanticAnchor === undefined || semanticColumn === undefined || semanticEndColumn === undefined) {
          warnings.push(candidate.repoPath + ': exact structural identifier anchor is unavailable');
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
            lspConfirmed = definitions.value.some((entry) =>
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
        const baseEvidence = evidenceFromCandidate({ ...ranked, freshness }, evidenceId.value);
        evidence.push({
          ...baseEvidence,
          proofClass: lspConfirmed ? baseEvidence.proofClass : 'uncertain',
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
          failed.push('code');
          for (let i = 0; i < evidence.length; i += 1) {
            if (evidence[i]?.citation.startsWith(path + ':')) {
              const existing = evidence[i];
              if (existing !== undefined) evidence[i] = { ...existing, freshness: 'changed_during_request', proofClass: 'uncertain' };
            }
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
        sourceCoverage = setSourceCoverage(
          sourceCoverage,
          'structural',
          !includeCode || codeProviderError !== undefined
            ? 'unavailable'
            : rankedResults.length === 0
              ? 'empty'
              : (activeConfig.coverage?.failedPaths ?? 0) > 0 ? 'partial' : 'satisfied',
          !includeCode ? 'not_executed' : codeProviderError?.code,
        );
      }
      const lspRequirement = requirements.lsp ?? { requirement: 'not_requested' as const, allowed: true };
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
    }),
  };
};
