import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { QdrantClient } from '@qdrant/js-client-rest';
import { authorizeOutbound, type ProjectDataPolicy } from '../domain/policy.js';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  makeCodeCandidate,
  type CandidateFreshness,
  type CodeCandidate,
  type RetrievalEvidence,
  type RankedCandidate,
} from '../domain/retrieval.js';
import { makeContentDigest, ingestRepoPath, type WorkspaceId } from '../domain/workspace.js';
import { projectionKey, type ProjectionReceipt } from '../domain/memory.js';
import { containsLikelySecret } from '../domain/sensitive-text.js';
import type { StructuralKind } from '../domain/semantic.js';
import type {
  CodeCandidatePort,
  CodePoint,
  DocumentationPort,
  GraphProjectionPort,
  HttpPort,
  HttpRequest,
  HttpResponse,
  ProviderTraceSink,
} from '../application/ports.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const stringField = (value: Record<string, unknown>, key: string): Result<string, DomainError> =>
  typeof value[key] === 'string' && value[key].trim().length > 0
    ? ok(value[key].trim())
    : err(domainError('INVALID_EXTERNAL_RESPONSE', key, `external response field ${key} is required`));

const integerField = (value: Record<string, unknown>, key: string): Result<number, DomainError> =>
  typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 1
    ? ok(value[key])
    : err(domainError('INVALID_EXTERNAL_RESPONSE', key, `external response field ${key} must be a positive integer`));

const externalFailure = (response: HttpResponse, provider: string): Result<never, DomainError> => {
  const body = object(response.body);
  const status = object(body?.status);
  const detail = typeof status?.error === 'string' ? `: ${status.error.slice(0, 240)}` : '';
  return err(domainError('EXTERNAL_UNAVAILABLE', provider, `external provider returned HTTP ${response.status}${detail}`));
};

const successful = (response: HttpResponse): boolean => response.status >= 200 && response.status < 300;

export const makeFetchHttpPort = (): HttpPort => ({
  request: (request: HttpRequest) => Effect.catchAll(Effect.tryPromise<Result<HttpResponse, DomainError>, DomainError>({
    try: async (signal) => {
      const timeout = AbortSignal.timeout(request.timeoutMs ?? 10_000);
      const response = await fetch(request.url, {
        method: request.method,
        headers: { 'content-type': 'application/json', ...request.headers },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.any([signal, timeout]),
      });
      const text = await response.text();
      let body: unknown = text;
      try { body = text.length === 0 ? {} : JSON.parse(text) as unknown; } catch { /* preserve non-JSON body */ }
      return ok({ status: response.status, body });
    },
    catch: () => domainError('EXTERNAL_UNAVAILABLE', 'http', 'external HTTP request failed or timed out'),
  }), (failure) => Effect.succeed(err(failure))),
});

interface QdrantConfig {
  readonly baseUrl: string;
  readonly collection: string;
  readonly http: HttpPort;
  /** Explicit local bridge aliases (for example a Docker host gateway). */
  readonly allowedHosts?: readonly string[];
  readonly apiKey?: () => string | undefined;
  /** Official SDK client used by the replacement composition; tests may omit it and use HttpPort. */
  readonly client?: QdrantClient;
  readonly providerVersion?: string;
  readonly trace?: ProviderTraceSink;
}

export const validateLocalQdrantBaseUrl = (
  baseUrl: string,
  allowedHosts: readonly string[] = [],
): Result<string, DomainError> => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return err(domainError('INVALID_INPUT', 'qdrant_url', 'Qdrant URL must be a valid absolute URL'));
  }
  const hostname = url.hostname.toLocaleLowerCase().replace(/^\[|\]$/gu, '');
  const allowed = new Set(['localhost', '127.0.0.1', '::1', ...allowedHosts.map((host) => host.trim().toLocaleLowerCase())]);
  if (url.protocol !== 'http:' || !allowed.has(hostname) || url.username !== '' || url.password !== '') {
    return err(domainError(
      'POLICY_DENIED',
      'qdrant_url',
      'Qdrant code index is local-only: use loopback HTTP or an explicitly allowlisted local bridge host',
    ));
  }
  return ok(url.origin);
};

