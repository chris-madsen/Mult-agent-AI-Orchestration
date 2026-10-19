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
  type ContextBundle,
  type IndexCoverageSummary,
  type RankedCandidate,
  type RetrievalEvidence,
} from '../domain/retrieval.js';
import type {
  ArtifactStore,
  CodeCandidatePort,
  CodePoint,
  DocumentationPort,
  HttpPort,
  MemorySearchPort,
  ProviderTraceSink,
  SemanticAnalysisPort,
  VectorEmbeddingPort,
  WorkspaceFilePort,
} from '../application/ports.js';
import type { RepoPath, WorkspaceId } from '../domain/workspace.js';
import { validateLocalQdrantBaseUrl } from './http-provider-boundaries.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';

export interface QdrantContextConfig {
  readonly workspaceId: WorkspaceId;
  readonly rootPath: string;
  readonly files: WorkspaceFilePort;
  readonly qdrant: CodeCandidatePort;
  readonly embeddings: VectorEmbeddingPort;
  readonly artifacts: ArtifactStore;
  readonly semantics: SemanticAnalysisPort;
  readonly newRequestId: () => string;
  readonly generation?: number;
  readonly indexKey?: string;
  readonly documentation?: DocumentationPort;
  readonly memory?: MemorySearchPort;
  readonly candidateLimit?: number;
  readonly coverage?: IndexCoverageSummary;
  readonly trace?: ProviderTraceSink;
}

