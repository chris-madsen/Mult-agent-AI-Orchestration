import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { makeQdrantCodeCandidatePort } from '../src/adapters/http-provider-boundaries.js';
import { makeCandidateId, makeCodeCandidate } from '../src/domain/retrieval.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok, type Result } from '../src/domain/result.js';
import type { HttpPort } from '../src/application/ports.js';

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

test('Qdrant upsert stores dense vector plus language-neutral BM25 document on the same point', async () => {
  const requests: Array<{ readonly method: string; readonly body?: Readonly<Record<string, unknown>> }> = [];
  const http: HttpPort = {
    request: (request) => {
      requests.push({ method: request.method, ...(request.body === undefined ? {} : { body: request.body }) });
      return Effect.succeed(ok({ status: 200, body: { result: true } }));
    },
  };
  const qdrant = makeQdrantCodeCandidatePort({
    baseUrl: 'http://127.0.0.1:6333',
    collection: 'ace-hybrid',
    http,
  });
  const result = await Effect.runPromise(qdrant.upsert([{
    candidate,
    vector: [0.1, 0.2, 0.3],
    indexKey: 'index-key',
    embeddingKey: 'embedding-key',
  }]));
  assert.equal(result._tag, 'Ok');
  const points = requests[0]?.body?.points;
  assert.ok(Array.isArray(points));
  const point = points[0] as { vector?: Record<string, unknown>; payload?: Record<string, unknown> };
  assert.deepEqual(point.vector?.dense, [0.1, 0.2, 0.3]);
  assert.deepEqual(point.vector?.sparse, {
    text: 'src/auth/verify-jwt.ts\nverifyJwtToken\nfunction\ntypescript\nexported\n' + text,
    model: 'qdrant/bm25',
    options: {
      stemmer: { type: 'none' },
      stopwords: {},
      tokenizer: 'multilingual',
      ascii_folding: true,
    },
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
  const http: HttpPort = {
    request: (request) => {
      requestBody = request.body;
      return Effect.succeed(ok({
        status: 200,
        body: {
          result: {
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
          },
        },
      }));
    },
  };
  const qdrant = makeQdrantCodeCandidatePort({
    baseUrl: 'http://127.0.0.1:6333',
    collection: 'ace-hybrid-current',
    http,
  });
  const result = await Effect.runPromise(qdrant.search({
    workspaceId,
    vector: [0.2, 0.8],
    queryText: 'где проверяется JWT token',
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
    text: 'где проверяется JWT token',
    model: 'qdrant/bm25',
    options: {
      stemmer: { type: 'none' },
      stopwords: {},
      tokenizer: 'multilingual',
      ascii_folding: true,
    },
  });
  assert.deepEqual(requestBody?.query, { rrf: {} });
  assert.equal(requestBody?.limit, 6);
});


test('Qdrant search can issue a sparse-only BM25 query for ablation', async () => {
  let requestBody: Readonly<Record<string, unknown>> | undefined;
  const http: HttpPort = {
    request: (request) => {
      requestBody = request.body;
      return Effect.succeed(ok({ status: 200, body: { result: { points: [] } } }));
    },
  };
  const qdrant = makeQdrantCodeCandidatePort({
    baseUrl: 'http://127.0.0.1:6333',
    collection: 'ace-hybrid-current',
    http,
  });
  const result = await Effect.runPromise(qdrant.search({
    workspaceId,
    vector: [0.2, 0.8],
    queryText: 'ACE_QDRANT_URL',
    mode: 'sparse',
    limit: 4,
  }));
  assert.equal(result._tag, 'Ok');
  assert.deepEqual(requestBody, {
    query: {
      text: 'ACE_QDRANT_URL',
      model: 'qdrant/bm25',
      options: {
        stemmer: { type: 'none' },
        stopwords: {},
        tokenizer: 'multilingual',
        ascii_folding: true,
      },
    },
    using: 'sparse',
    limit: 4,
    with_payload: true,
    with_vector: false,
    filter: { must: [{ key: 'workspace_id', match: { value: workspaceId } }] },
  });
});

test('sparse and hybrid ablation modes reject missing query text before network I/O', async () => {
  let calls = 0;
  const http: HttpPort = {
    request: () => {
      calls += 1;
      return Effect.succeed(ok({ status: 200, body: { result: { points: [] } } }));
    },
  };
  const qdrant = makeQdrantCodeCandidatePort({
    baseUrl: 'http://127.0.0.1:6333',
    collection: 'ace-hybrid-current',
    http,
  });
  for (const mode of ['sparse', 'hybrid'] as const) {
    const result = await Effect.runPromise(qdrant.search({
      workspaceId,
      vector: [0.2, 0.8],
      mode,
      limit: 4,
    }));
    assert.equal(result._tag, 'Err');
    if (result._tag === 'Err') assert.equal(result.error.path, 'query_text');
  }
  assert.equal(calls, 0);
});

test('Qdrant search can still issue a named dense-only query for explicit ablation paths', async () => {
  let requestBody: Readonly<Record<string, unknown>> | undefined;
  const http: HttpPort = {
    request: (request) => {
      requestBody = request.body;
      return Effect.succeed(ok({ status: 200, body: { result: { points: [] } } }));
    },
  };
  const qdrant = makeQdrantCodeCandidatePort({
    baseUrl: 'http://127.0.0.1:6333',
    collection: 'ace-hybrid-current',
    http,
  });
  const result = await Effect.runPromise(qdrant.search({
    workspaceId,
    vector: [0.2, 0.8],
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
