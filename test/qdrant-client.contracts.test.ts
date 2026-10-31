import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { makeQdrantCodeCandidatePort } from '../src/adapters/http-provider-boundaries.js';
import { makeQdrantSdkTestPort } from './helpers/qdrant-sdk-test-double.js';
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
import type { Result } from '../src/domain/result.js';

const mustOk = <Value, Error>(value: Result<Value, Error>): Value => {
  assert.equal(value._tag, 'Ok');
  return value.value;
};
const sdk = (client: QdrantClient, baseUrl = 'http://127.0.0.1:6333') =>
  makeQdrantSdkTestPort(client, baseUrl);
const makeCandidatePort = (client: QdrantClient, collection: string) =>
  makeQdrantCodeCandidatePort({ collection, sdk: sdk(client) });
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

  const port = makeCandidatePort(client, 'ace-sdk');
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

test('Qdrant SDK adapters reject raw REST envelopes and legacy array responses', async () => {
  for (const response of [{ result: { points: [] } }, []]) {
    const client = { query: async () => response } as unknown as QdrantClient;
    const port = makeCandidatePort(client, 'ace-sdk-shape');
    const searched = await Effect.runPromise(port.search({
      workspaceId,
      vector: [0.1, 0.2],
      strategy: 'dense',
      limit: 1,
    }));
    assert.equal(searched._tag, 'Err');
    if (searched._tag === 'Err') assert.equal(searched.error.code, 'INVALID_EXTERNAL_RESPONSE');
  }

  const client = {
    getCollection: async () => ({
      result: { config: { params: { vectors: { dense: { size: 384, distance: 'Cosine' } } } } },
    }),
  } as unknown as QdrantClient;
  const collection = await Effect.runPromise(ensureQdrantCollection(
    'ace-sdk-shape', 384, sdk(client), 'dense',
  ));
  assert.equal(collection._tag, 'Err');
  if (collection._tag === 'Err') assert.equal(collection.error.code, 'INVALID_EXTERNAL_RESPONSE');
});

test('Qdrant SDK query rejects non-finite ranking scores', async () => {
  for (const score of [NaN, Infinity, -Infinity]) {
    const client = {
      query: async () => ({
        points: [{
          score,
          payload: {
            candidate_id: candidate.candidateId,
            workspace_id: workspaceId,
            repo_path: candidate.repoPath,
            start_line: 1,
            end_line: 1,
            text,
            source_digest: candidate.sourceDigest,
            generation: 1,
          },
        }],
      }),
    } as unknown as QdrantClient;
    const port = makeCandidatePort(client, 'ace-sdk-invalid-scores');
    const searched = await Effect.runPromise(port.search({
      workspaceId, vector: [0.1, 0.2], strategy: 'dense', limit: 1,
    }));
    assert.equal(searched._tag, 'Err', 'non-finite scores must never enter ranking');
    if (searched._tag === 'Err') assert.equal(searched.error.code, 'INVALID_EXTERNAL_RESPONSE');
  }
});

test('Qdrant SDK collection creation verifies the published schema before returning ready', async () => {
  let reads = 0;
  const client = {
    getCollection: async () => {
      reads += 1;
      if (reads === 1) throw new Error('Unexpected Response: 404 (Not Found)');
      return { config: { params: { vectors: { dense: { size: 256, distance: 'Cosine' } } } } };
    },
    createCollection: async () => true,
  } as unknown as QdrantClient;
  const result = await Effect.runPromise(ensureQdrantCollection(
    'ace-sdk-schema-race', 384, sdk(client), 'dense',
  ));
  assert.equal(result._tag, 'Err', 'creation acknowledgement is not collection schema verification');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_EXTERNAL_RESPONSE');
  assert.ok(reads >= 2, 'collection metadata must be re-read after creation');
});

test('Qdrant SDK mutations require completed operation status', async () => {
  const client = {
    upsert: async () => ({ status: 'acknowledged' }),
    delete: async () => ({ status: 'acknowledged' }),
  } as unknown as QdrantClient;
  const port = makeCandidatePort(client, 'ace-sdk-status');

  const upserted = await Effect.runPromise(port.upsert([{
    candidate,
    vector: [0.1, 0.2],
    indexKey: 'index-key',
  }]));
  assert.equal(upserted._tag, 'Err', 'wait=true upsert must not accept acknowledged-only status');

  assert.ok(port.deleteWorkspaceVersions !== undefined);
  const deleted = await Effect.runPromise(port.deleteWorkspaceVersions!({
    workspaceId,
    exceptIndexKey: 'index-key',
  }));
  assert.equal(deleted._tag, 'Err', 'wait=true delete must not accept acknowledged-only status');
});

test('Qdrant SDK lifecycle rejects false mutation results', async () => {
  const createClient = {
    getCollection: async () => { throw new Error('Unexpected Response: 404 (Not Found)'); },
    createCollection: async () => false,
  } as unknown as QdrantClient;
  const created = await Effect.runPromise(ensureQdrantCollection(
    'ace-false-create', 384, sdk(createClient), 'dense',
  ));
  assert.equal(created._tag, 'Err', 'false createCollection result must not be accepted as success');

  const aliasClient = {
    getAliases: async () => ({ aliases: [] }),
    updateCollectionAliases: async () => false,
  } as unknown as QdrantClient;
  const switched = await Effect.runPromise(switchQdrantAlias(
    'ace-current', 'ace-target', sdk(aliasClient),
  ));
  assert.equal(switched._tag, 'Err', 'false alias update result must not be accepted as success');
});

