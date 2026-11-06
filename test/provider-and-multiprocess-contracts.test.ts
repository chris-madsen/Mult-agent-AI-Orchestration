import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { makeVertexRagRetrievalPort } from '../src/adapters/vertex-rag.js';
import { makeQdrantCodeCandidatePort } from '../src/adapters/http-provider-boundaries.js';
import { validateLocalQdrantBaseUrl } from '../src/adapters/qdrant-sdk-adapter.js';
import { makeFileArtifactStore } from '../src/adapters/file-artifact-store.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import { makeQdrantContextProvider } from '../src/adapters/qdrant-context-provider.js';
import { makeAsyncFileMemoryArchive } from '../src/adapters/file-memory-archive.js';
import { makeEpisodeId, type SessionEpisode } from '../src/domain/memory.js';
import { defaultLocalPolicy } from '../src/domain/policy.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok, type Result } from '../src/domain/result.js';
import type { HttpPort } from '../src/application/ports.js';
import { makeMcpGateway } from '../src/gateway/mcp-gateway.js';
import { makeQdrantSdkTestPort } from './helpers/qdrant-sdk-test-double.js';

const value = <T, E>(result: Result<T, E>): T => {
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(String(result.error));
  return result.value;
};
const ws = value(makeWorkspaceId('contract-providers'));

test('DBC-07 Vertex cloud denial makes zero outbound calls', async () => {
  let requests = 0;
  const http: HttpPort = {
    request: () => {
      requests += 1;
      return Effect.succeed(ok({ status: 200, body: {} }));
    },
  };
  const provider = makeVertexRagRetrievalPort({
    project: 'ace-dev',
    location: 'us-central1',
    corpusId: 'abc',
    policy: defaultLocalPolicy(ws),
    accessToken: () => 'irrelevant-token',
    http,
  });
  const result = await Effect.runPromise(provider.search({ workspaceId: ws, query: 'architecture', topK: 3 }));
  assert.equal(result._tag, 'Err');
  assert.equal(requests, 0);
});

test('DBC-07 runtime context keeps Vertex denial partial and makes zero outbound calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-runtime-policy-'));
  const workspaceId = value(makeWorkspaceId('runtime-policy-denial'));
  let requests = 0;
  const http: HttpPort = {
    request: () => {
      requests += 1;
      return Effect.succeed(ok({ status: 200, body: {} }));
    },
  };
  const documentation = makeVertexRagRetrievalPort({
    project: 'ace-dev', location: 'europe-west4', corpusId: 'empty',
    policy: defaultLocalPolicy(workspaceId), accessToken: () => 'must-not-be-used', http,
  });
  const files = makeNodeWorkspacePort({ allowedRoots: [root] });
  const context = makeQdrantContextProvider({
    workspaceId,
    rootPath: root,
    files,
    qdrant: {
      search: () => Effect.succeed(ok([])),
      upsert: () => Effect.succeed(ok(undefined)),
    },
    embeddings: { embedMany: (input) => Effect.succeed(ok(input.map(() => [1]))) },
    artifacts: makeFileArtifactStore(join(root, 'artifacts')),
    semantics: {
      definition: () => Effect.succeed(ok([])),
      references: () => Effect.succeed(ok([])),
      typeInfo: () => Effect.succeed(ok(undefined)),
      diagnostics: () => Effect.succeed(ok([])),
    },
    documentation,
    newRequestId: () => 'policy-request-1',
  });
  const gateway = makeMcpGateway({
    clock: { nowMs: () => 1 },
    ids: { newWorkspaceId: () => workspaceId, newRequestId: () => 'gateway-request-1' },
    files,
    store: {
      get: () => Effect.succeed(ok({ workspaceId, rootPath: root, observationEpoch: 1, createdAtMs: 1 })),
      findByRoot: () => Effect.succeed(ok(undefined)),
      save: () => Effect.succeed(ok(undefined)),
    },
    artifacts: makeFileArtifactStore(join(root, 'gateway-artifacts')),
    context,
  });

  const response = await Effect.runPromise(gateway.handle({
    name: 'ace_context',
    arguments: { workspace_id: workspaceId, query: 'architecture', include_docs: true },
  }));
  assert.equal(response.status, 'ok');
  if (response.status !== 'ok') return;
  assert.equal(requests, 0);
  assert.equal(response.result.complete, false);
  assert.ok(response.result.partialSources.includes('documentation'));
  assert.ok(response.result.warnings.some((warning) => warning.includes('POLICY_DENIED')));
});