export const populateQdrantFromStructuralIndex = (
  index: CodeIndex,
  qdrant: CodeCandidatePort,
  embeddings: VectorEmbeddingPort,
  indexKey?: string,
  seedVectors: ReadonlyMap<string, readonly number[]> = new Map(),
): Effect.Effect<Result<number, DomainError>> => Effect.gen(function* () {
  if (index.candidates.length === 0) {
    return err(domainError('UNSUPPORTED_PROVIDER', 'index', 'no verified structural candidates available for Qdrant'));
  }
  let count = 0;
  for (let offset = 0; offset < index.candidates.length; offset += 16) {
    const candidates = index.candidates.slice(offset, offset + 16);
    const missing = candidates.filter((candidate) => !seedVectors.has(candidate.candidateId));
    const embedded: Result<readonly (readonly number[])[], DomainError> = missing.length === 0
      ? ok([])
      : yield* embeddings.embedMany(missing.map((candidate) => candidate.text));
    if (embedded._tag === 'Err') return embedded;
    if (embedded.value.length !== missing.length) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding', 'embedding batch size mismatch'));
    }
    const generated = new Map(missing.map((candidate, vectorIndex) => [candidate.candidateId, embedded.value[vectorIndex] ?? []] as const));
    const points: CodePoint[] = [];
    for (const candidate of candidates) {
      const vector = seedVectors.get(candidate.candidateId) ?? generated.get(candidate.candidateId);
      if (vector === undefined || vector.length === 0 || !vector.every((value) => Number.isFinite(value))) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding', 'candidate is missing a valid vector'));
      }
      points.push({ candidate, vector, ...(indexKey === undefined ? {} : { indexKey }) });
    }
    const result = yield* qdrant.upsert(points);
    if (result._tag === 'Err') return result;
    count += candidates.length;
  }
  return ok(count);
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
  const found = yield* http.request({ method: 'GET', url, headers });
  if (found._tag === 'Err') return found;
  if (found.value.status === 200) {
    const body = found.value.body as { result?: { config?: { params?: { vectors?: { size?: number; distance?: string } } } } };
    const configured = body?.result?.config?.params?.vectors?.size;
    if (configured !== dimension || body?.result?.config?.params?.vectors?.distance !== 'Cosine') {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant', 'collection vector size or distance is incompatible with cosine embeddings'));
    }
    return ok(undefined);
  }
  if (found.value.status !== 404) {
    return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'cannot inspect collection: HTTP ' + found.value.status));
  }
  const created = yield* http.request({
    method: 'PUT', url, headers, body: { vectors: { size: dimension, distance: 'Cosine' } },
  });
  if (created._tag === 'Err') return created;
  return created.value.status >= 200 && created.value.status < 300
    ? ok(undefined)
    : err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'could not create dedicated collection'));
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
): string => {
  const stable = [...index.candidates]
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
    .map((candidate) => [
      candidate.candidateId,
      candidate.repoPath,
      candidate.sourceDigest,
      candidate.symbolName ?? null,
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
    attemptedPaths: coverage.attemptedPaths,
    indexedPaths: coverage.indexedPaths,
    policyExcludedPaths: coverage.policyExcludedPaths,
    outOfScopePaths: coverage.outOfScopePaths,
    failedPaths: coverage.failedPaths,
    failures: [...coverage.failures]
      .map((failure) => [failure.repoPath, failure.kind, failure.code ?? null])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  };
  return createHash('sha256')
    .update(JSON.stringify({ stable, coverage: coverageIdentity ?? null, providerFingerprint: providerFingerprint ?? null }), 'utf8')
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
        with_payload: true,
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
  indexKey: string,
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
        with_payload: true,
        with_vector: true,
        filter: { must: [
          { key: 'workspace_id', match: { value: workspaceId } },
          { key: 'index_key', match: { value: indexKey } },
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
      if (typeof candidateId !== 'string') continue;
      if (!Array.isArray(record.vector) || record.vector.length === 0
        || !record.vector.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_vector', 'prior snapshot contains an invalid vector'));
      }
      vectors.set(candidateId, record.vector as number[]);
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
  if (priorIndexKey !== undefined && priorIndexKey !== indexKey) {
    const prior = yield* readQdrantSnapshotVectors(http, baseUrl, collection, workspaceId, priorIndexKey, allowedHosts);
    if (prior._tag === 'Err') return prior;
    const currentIds = new Set<string>(index.candidates.map((candidate) => candidate.candidateId));
    seedVectors = new Map([...prior.value].filter(([candidateId]) => currentIds.has(candidateId)));
  }
  const indexed = yield* populateQdrantFromStructuralIndex(index, qdrant, embeddings, indexKey, seedVectors);
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

export const pruneQdrantOtherGenerations = (
  http: HttpPort,
  baseUrl: string,
  collection: string,
  workspaceId: WorkspaceId,
  generation: number,
  allowedHosts: readonly string[] = [],
  indexKey?: string,
): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
  const endpoint = validateLocalQdrantBaseUrl(baseUrl, allowedHosts);
  if (endpoint._tag === 'Err') return endpoint;
  if (!Number.isSafeInteger(generation) || generation < 1) {
    return err(domainError('INVALID_INPUT', 'generation', 'Qdrant generation must be a positive integer'));
  }
  const deleted = yield* http.request({
    method: 'POST',
    url: endpoint.value + '/collections/' + encodeURIComponent(collection) + '/points/delete?wait=true',
    body: {
      filter: {
        must: [{ key: 'workspace_id', match: { value: workspaceId } }],
        must_not: [indexKey === undefined
          ? { key: 'generation', match: { value: generation } }
          : { key: 'index_key', match: { value: indexKey } }],
      },
    },
  });
  if (deleted._tag === 'Err') return deleted;
  return deleted.value.status >= 200 && deleted.value.status < 300
    ? ok(undefined)
    : err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'could not prune obsolete index generations'));
});