const candidateFromPayload = (point: Record<string, unknown>, workspaceId: WorkspaceId): Result<CodeCandidate, DomainError> => {
  const payload = object(point.payload);
  if (payload === undefined) return err(domainError('INVALID_EXTERNAL_RESPONSE', 'payload', 'Qdrant point payload must be an object'));
  const id = stringField(payload, 'candidate_id');
  const repoPath = stringField(payload, 'repo_path');
  const digest = stringField(payload, 'source_digest');
  const text = stringField(payload, 'text');
  const claimedWorkspace = stringField(payload, 'workspace_id');
  const startLine = integerField(payload, 'start_line');
  const endLine = integerField(payload, 'end_line');
  const generation = integerField(payload, 'generation');
  if (id._tag === 'Err') return id;
  if (repoPath._tag === 'Err') return repoPath;
  if (digest._tag === 'Err') return digest;
  if (text._tag === 'Err') return text;
  if (claimedWorkspace._tag === 'Err') return claimedWorkspace;
  if (claimedWorkspace.value !== workspaceId) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'workspace_id', 'Qdrant payload belongs to another workspace'));
  }
  if (startLine._tag === 'Err') return startLine;
  if (endLine._tag === 'Err') return endLine;
  if (generation._tag === 'Err') return generation;
  const safePath = ingestRepoPath(repoPath.value);
  const safeDigest = makeContentDigest(digest.value);
  if (safePath._tag === 'Err') return safePath;
  if (safeDigest._tag === 'Err') return safeDigest;
  return makeCodeCandidate({
    candidateId: id.value as CodeCandidate['candidateId'],
    workspaceId,
    repoPath: safePath.value,
    range: {
      startLine: startLine.value, endLine: endLine.value,
      ...(typeof payload.start_column === 'number' && Number.isSafeInteger(payload.start_column)
        ? { startColumn: payload.start_column } : {}),
      ...(typeof payload.end_column === 'number' && Number.isSafeInteger(payload.end_column)
        ? { endColumn: payload.end_column } : {}),
    },
    ...(typeof payload.symbol_name === 'string' ? { symbolName: payload.symbol_name } : {}),
    ...(typeof payload.structural_kind === 'string'
      ? { structuralKind: payload.structural_kind as StructuralKind } : {}),
    ...(typeof payload.structural_language === 'string'
      ? { structuralLanguage: payload.structural_language } : {}),
    ...(typeof payload.structural_exported === 'boolean'
      ? { structuralExported: payload.structural_exported } : {}),
    ...(typeof payload.semantic_line === 'number' && Number.isSafeInteger(payload.semantic_line)
      && typeof payload.semantic_byte_column === 'number' && Number.isSafeInteger(payload.semantic_byte_column)
      && typeof payload.semantic_end_line === 'number' && Number.isSafeInteger(payload.semantic_end_line)
      && typeof payload.semantic_end_byte_column === 'number' && Number.isSafeInteger(payload.semantic_end_byte_column)
      ? { semanticAnchor: {
        line: payload.semantic_line,
        byteColumn: payload.semantic_byte_column,
        endLine: payload.semantic_end_line,
        endByteColumn: payload.semantic_end_byte_column,
      } }
      : {}),
    ...(typeof payload.conflict_key === 'string' ? { conflictKey: payload.conflict_key } : {}),
    ...(typeof payload.conflict_value === 'string' ? { conflictValue: payload.conflict_value } : {}),
    text: text.value,
    sourceDigest: safeDigest.value,
    generation: generation.value as CodeCandidate['generation'],
    indexedAtMs: typeof payload.indexed_at_ms === 'number' ? payload.indexed_at_ms : Date.now(),
  });
};