test('Vertex v1beta1 retrieval uses real retrieveContexts wire shape and provenance', async () => {
  const http: HttpPort = {
    request: (req) => {
      assert.match(req.url, /us-central1:retrieveContexts$/);
      assert.equal((req.body?.query as { text?: string }).text, 'architecture');
      const store = req.body?.vertexRagStore as { ragResources: readonly { ragCorpus: string }[] };
      assert.match(store.ragResources[0]?.ragCorpus ?? '', /ragCorpora\/abc$/);
      return Effect.succeed(ok({
        status: 200,
        body: { contexts: { contexts: [{ sourceUri: 'gs://docs/adr.md', text: 'ADR: candidate search' }] } },
      }));
    },
  };
  const provider = makeVertexRagRetrievalPort({
    project: 'ace-dev',
    location: 'us-central1',
    corpusId: 'abc',
    policy: {
      ...defaultLocalPolicy(ws),
      cloudOptIn: true,
      allowedCloudProviders: ['vertex'],
      allowedCloudDataClassesByProvider: { vertex: ['project_document'] },
    },
    accessToken: () => 'token',
    http,
  });
  const result = value(await Effect.runPromise(provider.search({ workspaceId: ws, query: 'architecture', topK: 3 })));
  assert.equal(result[0]?.citation, 'gs://docs/adr.md');
  assert.equal(result[0]?.freshness, 'unknown');
});

test('Vertex empty Europe corpus is a valid empty result, never invented documentation', async () => {
  const workspaceId = value(makeWorkspaceId('vertex-empty-europe'));
  const provider = makeVertexRagRetrievalPort({
    project: 'poetic-emblem-494722-v2', location: 'europe-west4', corpusId: '2305843009213693952',
    accessToken: () => 'token',
    policy: {
      ...defaultLocalPolicy(workspaceId),
      cloudOptIn: true,
      allowedCloudProviders: ['vertex'],
      allowedCloudDataClassesByProvider: { vertex: ['project_document'] },
    },
    http: { request: () => Effect.succeed(ok({ status: 200, body: {} })) },
  });
  const result = value(await Effect.runPromise(provider.search({ workspaceId, query: 'synthetic readiness probe', topK: 3 })));
  assert.deepEqual(result, []);
});