test('Qdrant collection bootstrap does not hide non-conflict creation failures', async () => {
  let collectionReads = 0;
  const client = {
    getCollection: async () => {
      collectionReads += 1;
      if (collectionReads === 1) throw new Error('Unexpected Response: 404 (Not Found)');
      return { config: { params: { vectors: { dense: { size: 384, distance: 'Cosine' } } } } };
    },
    createCollection: async () => { throw new Error('Unexpected Response: 403 (Forbidden)'); },
  } as unknown as QdrantClient;
  const result = await Effect.runPromise(ensureQdrantCollection(
    'ace-denied-create', 384, sdk(client), 'dense',
  ));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'EXTERNAL_UNAVAILABLE');
  assert.equal(collectionReads, 1, 'non-conflict create failure must not be converted to read-back success');
});


test('Qdrant bootstrap does not mistake 409 in a 403 SDK error body for a create conflict', async () => {
  let collectionReads = 0;
  const client = {
    getCollection: async () => {
      collectionReads += 1;
      if (collectionReads === 1) throw new Error('Unexpected Response: 404 (Not Found)');
      return { config: { params: { vectors: { dense: { size: 384, distance: 'Cosine' } } } } };
    },
    createCollection: async () => {
      throw new Error('Unexpected Response: 403 (Forbidden)\\nRaw response content:\\n{"request_id":"409"}');
    },
  } as unknown as QdrantClient;
  const result = await Effect.runPromise(ensureQdrantCollection(
    'ace-denied-with-409-in-body', 384, sdk(client), 'dense',
  ));
  assert.equal(result._tag, 'Err', 'HTTP 403 must not be converted to collection readiness');
  assert.equal(collectionReads, 1, 'non-conflict errors must never perform schema read-back');
});

test('Qdrant bootstrap does not attempt creation for a 500 SDK response mentioning 404', async () => {
  let creations = 0;
  const client = {
    getCollection: async () => {
      throw new Error('Unexpected Response: 500 (Internal Server Error)\\nRaw response content:\\n{"reference":"404"}');
    },
    createCollection: async () => { creations += 1; return true; },
  } as unknown as QdrantClient;
  const result = await Effect.runPromise(ensureQdrantCollection(
    'ace-500-with-404-in-body', 384, sdk(client), 'dense',
  ));
  assert.equal(result._tag, 'Err');
  assert.equal(creations, 0, 'a non-404 lookup failure must not create a collection');
});

test('stable Qdrant mutation deletes only the changed workspace path through the SDK', async () => {
  const deletes: unknown[] = [];
  const client = {
    delete: async (_collection: string, request: unknown) => { deletes.push(request); return { status: 'completed' }; },
  } as unknown as QdrantClient;
  const port = makeCandidatePort(client, 'ace-stable');
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

  const fenced = await Effect.runPromise(port.deleteWorkspaceVersions!({
    workspaceId,
    exceptIndexKey: 'current-index',
    beforeGeneration: 7,
  }));
  assert.equal(fenced._tag, 'Ok');
  assert.deepEqual((deletes[2] as { filter?: unknown }).filter, {
    must: [
      { key: 'workspace_id', match: { value: workspaceId } },
      { key: 'generation', range: { lt: 7 } },
    ],
    must_not: [{ key: 'index_key', match: { value: 'current-index' } }],
  });
});

test('Qdrant SDK lifecycle accepts direct collection and alias shapes with dense-only schema', async () => {
  const actions: unknown[] = [];
  const collections = new Set<string>();
  const client = {
    getCollections: async () => ({ collections: [] }),
    getCollection: async (name: string) => {
      if (!collections.has(name)) throw new Error('Unexpected Response: 404 (Not Found)');
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

  assert.equal((await Effect.runPromise(probeQdrantService(sdk(client))))._tag, 'Ok');
  assert.equal((await Effect.runPromise(ensureQdrantCollection(
    'new', 384, sdk(client), 'dense',
  )))._tag, 'Ok');
  const alias = await Effect.runPromise(resolveQdrantAlias(
    'ace-current', sdk(client),
  ));
  assert.equal(alias._tag, 'Ok');
  if (alias._tag === 'Ok') assert.equal(alias.value, 'old');
  assert.equal((await Effect.runPromise(switchQdrantAlias(
    'ace-current', 'new', sdk(client),
  )))._tag, 'Ok');

  const create = actions[0] as [string, string, { sparse_vectors?: unknown }];
  assert.equal(create[2].sparse_vectors, undefined);
});


test('snapshot verification and vector reuse stay on the authenticated Qdrant SDK path', async () => {
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
  const exact = await Effect.runPromise(hasExactQdrantSnapshot(
    sdk(client), 'ace-sdk', workspaceId, 'index-key', 1,
  ));
  assert.equal(exact._tag, 'Ok');
  if (exact._tag === 'Ok') assert.equal(exact.value, true);

  const membership = await Effect.runPromise(verifyQdrantSnapshotMembership(
    sdk(client), 'ace-sdk', workspaceId, 'index-key', [candidate.candidateId],
  ));
  assert.equal(membership._tag, 'Ok');
  if (membership._tag === 'Ok') assert.equal(membership.value, true);

  const vectors = await Effect.runPromise(readQdrantSnapshotVectors(
    sdk(client), 'ace-sdk', workspaceId,
  ));
  assert.equal(vectors._tag, 'Ok');
  if (vectors._tag === 'Ok') assert.deepEqual(vectors.value.get('content-key'), [0.1, 0.2]);

  assert.ok(scrollRequests.some((request) =>
    Array.isArray((request as { with_payload?: unknown }).with_payload)
    && (request as { with_payload: string[] }).with_payload.includes('embedding_key')));
});
