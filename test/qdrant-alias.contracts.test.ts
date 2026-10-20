import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
  embeddingContentKey,
  populateQdrantFromStructuralIndex,
  qdrantCollectionName,
  qdrantCurrentAlias,
  resolveQdrantAlias,
  switchQdrantAlias,
} from '../src/adapters/qdrant-context-provider.js';
import { makeCodeCandidate, createCodeIndex } from '../src/domain/retrieval.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok } from '../src/domain/result.js';
import type { CodeCandidatePort, HttpPort, VectorEmbeddingPort } from '../src/application/ports.js';

const workspace = makeWorkspaceId('qdrant-alias-contract')._tag === 'Ok'
  ? makeWorkspaceId('qdrant-alias-contract').value
  : (() => { throw new Error('workspace fixture is invalid'); })();

test('Qdrant alias publication deletes the old target and creates the verified collection atomically', async () => {
  const requests: Array<{ readonly method: string; readonly url: string; readonly body?: unknown }> = [];
  const http: HttpPort = {
    request: (request) => {
      requests.push(request);
      if (request.method === 'GET') return Effect.succeed(ok({ status: 200, body: { result: { aliases: [{ alias_name: 'ace_ws_emb_current', collection_name: 'old' }] } } }));
      return Effect.succeed(ok({ status: 200, body: { result: true } }));
    },
  };
  const result = await Effect.runPromise(switchQdrantAlias(
    http,
    'http://127.0.0.1:6333',
    'ace_ws_emb_current',
    'ace_ws_emb_new-index',
  ));
  assert.equal(result._tag, 'Ok');
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.url, 'http://127.0.0.1:6333/collections/aliases');
  assert.deepEqual(requests[1]?.body, {
    actions: [
      { delete_alias: { alias_name: 'ace_ws_emb_current' } },
      { create_alias: { collection_name: 'ace_ws_emb_new-index', alias_name: 'ace_ws_emb_current' } },
    ],
  });
});

test('Qdrant collection and alias identities are provider/workspace scoped', () => {
  const collection = qdrantCollectionName('workspace', 'a'.repeat(64), 'b'.repeat(64));
  const alias = qdrantCurrentAlias('workspace', 'a'.repeat(64));
  assert.equal(collection, 'ace_workspace_aaaaaaaaaaaaaaaa_bbbbbbbbbbbbbbbb');
  assert.equal(alias, 'ace_workspace_aaaaaaaaaaaaaaaa_current');
});

test('Qdrant alias resolution returns the native current collection without inventing state', async () => {
  const http: HttpPort = {
    request: (request) => {
      assert.equal(request.method, 'GET');
      assert.equal(request.url, 'http://127.0.0.1:6333/aliases');
      return Effect.succeed(ok({
        status: 200,
        body: { result: { aliases: [{ alias_name: 'ace_ws_emb_current', collection_name: 'ace_ws_emb_old' }] } },
      }));
    },
  };
  const resolved = await Effect.runPromise(resolveQdrantAlias(
    http,
    'http://127.0.0.1:6333',
    'ace_ws_emb_current',
  ));
  assert.deepEqual(resolved, { _tag: 'Ok', value: 'ace_ws_emb_old' });
});

test('unchanged content reuses a vector by embedding content identity across source citation changes', async () => {
  const candidateResult = makeCodeCandidate({
    candidateId: 'candidate-1' as never,
    workspaceId: workspace,
    repoPath: 'src/renamed.ts' as never,
    range: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 25 },
    symbolName: 'save',
    text: 'function save() { return 1; }',
    sourceDigest: 'a'.repeat(64) as never,
    generation: 1,
    indexedAtMs: 1,
  });
  assert.equal(candidateResult._tag, 'Ok');
  if (candidateResult._tag === 'Err') return;
  const indexResult = createCodeIndex(1, [candidateResult.value]);
  assert.equal(indexResult._tag, 'Ok');
  if (indexResult._tag === 'Err') return;
  const providerIdentity = 'fastembed/onnx|model=fixture@1|artifact=fixture#digest';
  const key = embeddingContentKey(providerIdentity, candidateResult.value.text);
  let inferenceCalls = 0;
  const embeddings: VectorEmbeddingPort = {
    embedMany: () => {
      inferenceCalls += 1;
      return Effect.succeed(ok([[0.25, 0.75]]));
    },
  };
  const points: unknown[] = [];
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: (input) => {
      points.push(...input);
      return Effect.succeed(ok(undefined));
    },
  };
  const result = await Effect.runPromise(populateQdrantFromStructuralIndex(
    indexResult.value,
    qdrant,
    embeddings,
    'b'.repeat(64),
    new Map([[key, [0.1, 0.9]]]),
    providerIdentity,
  ));
  assert.equal(result._tag, 'Ok');
  assert.equal(inferenceCalls, 0);
  assert.equal((points[0] as { embeddingKey?: string }).embeddingKey, key);
});
