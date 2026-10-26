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
