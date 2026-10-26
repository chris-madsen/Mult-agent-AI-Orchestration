import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { makeQdrantCodeCandidatePort } from '../src/adapters/http-provider-boundaries.js';
import {
  ensureQdrantCollection,
  hasExactQdrantSnapshot,
  probeQdrantService,
  readQdrantSnapshotVectors,
  resolveQdrantAlias,
  switchQdrantAlias,
  verifyQdrantSnapshotMembership,
} from '../src/adapters/qdrant-context-provider.js';
import { makeCandidateId, makeCodeCandidate } from '../src/domain/retrieval.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok, type Result } from '../src/domain/result.js';

const mustOk = <Value, Error>(value: Result<Value, Error>): Value => {
  assert.equal(value._tag, 'Ok');
  return value.value;
};
const workspaceId = mustOk(makeWorkspaceId('qdrant-sdk-contract'));
const text = 'export function save(value: string) { return value; }';
const candidate = mustOk(makeCodeCandidate({
  candidateId: mustOk(makeCandidateId('qdrant-sdk-save')),
  workspaceId,
  repoPath: 'src/save.ts' as never,
  range: { startLine: 1, endLine: 1, startColumn: 1, endColumn: text.length + 1 },
  symbolName: 'save',
  structuralKind: 'function',
  structuralLanguage: 'typescript',
  text,
  sourceDigest: createHash('sha256').update(text).digest('hex') as never,
  generation: 1 as never,
  indexedAtMs: 1,
}));

test('Qdrant SDK query accepts the facade direct points response', async () => {
  let queryRequest: unknown;
  let upsertRequest: unknown;
  const client = {
    query: async (_collection: string, request: unknown) => {
      queryRequest = request;
      return {
        points: [{
          score: 0.9,
          payload: {
            candidate_id: candidate.candidateId,
            workspace_id: workspaceId,
            repo_path: candidate.repoPath,
            start_line: 1,
            end_line: 1,
            start_column: 1,
            end_column: text.length + 1,
            symbol_name: 'save',
            structural_kind: 'function',
            structural_language: 'typescript',
            text,
            source_digest: candidate.sourceDigest,
            generation: 1,
            indexed_at_ms: 1,
          },
        }],
      };
    },
    upsert: async (_collection: string, request: unknown) => {
      upsertRequest = request;
      return { status: 'completed' };
    },
  } as unknown as QdrantClient;

  const port = makeQdrantCodeCandidatePort({
    baseUrl: 'http://127.0.0.1:6333',
    collection: 'ace-sdk',
    http: { request: () => Effect.succeed(ok({ status: 500, body: {} })) },
    client,
  });
  const searched = await Effect.runPromise(port.search({
    workspaceId,
    vector: [0.1, 0.2],
    strategy: 'dense',
    limit: 2,
  }));
  assert.equal(searched._tag, 'Ok');
  if (searched._tag === 'Ok') assert.equal(searched.value[0]?.candidate.symbolName, 'save');
  assert.equal((queryRequest as { using?: unknown }).using, 'dense');

  assert.equal((await Effect.runPromise(port.upsert([{
    candidate,
    vector: [0.1, 0.2],
    indexKey: 'index-key',
  }])))._tag, 'Ok');
  assert.ok(Array.isArray((upsertRequest as { points?: unknown[] }).points));
  const firstPointId = ((upsertRequest as { points?: Array<{ id?: unknown }> }).points ?? [])[0]?.id;
  assert.equal(typeof firstPointId, 'string');

  assert.equal((await Effect.runPromise(port.upsert([{
    candidate,
    vector: [0.1, 0.2],
    indexKey: 'different-global-index-key',
  }])))._tag, 'Ok');
  const secondPointId = ((upsertRequest as { points?: Array<{ id?: unknown }> }).points ?? [])[0]?.id;
  assert.equal(secondPointId, firstPointId,
    'stable point identity must follow source candidate identity, not the global publication key');
});

test('stable Qdrant mutation deletes only the changed workspace path through the SDK', async () => {
  const deletes: unknown[] = [];
  const client = {
    delete: async (_collection: string, request: unknown) => { deletes.push(request); return { status: 'completed' }; },
  } as unknown as QdrantClient;
  const port = makeQdrantCodeCandidatePort({
    baseUrl: 'http://127.0.0.1:6333',
    collection: 'ace-stable',
    http: { request: () => Effect.succeed(ok({ status: 500, body: {} })) },
    client,
  });
  assert.ok(port.deletePaths !== undefined);
  const deleted = await Effect.runPromise(port.deletePaths!({
    workspaceId,
    repoPaths: ['src/save.ts' as never],
    exceptIndexKey: 'current-index',
  }));
  assert.equal(deleted._tag, 'Ok');
  assert.deepEqual((deletes[0] as { wait?: unknown }).wait, true);
  assert.deepEqual((deletes[0] as { filter?: unknown }).filter, {
    must: [
      { key: 'workspace_id', match: { value: workspaceId } },
      { key: 'repo_path', match: { value: 'src/save.ts' } },
    ],
    must_not: [{ key: 'index_key', match: { value: 'current-index' } }],
  });

  assert.ok(port.deleteWorkspaceVersions !== undefined);
  const cleaned = await Effect.runPromise(port.deleteWorkspaceVersions!({
    workspaceId,
    exceptIndexKey: 'current-index',
  }));
  assert.equal(cleaned._tag, 'Ok');
  assert.deepEqual((deletes[1] as { filter?: unknown }).filter, {
    must: [{ key: 'workspace_id', match: { value: workspaceId } }],
    must_not: [{ key: 'index_key', match: { value: 'current-index' } }],
  });
});