const QDRANT_DENSE_VECTOR = 'dense';
const QDRANT_SPARSE_VECTOR = 'sparse';
export const qdrantLexicalTextForCandidate = (candidate: CodeCandidate): string => [
  candidate.repoPath,
  candidate.symbolName ?? '',
  candidate.structuralKind ?? '',
  candidate.structuralLanguage ?? '',
  candidate.structuralExported === true ? 'exported' : '',
  candidate.text,
].filter((value) => value.length > 0).join('\n');

const qdrantPoint = (point: CodePoint): Readonly<Record<string, unknown>> => {
  const lexicalText = qdrantLexicalTextForCandidate(point.candidate);
  return {
    id: qdrantPointId(point),
    vector: {
      [QDRANT_DENSE_VECTOR]: point.vector,
      ...(point.sparseVector === undefined ? {} : {
        [QDRANT_SPARSE_VECTOR]: {
          indices: point.sparseVector.indices,
          values: point.sparseVector.values,
        },
      }),
    },
    payload: {
      candidate_id: point.candidate.candidateId,
      workspace_id: point.candidate.workspaceId,
      repo_path: point.candidate.repoPath,
      start_line: point.candidate.range.startLine,
      end_line: point.candidate.range.endLine,
      ...(point.candidate.range.startColumn === undefined ? {} : { start_column: point.candidate.range.startColumn }),
      ...(point.candidate.range.endColumn === undefined ? {} : { end_column: point.candidate.range.endColumn }),
      ...(point.candidate.symbolName === undefined ? {} : { symbol_name: point.candidate.symbolName }),
      ...(point.candidate.structuralKind === undefined ? {} : { structural_kind: point.candidate.structuralKind }),
      ...(point.candidate.structuralLanguage === undefined ? {} : { structural_language: point.candidate.structuralLanguage }),
      ...(point.candidate.structuralExported === undefined ? {} : { structural_exported: point.candidate.structuralExported }),
      ...(point.candidate.semanticAnchor === undefined ? {} : {
        semantic_line: point.candidate.semanticAnchor.line,
        semantic_byte_column: point.candidate.semanticAnchor.byteColumn,
        semantic_end_line: point.candidate.semanticAnchor.endLine,
        semantic_end_byte_column: point.candidate.semanticAnchor.endByteColumn,
      }),
      ...(point.candidate.conflictKey === undefined ? {} : { conflict_key: point.candidate.conflictKey }),
      ...(point.candidate.conflictValue === undefined ? {} : { conflict_value: point.candidate.conflictValue }),
      text: point.candidate.text,
      source_digest: point.candidate.sourceDigest,
      generation: point.candidate.generation,
      ...(point.indexKey === undefined ? {} : { index_key: point.indexKey }),
      ...(point.embeddingKey === undefined ? {} : { embedding_key: point.embeddingKey }),
      lexical_text: lexicalText,
      indexed_at_ms: point.candidate.indexedAtMs,
    },
  };
};