test('Qdrant context emits rendered RepoMap as structural evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-repo-map-context-'));
  try {
    const workspaceId = value(makeWorkspaceId('repo-map-context-evidence'));
    const files = makeNodeWorkspacePort({ allowedRoots: [root] });
    const provider = makeQdrantContextProvider({
      workspaceId,
      rootPath: root,
      files,
      qdrant: {
        search: () => Effect.succeed(ok([])),
        upsert: () => Effect.succeed(ok(undefined)),
      },
      embeddings: { embedMany: (input) => Effect.succeed(ok(input.map(() => [1]))) },
      artifacts: makeFileArtifactStore(join(root, 'artifacts')),
      semantics: {
        definition: () => Effect.succeed(ok([])),
        references: () => Effect.succeed(ok([])),
        typeInfo: () => Effect.succeed(ok(undefined)),
        diagnostics: () => Effect.succeed(ok([])),
      },
      repoMap: {
        update: () => Effect.succeed(ok(undefined)),
        render: () => Effect.succeed(ok({
          ranked: [],
          rendered: 'src/run.ts:\n  src/run.ts:1 function run()',
          estimatedTokens: 8,
          truncated: false,
        })),
      } as never,
      newRequestId: () => 'repo-map-context-request',
    });
    const result = await Effect.runPromise(provider.search({
      workspaceId,
      query: 'run',
      includeDocs: false,
      includeMemory: false,
    }));
    assert.equal(result._tag, 'Ok');
    if (result._tag === 'Ok') {
      const structural = result.value.evidence.find((item) => item.source === 'structural');
      assert.equal(structural?.content, 'src/run.ts:\n  src/run.ts:1 function run()');
      assert.equal(structural?.proofClass, 'derived');
      assert.equal(structural?.freshness, 'unknown', 'aggregate RepoMap is not exact-reread as one source');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('required structural coverage is unavailable when no RepoMap was actually produced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-structural-coverage-'));
  try {
    const workspaceId = value(makeWorkspaceId('structural-coverage'));
    const source = 'export function run() { return 1; }\n';
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'run.ts'), source, 'utf8');
    const files = makeNodeWorkspacePort({ allowedRoots: [root] });
    const candidate = {
      candidateId: 'run-candidate',
      workspaceId,
      repoPath: 'src/run.ts',
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: Buffer.byteLength(source.trimEnd(), 'utf8') + 1 },
      symbolName: 'run',
      structuralKind: 'function',
      structuralLanguage: 'typescript',
      structuralExported: true,
      semanticAnchor: { line: 1, byteColumn: 17, endLine: 1, endByteColumn: 20 },
      text: source.trimEnd(),
      sourceDigest: createHash('sha256').update(source).digest('hex'),
      generation: 1,
      indexedAtMs: 1,
      invalidated: false,
    } as never;
    const provider = makeQdrantContextProvider({
      workspaceId,
      rootPath: root,
      files,
      qdrant: {
        search: () => Effect.succeed(ok([{ candidate, score: 1, freshness: 'unknown' }] as never)),
        upsert: () => Effect.succeed(ok(undefined)),
      },
      embeddings: { embedMany: (input) => Effect.succeed(ok(input.map(() => [1]))) },
      artifacts: makeFileArtifactStore(join(root, 'artifacts')),
      semantics: {
        definition: () => Effect.succeed(ok([])),
        references: () => Effect.succeed(ok([])),
        typeInfo: () => Effect.succeed(ok(undefined)),
        diagnostics: () => Effect.succeed(ok([])),
      },
      newRequestId: () => 'structural-coverage-request',
    });
    const result = await Effect.runPromise(provider.search({
      workspaceId,
      query: 'run',
      includeDocs: false,
      includeMemory: false,
      sourceRequirements: {
        code: { requirement: 'optional', allowed: true },
        structural: { requirement: 'required', allowed: true },
        lsp: { requirement: 'not_requested', allowed: true },
        documentation: { requirement: 'not_requested', allowed: true },
        memory: { requirement: 'not_requested', allowed: true },
      },
    }));
    assert.equal(result._tag, 'Ok');
    if (result._tag === 'Ok') {
      const structural = result.value.sourceCoverage?.find((item) => item.source === 'structural');
      assert.equal(structural?.status, 'unavailable');
      assert.equal(result.value.complete, false);
      assert.ok(result.value.partialSources.includes('structural'));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Qdrant code payload is local-only and rejects external HTTPS before every SDK operation', async () => {
  let sdkCalls = 0;
  const client = {
    query: async () => {
      sdkCalls += 1;
      return { points: [] };
    },
    upsert: async () => {
      sdkCalls += 1;
      return { status: 'completed' };
    },
    delete: async () => {
      sdkCalls += 1;
      return { status: 'completed' };
    },
  } as unknown as QdrantClient;
  const qdrant = makeQdrantCodeCandidatePort({
    collection: 'ace-code',
    sdk: makeQdrantSdkTestPort(client, 'https://vector.example.com'),
  });
  const results = [
    await Effect.runPromise(qdrant.search({
      workspaceId: ws,
      vector: [1],
      strategy: 'dense',
      limit: 1,
    })),
    await Effect.runPromise(qdrant.upsert([])),
    await Effect.runPromise(qdrant.deletePaths!({
      workspaceId: ws,
      repoPaths: ['src/private.ts' as never],
    })),
    await Effect.runPromise(qdrant.deleteWorkspaceVersions!({
      workspaceId: ws,
      exceptIndexKey: 'current-index',
    })),
  ];
  for (const result of results) {
    assert.equal(result._tag, 'Err');
    if (result._tag === 'Err') assert.equal(result.error.code, 'POLICY_DENIED');
  }
  assert.equal(sdkCalls, 0, 'policy denial must happen before any SDK client method is invoked');

  const validator = validateLocalQdrantBaseUrl('https://vector.example.com');
  assert.equal(validator._tag, 'Err');
});

