import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { makeQdrantCodeCandidatePort } from '../src/adapters/http-provider-boundaries.js';
import {
  ensureQdrantCollection,
  probeQdrantService,
  resolveQdrantAlias,
  switchQdrantAlias,
} from '../src/adapters/qdrant-context-provider.js';
import { makeCandidateId, makeCodeCandidate } from '../src/domain/retrieval.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok, type Result } from '../src/domain/result.js';

const mustOk = <T, E>(value: Result<T, E>): T => {
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

test('official Qdrant SDK path preserves dense query and payload mapping', async () => {
  let queryRequest: unknown;
  let upsertRequest: unknown;
  const client = {
    query: async (_collection: string, request: unknown) => {
      queryRequest = request;
      return {
        result: [{
          score: 0.9,
          payload: {
            candidate_id: candidate.candidateId,
            workspace_id: workspaceId,
            repo_path: candidate.repoPath,
            start_line: 1,
            end_line: 1,
            start_column: 1,
            end_column: text.length + 1,
            symbol_name: candidate.symbolName,
            structural_kind: candidate.structuralKind,
            structural_language: candidate.structuralLanguage,
            text: candidate.text,
            source_digest: candidate.sourceDigest,
            generation: candidate.generation,
            indexed_at_ms: candidate.indexedAtMs,
          },
        }],
      };
    },
    upsert: async (_collection: string, request: unknown) => {
      upsertRequest = request;
      return { result: true };
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
  assert.deepEqual(queryRequest, {
    query: [0.1, 0.2],
    using: 'dense',
    limit: 2,
    with_payload: true,
    with_vector: false,
    filter: { must: [{ key: 'workspace_id', match: { value: workspaceId } }] },
  });
  const upserted = await Effect.runPromise(port.upsert([{
    candidate,
    vector: [0.1, 0.2],
    indexKey: 'index-key',
  }]));
  assert.equal(upserted._tag, 'Ok');
  assert.equal(Array.isArray((upsertRequest as { points?: unknown[] }).points), true);
});

test('official Qdrant SDK path owns probe, collection bootstrap and atomic alias switch', async () => {
  const actions: unknown[] = [];
  const collections = new Set<string>();
  const aliases = [{ alias_name: 'ace-current', collection_name: 'old-collection' }];
  const client = {
    getCollections: async () => ({ result: { collections: [] } }),
    getCollection: async (name: string) => {
      if (!collections.has(name)) throw new Error('404 Not Found');
      return { result: { config: { params: {
        vectors: { dense: { size: 384, distance: 'Cosine' } },
        sparse_vectors: { sparse: { modifier: 'idf' } },
      } } } };
    },
    createCollection: async (name: string) => { collections.add(name); actions.push(['create_collection', name]); return true; },
    getAliases: async () => ({ result: { aliases } }),
    updateCollectionAliases: async (input: unknown) => { actions.push(input); return true; },
  } as unknown as QdrantClient;
  const http = { request: () => Effect.succeed(ok({ status: 500, body: {} })) };
  assert.equal((await Effect.runPromise(probeQdrantService(http, 'http://127.0.0.1:6333', [], client)))._tag, 'Ok');
  assert.equal((await Effect.runPromise(ensureQdrantCollection(http, 'http://127.0.0.1:6333', 'new-collection', 384, [], undefined, client)))._tag, 'Ok');
  const resolved = await Effect.runPromise(resolveQdrantAlias(http, 'http://127.0.0.1:6333', 'ace-current', [], client));
  assert.equal(resolved._tag, 'Ok');
  if (resolved._tag === 'Ok') assert.equal(resolved.value, 'old-collection');
  assert.equal((await Effect.runPromise(switchQdrantAlias(http, 'http://127.0.0.1:6333', 'ace-current', 'new-collection', [], client)))._tag, 'Ok');
  assert.deepEqual(actions[0], ['create_collection', 'new-collection']);
  assert.deepEqual(actions[1], { actions: [
    { delete_alias: { alias_name: 'ace-current' } },
    { create_alias: { collection_name: 'new-collection', alias_name: 'ace-current' } },
  ] });
});
