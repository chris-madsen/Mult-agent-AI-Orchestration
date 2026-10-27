import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { makeQdrantCodeCandidatePort } from '../src/adapters/http-provider-boundaries.js';
import { makeCandidateId, makeCodeCandidate } from '../src/domain/retrieval.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import type { Result } from '../src/domain/result.js';
import type { QdrantClient } from '@qdrant/js-client-rest';

const mustOk = <T, E>(value: Result<T, E>): T => {
  assert.equal(value._tag, 'Ok');
  if (value._tag === 'Err') throw new Error(String(value.error));
  return value.value;
};

const workspaceId = mustOk(makeWorkspaceId('hybrid-qdrant-contract'));
const text = 'export function verifyJwtToken(token: string): boolean { return token.length > 0; }';
const digest = createHash('sha256').update(text).digest('hex');
const candidate = mustOk(makeCodeCandidate({
  candidateId: mustOk(makeCandidateId('verify-jwt-token')),
  workspaceId,
  repoPath: 'src/auth/verify-jwt.ts' as never,
  range: { startLine: 1, endLine: 1, startColumn: 1, endColumn: text.length + 1 },
  symbolName: 'verifyJwtToken',
  structuralKind: 'function',
  structuralLanguage: 'typescript',
  structuralExported: true,
  text,
  sourceDigest: digest as never,
  generation: 7 as never,
  indexedAtMs: 123,
}));

const makeClient = (handlers: {
  readonly query?: (request: unknown) => unknown;
  readonly upsert?: (request: unknown) => void;
}): QdrantClient => ({
  query: async (_collection, request) => handlers.query?.(request) ?? { points: [] },
  upsert: async (_collection, request) => {
    handlers.upsert?.(request);
    return { status: 'completed' };
  },
} as unknown as QdrantClient);

test('Qdrant upsert stores dense vector plus language-neutral BM25 document on the same point', async () => {
  let upsertRequest: unknown;
  const qdrant = makeQdrantCodeCandidatePort({
    collection: 'ace-hybrid',
    client: makeClient({ upsert: (request) => { upsertRequest = request; } }),
  });
  const result = await Effect.runPromise(qdrant.upsert([{
    candidate,
    vector: [0.1, 0.2, 0.3],
    sparseVector: { indices: [3, 17, 42], values: [1.2, 0.8, 2.1] },
    indexKey: 'index-key',
    embeddingKey: 'embedding-key',
  }]));
  assert.equal(result._tag, 'Ok');
  const points = (upsertRequest as { points?: unknown[] } | undefined)?.points;
  assert.ok(Array.isArray(points));
  const point = points[0] as { vector?: Record<string, unknown>; payload?: Record<string, unknown> };
  assert.deepEqual(point.vector?.dense, [0.1, 0.2, 0.3]);
  assert.deepEqual(point.vector?.sparse, {
    indices: [3, 17, 42],
    values: [1.2, 0.8, 2.1],
  });
  assert.equal(point.payload?.structural_kind, 'function');
  assert.equal(point.payload?.structural_language, 'typescript');
  assert.equal(point.payload?.structural_exported, true);
  assert.equal(
    point.payload?.lexical_text,
    'src/auth/verify-jwt.ts\nverifyJwtToken\nfunction\ntypescript\nexported\n' + text,
  );
});