const qdrantPointId = (point: CodePoint): string => {
  const hex = createHash('sha256')
    .update([point.candidate.workspaceId, point.indexKey ?? 'unscoped', point.candidate.candidateId].join('\0'))
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export const makeQdrantCodeCandidatePort = (config: QdrantConfig): CodeCandidatePort => ({
  search: (input) => {
    const startedAtMs = Date.now();
    const operation = Effect.catchAll(Effect.gen(function* () {
      const endpoint = validateLocalQdrantBaseUrl(config.baseUrl, config.allowedHosts);
      if (endpoint._tag === 'Err') return endpoint;
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) {
        return err(domainError('INVALID_INPUT', 'limit', 'Qdrant limit must be between 1 and 1000'));
      }
      const strategy = input.strategy ?? (input.queryText?.trim() ? 'hybrid_rrf' : 'dense');
      if ((strategy === 'dense' || strategy === 'hybrid_rrf')
        && (input.vector === undefined || input.vector.length === 0 || !input.vector.every((value) => Number.isFinite(value)))) {
        return err(domainError('INVALID_INPUT', 'query_vector', `${strategy} retrieval requires a finite non-empty dense vector`));
      }
      if ((strategy === 'sparse' || strategy === 'hybrid_rrf')
        && (input.sparseVector === undefined
          || input.sparseVector.indices.length === 0
          || input.sparseVector.indices.length !== input.sparseVector.values.length
          || !input.sparseVector.indices.every((index) => Number.isSafeInteger(index) && index >= 0)
          || !input.sparseVector.values.every((value) => Number.isFinite(value) && value >= 0))) {
        return err(domainError(
          'INVALID_INPUT',
          'sparse_query_vector',
          `${strategy} retrieval requires a valid client-side sparse query vector`,
        ));
      }
      const filter = { must: [
        { key: 'workspace_id', match: { value: input.workspaceId } },
        ...(input.generation === undefined ? [] : [{ key: 'generation', match: { value: input.generation } }]),
        ...(input.indexKey === undefined ? [] : [{ key: 'index_key', match: { value: input.indexKey } }]),
      ] };
      const vector = input.vector;
      const sparseQuery = {
        indices: input.sparseVector?.indices ?? [],
        values: input.sparseVector?.values ?? [],
      };
      const prefetchLimit = input.prefetchLimit
        ?? Math.min(1000, Math.max(input.limit, input.limit * 4));
      const queryBody = strategy === 'dense'
        ? { query: vector, using: QDRANT_DENSE_VECTOR, limit: input.limit, with_payload: true, with_vector: false, filter }
        : strategy === 'sparse'
          ? { query: sparseQuery, using: QDRANT_SPARSE_VECTOR, limit: input.limit, with_payload: true, with_vector: false, filter }
          : {
            prefetch: [
              { query: vector, using: QDRANT_DENSE_VECTOR, limit: prefetchLimit, filter },
              { query: sparseQuery, using: QDRANT_SPARSE_VECTOR, limit: prefetchLimit, filter },
            ],
            query: { rrf: {} },
            limit: input.limit,
            with_payload: true,
            with_vector: false,
          };
      let responseBody: unknown;
      if (config.client !== undefined) {
        const queried = yield* Effect.tryPromise<Result<unknown, DomainError>, DomainError>({
          try: async () => {
            try {
              return ok(await config.client!.query(
                config.collection,
                queryBody as Parameters<QdrantClient['query']>[1],
              ));
            } catch (cause) {
              return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', cause instanceof Error ? cause.message : 'Qdrant SDK query failed'));
            }
          },
          catch: () => domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'Qdrant SDK query failed'),
        });
        if (queried._tag === 'Err') return queried;
        responseBody = queried.value;
      } else {
        const responseResult = yield* config.http.request({
          method: 'POST',
          url: `${endpoint.value}/collections/${encodeURIComponent(config.collection)}/points/query`,
          ...(config.apiKey?.() === undefined ? {} : { headers: { 'api-key': config.apiKey() as string } }),
          body: queryBody,
        });
        if (responseResult._tag === 'Err') return responseResult;
        if (!successful(responseResult.value)) return externalFailure(responseResult.value, 'qdrant');
        responseBody = responseResult.value.body;
      }
      const body = object(responseBody);
      const result = body?.result;
      const points = Array.isArray(result) ? result : object(result)?.points;
      if (!Array.isArray(points)) return err(domainError('INVALID_EXTERNAL_RESPONSE', 'result', 'Qdrant result must be an array'));
      const output: RankedCandidate[] = [];
      for (const raw of points) {
        const point = object(raw);
        if (point === undefined || typeof point.score !== 'number') return err(domainError('INVALID_EXTERNAL_RESPONSE', 'score', 'Qdrant point score is required'));
        const candidate = candidateFromPayload(point, input.workspaceId);
        if (candidate._tag === 'Err') return candidate;
        output.push({ candidate: candidate.value, score: point.score, freshness: 'unknown' as CandidateFreshness, warning: 'Qdrant freshness requires local digest verification' });
      }
      return ok(output);
    }), (failure) => Effect.succeed(err(failure)));
    return Effect.map(operation, (result) => {
      providerTraceEvent(config.trace ?? noopProviderTrace, {
        provider: 'qdrant',
        providerVersion: config.providerVersion ?? 'qdrant/unknown',
        operation: `query_points_${input.strategy ?? (input.queryText?.trim() ? 'hybrid_rrf' : 'dense')}`,
        status: result._tag === 'Ok' ? 'success' : 'failure',
        durationMs: Math.max(0, Date.now() - startedAtMs),
        collection: config.collection,
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        ...(input.generation === undefined ? {} : { generation: input.generation }),
        ...(result._tag === 'Err' ? { errorCode: result.error.code } : {}),
      });
      return result;
    });
  },
  upsert: (points) => {
    const startedAtMs = Date.now();
    const operation = Effect.catchAll(Effect.gen(function* () {
      const endpoint = validateLocalQdrantBaseUrl(config.baseUrl, config.allowedHosts);
      if (endpoint._tag === 'Err') return endpoint;
      if (config.client !== undefined) {
        const written = yield* Effect.tryPromise<Result<void, DomainError>, DomainError>({
          try: async () => {
            try {
              await config.client!.upsert(config.collection, {
                wait: true,
                points: points.map(qdrantPoint),
              } as Parameters<QdrantClient['upsert']>[1]);
              return ok(undefined);
            } catch (cause) {
              return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', cause instanceof Error ? cause.message : 'Qdrant SDK upsert failed'));
            }
          },
          catch: () => domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'Qdrant SDK upsert failed'),
        });
        return written;
      }
      const responseResult = yield* config.http.request({
        method: 'PUT',
        url: `${endpoint.value}/collections/${encodeURIComponent(config.collection)}/points?wait=true`,
        ...(config.apiKey?.() === undefined ? {} : { headers: { 'api-key': config.apiKey() as string } }),
        body: { points: points.map(qdrantPoint) },
      });
      if (responseResult._tag === 'Err') return responseResult;
      return successful(responseResult.value) ? ok(undefined) : externalFailure(responseResult.value, 'qdrant');
    }), (failure) => Effect.succeed(err(failure)));
    return Effect.map(operation, (result) => {
      providerTraceEvent(config.trace ?? noopProviderTrace, {
        provider: 'qdrant',
        providerVersion: config.providerVersion ?? 'qdrant/unknown',
        operation: 'upsert_points',
        status: result._tag === 'Ok' ? 'success' : 'failure',
        durationMs: Math.max(0, Date.now() - startedAtMs),
        collection: config.collection,
        ...(result._tag === 'Err' ? { errorCode: result.error.code } : {}),
      });
      return result;
    });
  },
});