export const listQdrantSnapshotKeys = (
  http: HttpPort,
  baseUrl: string,
  collection: string,
  workspaceId: WorkspaceId,
  allowedHosts: readonly string[] = [],
): Effect.Effect<Result<ReadonlySet<string>, DomainError>> => Effect.gen(function* () {
  const endpoint = validateLocalQdrantBaseUrl(baseUrl, allowedHosts);
  if (endpoint._tag === 'Err') return endpoint;
  const keys = new Set<string>();
  let offset: unknown;
  for (let page = 0; page < 10_000; page += 1) {
    const response = yield* http.request({
      method: 'POST',
      url: endpoint.value + '/collections/' + encodeURIComponent(collection) + '/points/scroll',
      body: {
        limit: 256,
        with_payload: true,
        with_vector: false,
        filter: { must: [{ key: 'workspace_id', match: { value: workspaceId } }] },
        ...(offset === undefined ? {} : { offset }),
      },
    });
    if (response._tag === 'Err') return response;
    if (response.value.status < 200 || response.value.status >= 300) {
      return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'could not enumerate snapshot keys'));
    }
    const body = response.value.body as { result?: { points?: unknown; next_page_offset?: unknown } };
    if (!Array.isArray(body?.result?.points)) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'snapshot enumeration requires points'));
    }
    for (const point of body.result.points) {
      if (typeof point !== 'object' || point === null || Array.isArray(point)) continue;
      const payload = (point as { payload?: unknown }).payload;
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) continue;
      const indexKey = (payload as { index_key?: unknown }).index_key;
      if (typeof indexKey === 'string' && /^[a-f0-9]{64}$/u.test(indexKey)) keys.add(indexKey);
    }
    const next = body.result.next_page_offset;
    if (next === undefined || next === null) break;
    offset = next;
    if (page === 9_999) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant_scroll', 'snapshot enumeration pagination did not terminate'));
    }
  }
  return ok(keys);
});

export const pruneQdrantUnleasedSnapshots = (
  http: HttpPort,
  baseUrl: string,
  collection: string,
  workspaceId: WorkspaceId,
  retainedIndexKeys: ReadonlySet<string>,
  allowedHosts: readonly string[] = [],
): Effect.Effect<Result<readonly string[], DomainError>> => Effect.gen(function* () {
  const endpoint = validateLocalQdrantBaseUrl(baseUrl, allowedHosts);
  if (endpoint._tag === 'Err') return endpoint;
  const listed = yield* listQdrantSnapshotKeys(http, baseUrl, collection, workspaceId, allowedHosts);
  if (listed._tag === 'Err') return listed;
  const deleted: string[] = [];
  for (const indexKey of listed.value) {
    if (retainedIndexKeys.has(indexKey)) continue;
    const response = yield* http.request({
      method: 'POST',
      url: endpoint.value + '/collections/' + encodeURIComponent(collection) + '/points/delete?wait=true',
      body: { filter: { must: [
        { key: 'workspace_id', match: { value: workspaceId } },
        { key: 'index_key', match: { value: indexKey } },
      ] } },
    });
    if (response._tag === 'Err') return response;
    if (response.value.status < 200 || response.value.status >= 300) {
      return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'could not delete an unleased snapshot'));
    }
    deleted.push(indexKey);
  }
  return ok(deleted);
});