test('Vertex blocks secret-like documentation queries before outbound HTTP even when cloud opt-in is enabled', async () => {
  let requests = 0;
  const provider = makeVertexRagRetrievalPort({
    project: 'ace-dev',
    location: 'europe-west4',
    corpusId: 'abc',
    policy: {
      ...defaultLocalPolicy(ws),
      cloudOptIn: true,
      allowedCloudProviders: ['vertex'],
      allowedCloudDataClassesByProvider: { vertex: ['project_document'] },
    },
    accessToken: () => 'token',
    http: { request: () => { requests += 1; return Effect.succeed(ok({ status: 200, body: {} })); } },
  });
  const result = await Effect.runPromise(provider.search({
    workspaceId: ws,
    query: 'please inspect api_key=super-secret-value-123456789',
    topK: 3,
  }));
  assert.equal(result._tag, 'Err');
  assert.equal(requests, 0);
});
test('DBC-11 independent archive instances preserve shared blobs during deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-process-archive-'));
  const a = await makeAsyncFileMemoryArchive(root);
  const b = await makeAsyncFileMemoryArchive(root);
  const bytes = Buffer.from('identical session source\n');
  const hash = createHash('sha256').update(bytes).digest('hex') as SessionEpisode['contentDigest'];
  const ep = (id: string): SessionEpisode => ({
    episodeId: value(makeEpisodeId(id)),
    workspaceId: ws,
    sessionId: id,
    sourcePointer: 'codex://' + id,
    contentDigest: hash,
    content: bytes,
    searchText: 'identical source',
    tombstoned: false,
    occurredAtMs: 1000,
    importedAtMs: 1001,
  });
  const x = ep('a');
  const y = ep('b');
  const imports = await Promise.all([a.importEpisode(x), b.importEpisode(y)]);
  imports.forEach((r) => assert.equal(r._tag, 'Ok'));
  const deleted = await Promise.all([a.deleteEpisode(x.episodeId), b.readEpisode(y.episodeId)]);
  assert.equal(deleted[0]._tag, 'Ok');
  assert.equal(deleted[1]._tag, 'Ok');
  assert.deepEqual(Buffer.from(value(await b.readEpisode(y.episodeId)).content), bytes);
});

test('archive refuses traversal episode IDs before any filesystem write or delete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-archive-traversal-'));
  const archive = await makeAsyncFileMemoryArchive(join(root, 'archive'));
  assert.equal(makeEpisodeId('../outside')._tag, 'Err');
  assert.equal(makeEpisodeId('nested/../../outside')._tag, 'Err');
  const content = Buffer.from('immutable safe bytes');
  const digest = createHash('sha256').update(content).digest('hex') as SessionEpisode['contentDigest'];
  const forgedId = '../outside' as SessionEpisode['episodeId'];
  const injected: SessionEpisode = {
    episodeId: forgedId, workspaceId: ws, sessionId: 'fixture', sourcePointer: 'codex://fixture',
    contentDigest: digest, content, searchText: 'fixture', tombstoned: false,
    occurredAtMs: 1, importedAtMs: 2,
  };
  assert.equal((await archive.importEpisode(injected))._tag, 'Err');
  assert.equal((await archive.readEpisode(forgedId))._tag, 'Err');
  assert.equal((await archive.deleteEpisode(forgedId))._tag, 'Err');
  await assert.rejects(readFile(join(root, 'archive', 'outside.json')));
});

test('crash-window tombstoned metadata is never returned or reconciled as a live original', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-archive-tombstone-crash-'));
  const archive = await makeAsyncFileMemoryArchive(root);
  const content = Buffer.from('original must not resurrect');
  const id = value(makeEpisodeId('crash-window'));
  const record: SessionEpisode = {
    episodeId: id, workspaceId: ws, sessionId: 'session', sourcePointer: 'codex://crash',
    contentDigest: createHash('sha256').update(content).digest('hex') as SessionEpisode['contentDigest'],
    content, searchText: 'original must not resurrect', tombstoned: false,
    occurredAtMs: 1, importedAtMs: 2,
  };
  assert.equal((await archive.importEpisode(record))._tag, 'Ok');
  // Failpoint: simulate process death immediately after the irreversible tombstone write.
  await mkdir(join(root, 'tombstones'), { recursive: true });
  await writeFile(join(root, 'tombstones', `${id}.json`), JSON.stringify({ episodeId: id, deletedAtMs: 3 }));
  const listed = await archive.listEpisodes();
  assert.equal(listed._tag, 'Ok');
  if (listed._tag === 'Ok') assert.deepEqual(listed.value, []);
  const read = await archive.readEpisode(id);
  assert.equal(read._tag, 'Err');
  if (read._tag === 'Err') assert.equal(read.error.code, 'ARCHIVE_TOMBSTONED');
});