interface VertexConfig {
  readonly endpoint: string;
  readonly http: HttpPort;
  readonly policy: ProjectDataPolicy;
  readonly accessToken: () => string | undefined;
  readonly authorizedPaths?: readonly string[];
}

export const makeVertexDocumentationPort = (config: VertexConfig): DocumentationPort => ({
  search: (input) => Effect.gen(function* () {
    const action = authorizeOutbound({
      workspaceId: input.workspaceId,
      operation: 'documentation_search',
      destination: 'vertex',
      dataClasses: ['project_document'],
      paths: config.authorizedPaths ?? [],
      secretDetected: containsLikelySecret(input.query),
    }, config.policy);
    if (action._tag === 'Err') return action;
    if (action.value.outcome !== 'allowed') return err(domainError('POLICY_DENIED', 'vertex', action.value.reasonCode));
    const token = config.accessToken();
    if (token === undefined || token.trim() === '') return err(domainError('AUTH_REQUIRED', 'vertex', 'Vertex access token is unavailable'));
    const responseResult = yield* config.http.request({ method: 'POST', url: config.endpoint, headers: { authorization: `Bearer ${token}` }, body: { query: input.query, top_k: input.topK } });
    if (responseResult._tag === 'Err') return responseResult;
    const response = responseResult.value;
    if (!successful(response)) return externalFailure(response, 'vertex');
    const body = object(response.body);
    if (!Array.isArray(body?.documents)) return err(domainError('INVALID_EXTERNAL_RESPONSE', 'documents', 'Vertex response documents must be an array'));
    const evidence: RetrievalEvidence[] = [];
    for (const raw of body.documents) {
      const document = object(raw);
      if (document === undefined) return err(domainError('INVALID_EXTERNAL_RESPONSE', 'documents', 'Vertex document must be an object'));
      const citation = stringField(document, 'citation');
      const content = stringField(document, 'content');
      if (citation._tag === 'Err') return citation;
      if (content._tag === 'Err') return content;
      const evidenceId = stringField(document, 'evidence_id');
      if (evidenceId._tag === 'Err') return evidenceId;
      evidence.push({
        evidenceId: evidenceId.value as RetrievalEvidence['evidenceId'],
        source: 'documentation',
        citation: citation.value,
        content: content.value,
        proofClass: 'direct',
        freshness: 'current',
        ...(typeof document.conflict_key === 'string' ? { conflictKey: document.conflict_key } : {}),
        ...(typeof document.conflict_value === 'string' ? { conflictValue: document.conflict_value } : {}),
        ...(typeof document.source_revision === 'string' ? { sourceRevision: document.source_revision } : {}),
        ...(typeof document.source_timestamp_ms === 'number' ? { sourceTimestampMs: document.source_timestamp_ms } : {}),
      });
    }
    return ok(evidence);
  }),
});