/** Tree-sitter uses one-based line/column coordinates here, but columns count UTF-8 bytes.
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

export const makeQdrantContextProvider = (config: QdrantContextConfig) => ({
  search: (input: {
    readonly workspaceId: WorkspaceId;
    readonly query: string;
    readonly includeCode: boolean;
    readonly includeDocs: boolean;
    readonly includeMemory: boolean;
  }): Effect.Effect<Result<ContextBundle, DomainError>> => Effect.gen(function* () {
    if (input.workspaceId !== config.workspaceId) {
      return err(domainError('POLICY_DENIED', 'workspace_id', 'Qdrant provider belongs to another workspace'));
    }
    const requestId = makeRequestId(config.newRequestId());
    if (requestId._tag === 'Err') return requestId;
    let rankedResults: readonly RankedCandidate[] = [];
    if (input.includeCode) {
      const vectors = yield* config.embeddings.embedMany([input.query], requestId.value);
      if (vectors._tag === 'Err') return vectors;
      const vector = vectors.value[0];
      if (vector === undefined) return err(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding', 'empty query vector'));
      const result = yield* config.qdrant.search({
        workspaceId: input.workspaceId,
        vector,
        limit: config.candidateLimit ?? 6,
        ...(config.generation === undefined ? {} : { generation: config.generation }),
        ...(config.indexKey === undefined ? {} : { indexKey: config.indexKey }),
        requestId: requestId.value,
      });
      if (result._tag === 'Err') return result;
      rankedResults = result.value;
    }

    const evidence: RetrievalEvidence[] = [];
    const warnings: string[] = [];
    const failed: string[] = [];
    const fullSources = new Map<RepoPath, { readonly bytes: Uint8Array; readonly digest: string; readonly handle: string }>();

    const initialFailures = new Map<RepoPath, string>();
    for (const [i, ranked] of rankedResults.entries()) {
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
        const read = yield* config.files.readExact(config.rootPath, candidate.repoPath);
        if (read._tag === 'Err') {
          initialFailures.set(candidate.repoPath, read.error.code);
          warnings.push(candidate.repoPath + ': ' + read.error.code);
          failed.push('code');
          continue;
        }
        const stored = yield* config.artifacts.storeExact(read.value.bytes);
        if (stored._tag === 'Err') return stored;
        full = { bytes: read.value.bytes, digest: read.value.digest, handle: stored.value.handle };
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
      const evidenceId = makeEvidenceId('qdrant-code-' + (i + 1));
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
        const definitions = yield* config.semantics.definition({
          repoPath: candidate.repoPath,
          line: candidate.semanticAnchor.line,
          column: semanticColumn,
          requestId: requestId.value,
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
          }
        }
      }
      const baseEvidence = evidenceFromCandidate({ ...ranked, freshness }, evidenceId.value);
      evidence.push({
        ...baseEvidence,
        proofClass: lspConfirmed ? baseEvidence.proofClass : 'uncertain',
        content: verifiedText,
        expansionHandle: full.handle,
        ...(exactSpan === undefined ? {} : {
          expansionCursor: String(exactSpan.offset),
          expansionMaxBytes: exactSpan.length,
        }),
      });
    }

    if (input.includeDocs) {
      if (config.documentation === undefined) {
        warnings.push('documentation provider not configured'); failed.push('documentation');
      } else {
        const documents = yield* config.documentation.search({
          workspaceId: input.workspaceId,
          query: input.query,
          topK: 5,
          requestId: requestId.value,
        });
        if (documents._tag === 'Err') {
          warnings.push('Vertex documentation unavailable: ' + documents.error.code);
          failed.push('documentation');
        } else {
          evidence.push(...documents.value);
          if (documents.value.length === 0) {
            warnings.push('Vertex documentation corpus returned no contexts');
            failed.push('documentation');
          }
          // Vertex cloud RAG chunks are not verified against current workspace documents.
          if (documents.value.some((item) => item.freshness !== 'current')) failed.push('documentation');
        }
      }
    }
    if (input.includeMemory) {
      if (config.memory === undefined) {
        warnings.push('memory provider not configured');
        failed.push('memory');
      } else {
        const memories = yield* config.memory.search({
          workspaceId: input.workspaceId,
          query: input.query,
          includeOriginal: false,
          requestId: requestId.value,
        });
        if (memories._tag === 'Err') {
          warnings.push('temporal memory unavailable: ' + memories.error.code);
          failed.push('memory');
        } else {
          for (const [index, hit] of memories.value.hits.entries()) {
            const evidenceId = makeEvidenceId('memory-' + (index + 1));
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
    if (input.includeCode && (config.coverage?.failedPaths ?? 0) > 0) {
      warnings.push(`index coverage degraded: ${config.coverage?.failedPaths ?? 0} in-scope path(s) were not fully indexed`);
      failed.push('code');
    }
    // Revalidate as the LAST I/O step, after even slow Vertex/document calls.
    for (const [path, original] of fullSources) {
      const verificationStartedAtMs = Date.now();
      const current = yield* config.files.readExact(config.rootPath, path);
      const verifiedCurrent = current._tag === 'Ok' && current.value.digest === original.digest;
      providerTraceEvent(config.trace ?? noopProviderTrace, {
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
    return ok(config.coverage === undefined ? merged : { ...merged, indexCoverage: config.coverage });
  }),
});