test('Qdrant SDK lifecycle accepts direct collection and alias shapes with dense-only schema', async () => {
  const actions: unknown[] = [];
  const collections = new Set<string>();
  const client = {
    getCollections: async () => ({ collections: [] }),
    getCollection: async (name: string) => {
      if (!collections.has(name)) throw new Error('404 Not Found');
      return { config: { params: { vectors: { dense: { size: 384, distance: 'Cosine' } } } } };
    },
    createCollection: async (name: string, input: unknown) => {
      collections.add(name);
      actions.push(['create', name, input]);
      return true;
    },
    getAliases: async () => ({ aliases: [{ alias_name: 'ace-current', collection_name: 'old' }] }),
    updateCollectionAliases: async (input: unknown) => { actions.push(input); return true; },
  } as unknown as QdrantClient;
  const http = { request: () => Effect.succeed(ok({ status: 500, body: {} })) };

  assert.equal((await Effect.runPromise(probeQdrantService(
    http, 'http://127.0.0.1:6333', [], client,
  )))._tag, 'Ok');
  assert.equal((await Effect.runPromise(ensureQdrantCollection(
    http, 'http://127.0.0.1:6333', 'new', 384, [], undefined, client, 'dense',
  )))._tag, 'Ok');
  const alias = await Effect.runPromise(resolveQdrantAlias(
    http, 'http://127.0.0.1:6333', 'ace-current', [], client,
  ));
  assert.equal(alias._tag, 'Ok');
  if (alias._tag === 'Ok') assert.equal(alias.value, 'old');
  assert.equal((await Effect.runPromise(switchQdrantAlias(
    http, 'http://127.0.0.1:6333', 'ace-current', 'new', [], client,
  )))._tag, 'Ok');

  const create = actions[0] as [string, string, { sparse_vectors?: unknown }];
  assert.equal(create[2].sparse_vectors, undefined);
});


test('snapshot verification and vector reuse stay on the authenticated Qdrant SDK path', async () => {
  const httpCalls: unknown[] = [];
  const scrollRequests: unknown[] = [];
  const client = {
    count: async (_collection: string, request: unknown) => {
      assert.equal((request as { exact?: unknown }).exact, true);
      return { count: 1 };
    },
    scroll: async (_collection: string, request: unknown) => {
      scrollRequests.push(request);
      const withVector = (request as { with_vector?: unknown }).with_vector === true;
      return {
        points: [{
          id: 'point-1',
          payload: {
            candidate_id: candidate.candidateId,
            embedding_key: 'content-key',
          },
          ...(withVector ? { vector: { dense: [0.1, 0.2] } } : {}),
        }],
        next_page_offset: null,
      };
    },
  } as unknown as QdrantClient;
  const http = {
    request: (request: unknown) => {
      httpCalls.push(request);
      return Effect.succeed(ok({ status: 500, body: {} }));
    },
  };

  const exact = await Effect.runPromise(hasExactQdrantSnapshot(
    http, 'http://127.0.0.1:6333', 'ace-sdk', workspaceId, 'index-key', 1, [], client,
  ));
  assert.equal(exact._tag, 'Ok');
  if (exact._tag === 'Ok') assert.equal(exact.value, true);

  const membership = await Effect.runPromise(verifyQdrantSnapshotMembership(
    http, 'http://127.0.0.1:6333', 'ace-sdk', workspaceId, 'index-key', [candidate.candidateId], [], client,
  ));
  assert.equal(membership._tag, 'Ok');
  if (membership._tag === 'Ok') assert.equal(membership.value, true);

  const vectors = await Effect.runPromise(readQdrantSnapshotVectors(
    http, 'http://127.0.0.1:6333', 'ace-sdk', workspaceId, undefined, [], client,
  ));
  assert.equal(vectors._tag, 'Ok');
  if (vectors._tag === 'Ok') assert.deepEqual(vectors.value.get('content-key'), [0.1, 0.2]);

  assert.equal(httpCalls.length, 0);
  assert.ok(scrollRequests.some((request) =>
    Array.isArray((request as { with_payload?: unknown }).with_payload)
    && (request as { with_payload: string[] }).with_payload.includes('embedding_key')));
});