interface GraphitiConfig {
  readonly endpoint: string;
  readonly http: HttpPort;
  readonly policy: ProjectDataPolicy;
  readonly workspaceId: WorkspaceId;
  readonly accessToken: () => string | undefined;
}

export const makeGraphitiProjectionPort = (config: GraphitiConfig): GraphProjectionPort => ({
  project: (input) => Effect.gen(function* () {
    const action = authorizeOutbound({
      workspaceId: config.workspaceId,
      operation: 'memory_projection',
      destination: 'other_external',
      dataClasses: ['private_conversation'],
      paths: [],
      secretDetected: containsLikelySecret(JSON.stringify(input.claims)),
    }, config.policy);
    if (action._tag === 'Err') return action;
    if (action.value.outcome !== 'allowed') return err(domainError('POLICY_DENIED', 'graphiti', action.value.reasonCode));
    const token = config.accessToken();
    if (token === undefined || token.trim() === '') return err(domainError('AUTH_REQUIRED', 'graphiti', 'Graphiti access token is unavailable'));
    const responseResult = yield* config.http.request({ method: 'POST', url: `${config.endpoint.replace(/\/$/u, '')}/episodes/${encodeURIComponent(input.episodeId)}/project`, headers: { authorization: `Bearer ${token}` }, body: { extractor_version: input.extractorVersion, claims: input.claims } });
    if (responseResult._tag === 'Err') return responseResult;
    const response = responseResult.value;
    if (!successful(response)) return externalFailure(response, 'graphiti');
    return ok({ key: projectionKey(input.episodeId, input.extractorVersion), episodeId: input.episodeId, extractorVersion: input.extractorVersion, status: 'projected', attempts: 1 } satisfies ProjectionReceipt);
  }),
  purge: (episodeId) => Effect.gen(function* () {
    const action = authorizeOutbound({ workspaceId: config.workspaceId, operation: 'memory_purge', destination: 'other_external', dataClasses: ['private_conversation'], paths: [], secretDetected: false }, config.policy);
    if (action._tag === 'Err') return action;
    if (action.value.outcome !== 'allowed') return err(domainError('POLICY_DENIED', 'graphiti', action.value.reasonCode));
    const token = config.accessToken();
    if (token === undefined || token.trim() === '') return err(domainError('AUTH_REQUIRED', 'graphiti', 'Graphiti access token is unavailable'));
    const responseResult = yield* config.http.request({ method: 'DELETE', url: `${config.endpoint.replace(/\/$/u, '')}/episodes/${encodeURIComponent(episodeId)}`, headers: { authorization: `Bearer ${token}` } });
    if (responseResult._tag === 'Err') return responseResult;
    return successful(responseResult.value) ? ok(undefined) : externalFailure(responseResult.value, 'graphiti');
  }),
});