test('Qdrant search uses dense and BM25 prefetch branches with root RRF fusion', async () => {
  let requestBody: Readonly<Record<string, unknown>> | undefined;
  const client = makeClient({
    query: (request) => {
      requestBody = request as Readonly<Record<string, unknown>>;
      return {
        points: [{
          score: 0.75,
          payload: {
            candidate_id: candidate.candidateId,
            workspace_id: workspaceId,
            repo_path: candidate.repoPath,
            start_line: candidate.range.startLine,
            end_line: candidate.range.endLine,
            start_column: candidate.range.startColumn,
            end_column: candidate.range.endColumn,
            symbol_name: candidate.symbolName,
            structural_kind: candidate.structuralKind,
            structural_language: candidate.structuralLanguage,
            structural_exported: candidate.structuralExported,
            text: candidate.text,
            source_digest: candidate.sourceDigest,
            generation: candidate.generation,
            index_key: 'index-key',
            indexed_at_ms: candidate.indexedAtMs,
          },
        }],
      };
    },
  });
  const qdrant = makeQdrantCodeCandidatePort({
    collection: 'ace-hybrid-current',
    client,
  });
  const result = await Effect.runPromise(qdrant.search({
    workspaceId,
    vector: [0.2, 0.8],
    sparseVector: { indices: [5, 9], values: [1.5, 0.75] },
    queryText: 'где проверяется JWT token',
    strategy: 'hybrid_rrf',
    limit: 6,
    indexKey: 'index-key',
    requestId: 'hybrid-request',
  }));
  assert.equal(result._tag, 'Ok');
  assert.equal(result._tag === 'Ok' ? result.value[0]?.candidate.candidateId : undefined, candidate.candidateId);
  assert.equal(result._tag === 'Ok' ? result.value[0]?.candidate.structuralKind : undefined, 'function');
  assert.equal(result._tag === 'Ok' ? result.value[0]?.candidate.structuralLanguage : undefined, 'typescript');
  assert.equal(result._tag === 'Ok' ? result.value[0]?.candidate.structuralExported : undefined, true);
  const prefetch = requestBody?.prefetch;
  assert.ok(Array.isArray(prefetch));
  assert.deepEqual((prefetch[0] as { using?: unknown }).using, 'dense');
  assert.deepEqual((prefetch[1] as { using?: unknown }).using, 'sparse');
  assert.deepEqual((prefetch[1] as { query?: unknown }).query, {
    indices: [5, 9],
    values: [1.5, 0.75],
  });
  assert.deepEqual(requestBody?.query, { rrf: {} });
  assert.equal(requestBody?.limit, 6);
});

test('Qdrant search can still issue a named dense-only query for explicit ablation paths', async () => {
  let requestBody: Readonly<Record<string, unknown>> | undefined;
  const qdrant = makeQdrantCodeCandidatePort({
    collection: 'ace-hybrid-current',
    client: makeClient({ query: (request) => { requestBody = request as Readonly<Record<string, unknown>>; return { points: [] }; } }),
  });
  const result = await Effect.runPromise(qdrant.search({
    workspaceId,
    vector: [0.2, 0.8],
    strategy: 'dense',
    limit: 4,
  }));
  assert.equal(result._tag, 'Ok');
  assert.deepEqual(requestBody, {
    query: [0.2, 0.8],
    using: 'dense',
    limit: 4,
    with_payload: true,
    with_vector: false,
    filter: { must: [{ key: 'workspace_id', match: { value: workspaceId } }] },
  });
});

test('Qdrant sparse-only strategy sends BM25 query without a dense vector', async () => {
  let requestBody: Readonly<Record<string, unknown>> | undefined;
  const qdrant = makeQdrantCodeCandidatePort({
    collection: 'ace-hybrid-current',
    client: makeClient({ query: (request) => { requestBody = request as Readonly<Record<string, unknown>>; return { points: [] }; } }),
  });
  const result = await Effect.runPromise(qdrant.search({
    workspaceId,
    queryText: 'ACE_QDRANT_COLLECTION',
    sparseVector: { indices: [11, 23], values: [2.2, 0.9] },
    strategy: 'sparse',
    limit: 5,
  }));
  assert.equal(result._tag, 'Ok');
  assert.deepEqual(requestBody, {
    query: {
      indices: [11, 23],
      values: [2.2, 0.9],
    },
    using: 'sparse',
    limit: 5,
    with_payload: true,
    with_vector: false,
    filter: { must: [{ key: 'workspace_id', match: { value: workspaceId } }] },
  });
});

test('Qdrant explicit strategies fail before HTTP when required query inputs are absent', async () => {
  let requests = 0;
  const qdrant = makeQdrantCodeCandidatePort({
    collection: 'ace-hybrid-current',
    client: makeClient({ query: () => { requests += 1; return { points: [] }; } }),
  });
  const dense = await Effect.runPromise(qdrant.search({
    workspaceId,
    strategy: 'dense',
    limit: 3,
  }));
  const sparse = await Effect.runPromise(qdrant.search({
    workspaceId,
    vector: [0.1, 0.9],
    strategy: 'sparse',
    limit: 3,
  }));
  const hybrid = await Effect.runPromise(qdrant.search({
    workspaceId,
    queryText: 'reconnect',
    strategy: 'hybrid_rrf',
    limit: 3,
  }));
  assert.equal(dense._tag, 'Err');
  assert.equal(sparse._tag, 'Err');
  assert.equal(hybrid._tag, 'Err');
  assert.equal(requests, 0);
});

