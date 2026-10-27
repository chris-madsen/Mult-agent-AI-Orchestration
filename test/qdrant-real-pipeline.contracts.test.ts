import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import {
  codeIndexKey,
  ensureQdrantCollection,
  exactUtf8ByteRange,
  hasExactQdrantSnapshot,
  readQdrantSnapshotVectors,
  reuseOrPopulateQdrantSnapshot,
  verifyQdrantSnapshotMembership,
  makeQdrantContextProvider,
  mutateQdrantChangedPaths,
  populateQdrantFromStructuralIndex,
  probeQdrantService,
} from '../src/adapters/qdrant-context-provider.js';
import { createCodeIndex, makeCandidateId, makeCodeCandidate } from '../src/domain/retrieval.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { err, ok, type Result } from '../src/domain/result.js';
import { domainError } from '../src/domain/errors.js';
import { exactUtf8Span, utf16ColumnAtUtf8Byte } from '../src/domain/utf8-range.js';
import { makeWorkspaceSync } from '../src/application/workspace-sync.js';
import { workspaceManifestFromSnapshot } from '../src/domain/workspace-manifest.js';
import type { ProviderTraceEvent } from '../src/domain/provider-trace.js';
import type {
  ArtifactStore,
  CodeCandidatePort,
  DocumentationPort,
  HttpPort,
  MemorySearchPort,
  ProviderTraceSink,
  SemanticAnalysisPort,
  WorkspaceFilePort,
} from '../src/application/ports.js';
import { makeQdrantSdkTestDouble } from './helpers/qdrant-sdk-test-double.js';

const mustOk = <T, E>(value: Result<T, E>): T => {
  assert.equal(value._tag, 'Ok');
  if (value._tag === 'Err') throw new Error(String(value.error));
  return value.value;
};

const sdk = (http: HttpPort) => makeQdrantSdkTestDouble(http);

const workspaceId = mustOk(makeWorkspaceId('real-pipeline-fixture'));
const source = Buffer.from('export function reconnect(): string { return "ok"; }\n');
const digest = createHash('sha256').update(source).digest('hex');
const candidate = mustOk(makeCodeCandidate({
  candidateId: mustOk(makeCandidateId('function-reconnect')),
  workspaceId, repoPath: 'src/connection.ts' as never,
  range: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 53 },
  symbolName: 'reconnect',
  semanticAnchor: { line: 1, byteColumn: 17, endLine: 1, endByteColumn: 26 },
  text: source.toString('utf8').trim(),
  sourceDigest: digest as never,
  generation: 1 as never,
  indexedAtMs: 1234,
  conflictKey: 'reconnect-policy',
  conflictValue: 'current code retries immediately',
}));

test('Qdrant service probe is namespace-independent and fails before embedding startup on outage', async () => {
  const urls: string[] = [];
  const reachable: HttpPort = {
    request: (request) => {
      urls.push(request.url);
      return Effect.succeed(ok({ status: 200, body: { result: { collections: [] } } }));
    },
  };
  const ready = await Effect.runPromise(probeQdrantService(
    reachable,
    'http://127.0.0.1:6333',
    [],
    sdk(reachable),
  ));
  assert.equal(ready._tag, 'Ok');
  assert.deepEqual(urls, ['http://127.0.0.1:6333/collections']);

  const unavailable: HttpPort = {
    request: () => Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'offline'))),
  };
  const failed = await Effect.runPromise(probeQdrantService(
    unavailable,
    'http://127.0.0.1:6333',
    [],
    sdk(unavailable),
  ));
  assert.equal(failed._tag, 'Err');
});

test('stable changed-path mutation publishes before pruning older path versions', async () => {
  const index = mustOk(createCodeIndex(1, [candidate]));
  const events: string[] = [];
  const deletes: Array<{ paths: readonly string[]; except?: string }> = [];
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    deletePaths: (input) => {
      events.push('delete');
      deletes.push({
        paths: [...input.repoPaths],
        ...(input.exceptIndexKey === undefined ? {} : { except: input.exceptIndexKey }),
      });
      return Effect.succeed(ok(undefined));
    },
    upsert: (points) => {
      events.push('upsert');
      assert.equal(points.length, 1);
      return Effect.succeed(ok(undefined));
    },
  };
  const result = await Effect.runPromise(mutateQdrantChangedPaths(
    index,
    qdrant,
    { embedMany: (input: readonly string[]) => Effect.succeed(ok(input.map(() => [0.2, 0.7]))) },
    workspaceId,
    ['src/connection.ts' as never],
    'stable-index',
    undefined,
    undefined,
    (() => {
      const verificationHttp: HttpPort = {
        request: (request) => {
          const body = request.body as { filter?: { must?: Array<{ key?: string; match?: { value?: unknown } }> } };
          assert.ok(body.filter?.must?.some((condition) =>
            condition.key === 'repo_path' && condition.match?.value === 'src/connection.ts'));
          return Effect.succeed(ok({
            status: 200,
            body: {
              result: {
                points: [{ payload: { candidate_id: candidate.candidateId } }],
                next_page_offset: null,
              },
            },
          }));
        },
      };
      return { http: verificationHttp, baseUrl: 'http://127.0.0.1:6333', collection: 'ace-stable', client: sdk(verificationHttp) };
    })(),
  ));
  assert.equal(result._tag, 'Ok');
  assert.deepEqual(events, ['upsert', 'delete']);
  assert.deepEqual(deletes, [{
    paths: ['src/connection.ts'],
    except: 'stable-index',
  }]);
});

test('stable changed-path mutation verifies the new path version before pruning the last good one', async () => {
  const index = mustOk(createCodeIndex(1, [candidate]));
  const events: string[] = [];
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: () => {
      events.push('upsert');
      return Effect.succeed(ok(undefined));
    },
    deletePaths: () => {
      events.push('delete');
      return Effect.succeed(ok(undefined));
    },
  };
  const result = await Effect.runPromise(mutateQdrantChangedPaths(
    index,
    qdrant,
    { embedMany: (input: readonly string[]) => Effect.succeed(ok(input.map(() => [0.2, 0.7]))) },
    workspaceId,
    ['src/connection.ts' as never],
    'stable-index',
    undefined,
    undefined,
    (() => {
      const verificationHttp: HttpPort = {
        request: () => Effect.succeed(ok({
          status: 200,
          body: { result: { points: [], next_page_offset: null } },
        })),
      };
      return { http: verificationHttp, baseUrl: 'http://127.0.0.1:6333', collection: 'ace-stable', client: sdk(verificationHttp) };
    })(),
  ));
  assert.equal(result._tag, 'Err');
  assert.deepEqual(events, ['upsert'], 'old path versions must survive incomplete publication');
});

test('stable changed-path mutation leaves the last good points intact when embedding fails', async () => {
  const index = mustOk(createCodeIndex(1, [candidate]));
  let deletes = 0;
  let upserts = 0;
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    deletePaths: () => {
      deletes += 1;
      return Effect.succeed(ok(undefined));
    },
    upsert: () => {
      upserts += 1;
      return Effect.succeed(ok(undefined));
    },
  };
  const result = await Effect.runPromise(mutateQdrantChangedPaths(
    index,
    qdrant,
    {
      embedMany: () => Effect.succeed(err(domainError(
        'EXTERNAL_UNAVAILABLE',
        'embedding',
        'offline',
      ))),
    },
    workspaceId,
    ['src/connection.ts' as never],
    'stable-index',
  ));
  assert.equal(result._tag, 'Err');
  assert.equal(upserts, 0);
  assert.equal(deletes, 0);
});

test('stable changed-path mutation preserves last-good points when changed source indexing is incomplete', async () => {
  const index = mustOk(createCodeIndex(2, []));
  let deletes = 0;
  let upserts = 0;
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: () => {
      upserts += 1;
      return Effect.succeed(ok(undefined));
    },
    deletePaths: () => {
      deletes += 1;
      return Effect.succeed(ok(undefined));
    },
  };
  const failedPath = 'src/connection.ts' as never;
  const result = await Effect.runPromise(mutateQdrantChangedPaths(
    index,
    qdrant,
    { embedMany: () => Effect.succeed(ok([])) },
    workspaceId,
    [failedPath],
    'stable-index',
    undefined,
    undefined,
    undefined,
    new Set([failedPath]),
  ));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'NOT_READY');
  assert.equal(upserts, 0);
  assert.equal(deletes, 0, 'failed parse/read must not erase last-known-good path points');
});

test('stable synchronized retrieval fails closed when WorkspaceSync is absent', async () => {
  const workspaceManifest = workspaceManifestFromSnapshot({ headRevision: 'a'.repeat(40), files: [], removedPaths: [] }, 'scope-v1');
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => Effect.succeed(err(domainError('SNAPSHOT_FAILED', 'workspace', 'must not snapshot'))),
    observeChanges: () => Effect.succeed(ok({ headRevision: 'a'.repeat(40), changedPaths: [], addedPaths: [], deletedPaths: [], renamed: [] })),
    readExact: () => Effect.succeed(err(domainError('FILE_NOT_FOUND', 'repo_path', 'not used'))),
  };
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files,
    workspaceManifest,
    qdrantStableCollection: true,
    qdrant: { search: () => Effect.succeed(ok([])), upsert: () => Effect.succeed(ok(undefined)) },
    embeddings: { embedMany: () => Effect.succeed(ok([[0.1, 0.2]])) },
    artifacts: { storeExact: () => Effect.succeed(ok({ handle: 'unused', digest: digest as never, sizeBytes: 0 })), readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'unused'))) },
    semantics: { definition: () => Effect.succeed(ok([])), references: () => Effect.succeed(ok([])), typeInfo: () => Effect.succeed(ok(undefined)), diagnostics: () => Effect.succeed(ok([])) },
    newRequestId: () => 'stable-missing-sync',
  });
  const result = await Effect.runPromise(provider.search({ workspaceId, query: 'missing sync', includeDocs: false, includeMemory: false }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'NOT_READY');
});

test('Qdrant collection bootstrap is additive and rejects mismatched dimensions', async () => {
  const requests: string[] = [];
  const http: HttpPort = {
    request: (request) => {
      requests.push(request.method);
      return Effect.succeed(ok(request.method === 'GET'
        ? { status: 404, body: {} }
        : { status: 200, body: { result: true } }));
    },
  };
  assert.equal((await Effect.runPromise(ensureQdrantCollection(
    http, 'http://127.0.0.1:6333', 'ace-test', 2, [], undefined, sdk(http), 'hybrid',
  )))._tag, 'Ok');
  assert.deepEqual(requests, ['GET', 'PUT']);

  const wrong: HttpPort = {
    request: () => Effect.succeed(ok({ status: 200, body: { result: { config: { params: { vectors: { size: 64 } } } } } })),
  };
  assert.equal((await Effect.runPromise(ensureQdrantCollection(
    wrong, 'http://127.0.0.1:6333', 'ace-test', 2, [], undefined, sdk(wrong), 'hybrid',
  )))._tag, 'Err');
});

test('Qdrant collection bootstrap accepts a concurrent create winner only after schema revalidation', async () => {
  const requests: string[] = [];
  let verificationReads = 0;
  const http: HttpPort = {
    request: (request) => {
      requests.push(`${request.method}:${request.url}`);
      if (request.method === 'GET' && requests.length === 1) {
        return Effect.succeed(ok({ status: 404, body: {} }));
      }
      if (request.method === 'PUT') {
        return Effect.succeed(ok({ status: 409, body: {} }));
      }
      verificationReads += 1;
      if (verificationReads === 1) return Effect.succeed(ok({ status: 500, body: {} }));
      return Effect.succeed(ok({ status: 200, body: {
        result: { config: { params: {
          vectors: { dense: { size: 2, distance: 'Cosine' } },
          sparse_vectors: { sparse: { modifier: 'Idf' } },
        } } },
      } }));
    },
  };
  const ready = await Effect.runPromise(ensureQdrantCollection(
    http, 'http://127.0.0.1:6333', 'ace-concurrent', 2,
    [], undefined, sdk(http), 'hybrid',
  ));
  assert.equal(ready._tag, 'Ok');
  assert.deepEqual(requests.map((request) => request.split(':')[0]), ['GET', 'PUT', 'GET', 'GET']);
});

test('warm Qdrant index key follows actual structural content, not observation epoch', () => {
  const first = mustOk(createCodeIndex(1, [candidate]));
  const sameContentLater = mustOk(createCodeIndex(2, [{
    ...candidate,
    generation: 2 as never,
    indexedAtMs: 9_999,
  }]));
  assert.equal(codeIndexKey(first), codeIndexKey(sameContentLater),
    'unchanged structural candidates must reuse vectors across observation epochs');

  const changed = mustOk(createCodeIndex(2, [{
    ...candidate,
    candidateId: mustOk(makeCandidateId('function-reconnect-changed')),
    text: 'export function reconnect(): string { return "changed"; }',
    sourceDigest: 'b'.repeat(64) as never,
    generation: 2 as never,
    indexedAtMs: 9_999,
  }]));
  assert.notEqual(codeIndexKey(first), codeIndexKey(changed),
    'changed source/candidate structure must never reuse the previous semantic vectors');
  assert.match(codeIndexKey(first), /^[a-f0-9]{64}$/u);
});

test('stable Qdrant index key ignores observation and out-of-scope coverage churn', () => {
  const index = mustOk(createCodeIndex(1, [candidate]));
  const manifest = [{
    repoPath: candidate.repoPath,
    sourceDigest: candidate.sourceDigest,
    candidateIds: [candidate.candidateId],
    sizeBytes: source.byteLength,
    parserVersion: 'parser-v1',
    scopeFingerprint: 'scope-v1',
  }];
  const baseCoverage = {
    schemaVersion: 1,
    sourceSnapshotDigest: 'a'.repeat(64),
    parserVersion: 'parser-v1',
    attemptedPaths: 1,
    indexedPaths: 1,
    policyExcludedPaths: 0,
    outOfScopePaths: 3,
    failedPaths: 0,
    failureCounts: {
      read_failed: 0,
      binary_source: 0,
      invalid_utf8: 0,
      digest_raced: 0,
      structural_failed: 0,
      digest_mismatch: 0,
      parser_partial: 0,
      unsupported_parser: 0,
    },
    failures: [],
  } as const;
  const observationOnlyChange = {
    ...baseCoverage,
    sourceSnapshotDigest: 'b'.repeat(64),
    outOfScopePaths: 99,
    policyExcludedPaths: 7,
  };
  assert.equal(
    codeIndexKey(index, baseCoverage as never, 'provider-v1', manifest as never),
    codeIndexKey(index, observationOnlyChange as never, 'provider-v1', manifest as never),
    'HEAD/state/out-of-scope diagnostics must not invalidate identical retrieval content',
  );

  const parserFailure = {
    ...baseCoverage,
    failedPaths: 1,
    failureCounts: { ...baseCoverage.failureCounts, structural_failed: 1 },
    failures: [{ repoPath: candidate.repoPath, kind: 'structural_failed', code: 'BROKEN' }],
  };
  assert.notEqual(
    codeIndexKey(index, baseCoverage as never, 'provider-v1', manifest as never),
    codeIndexKey(index, parserFailure as never, 'provider-v1', manifest as never),
    'in-scope indexing failures remain part of retrieval identity',
  );
});

test('warm Qdrant snapshot reuse does not re-embed or upsert current source', async () => {
  let requests = 0;
  let upserts = 0;
  let embeds = 0;
  const http: HttpPort = {
    request: (request) => {
      requests += 1;
      assert.deepEqual((request.body?.filter as { must: unknown[] }).must, [
        { key: 'workspace_id', match: { value: workspaceId } },
        { key: 'index_key', match: { value: 'snapshot-digest' } },
      ]);
      return Effect.succeed(ok(request.url.endsWith('/points/count')
        ? { status: 200, body: { result: { count: 1 } } }
        : { status: 200, body: { result: { points: [{ payload: { candidate_id: candidate.candidateId } }], next_page_offset: null } } }));
    },
  };
  let cleanups = 0;
  const qdrant: CodeCandidatePort = {
    upsert: () => { upserts += 1; return Effect.succeed(ok(undefined)); },
    search: () => Effect.succeed(ok([])),
    deleteWorkspaceVersions: (input) => {
      cleanups += 1;
      assert.equal(input.exceptIndexKey, 'snapshot-digest');
      return Effect.succeed(ok(undefined));
    },
  };
  const embeddings = {
    embedMany: () => { embeds += 1; return Effect.succeed(ok([[1, 2]])); },
  };
  const index = mustOk(createCodeIndex(1, [candidate]));
  const ready = mustOk(await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
    index, qdrant, embeddings, http, 'http://127.0.0.1:6333', 'ace-test', workspaceId, 'snapshot-digest',
    [], true, undefined, undefined, undefined, undefined, sdk(http), false,
  )));
  assert.deepEqual(ready, { count: 1, reused: true, reusedVectorCount: 1 });
  assert.equal(requests, 2);
  assert.equal(upserts, 0);
  assert.equal(embeds, 0);
  assert.equal(cleanups, 1, 'warm reuse must prune crash leftovers before serving stable search');
});


test('full stable snapshot publishes current points before pruning stale workspace versions', async () => {
  const index = mustOk(createCodeIndex(1, [candidate]));
  const events: string[] = [];
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: () => {
      events.push('upsert');
      return Effect.succeed(ok(undefined));
    },
    deleteWorkspaceVersions: (input) => {
      events.push('cleanup:' + input.exceptIndexKey);
      return Effect.succeed(ok(undefined));
    },
  };
  let scrolls = 0;
  const http: HttpPort = {
    request: (request) => {
      if (request.url.endsWith('/points/count')) {
        return Effect.succeed(ok({ status: 200, body: { result: { count: 0 } } }));
      }
      if (request.url.endsWith('/points/scroll')) {
        scrolls += 1;
        return Effect.succeed(ok({
          status: 200,
          body: {
            result: {
              points: [{ payload: { candidate_id: candidate.candidateId } }],
              next_page_offset: null,
            },
          },
        }));
      }
      return Effect.succeed(ok({ status: 200, body: { result: true } }));
    },
  };
  const result = await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
    index,
    qdrant,
    { embedMany: (input: readonly string[]) => Effect.succeed(ok(input.map(() => [0.2, 0.7]))) },
    http,
    'http://127.0.0.1:6333',
    'ace-stable',
    workspaceId,
    'current-index',
    [], true, undefined, undefined, undefined, undefined, sdk(http), false,
  ));
  assert.equal(result._tag, 'Ok', JSON.stringify(result));
  assert.deepEqual(events, ['upsert', 'cleanup:current-index']);
  assert.equal(scrolls, 1, 'membership is verified before stale-version cleanup');
});

test('full stable rebuild preserves old workspace versions when new membership is incomplete', async () => {
  const index = mustOk(createCodeIndex(1, [candidate]));
  const events: string[] = [];
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: () => {
      events.push('upsert');
      return Effect.succeed(ok(undefined));
    },
    deleteWorkspaceVersions: () => {
      events.push('cleanup');
      return Effect.succeed(ok(undefined));
    },
  };
  const http: HttpPort = {
    request: (request) => {
      if (request.url.endsWith('/points/count')) {
        return Effect.succeed(ok({ status: 200, body: { result: { count: 0 } } }));
      }
      if (request.url.endsWith('/points/scroll')) {
        return Effect.succeed(ok({
          status: 200,
          body: { result: { points: [], next_page_offset: null } },
        }));
      }
      return Effect.succeed(ok({ status: 200, body: { result: true } }));
    },
  };
  const result = await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
    index,
    qdrant,
    { embedMany: (input: readonly string[]) => Effect.succeed(ok(input.map(() => [0.2, 0.7]))) },
    http,
    'http://127.0.0.1:6333',
    'ace-stable',
    workspaceId,
    'current-index',
    [], true, undefined, undefined, undefined, undefined, sdk(http), false,
  ));
  assert.equal(result._tag, 'Err');
  assert.deepEqual(events, ['upsert'], 'cleanup must wait for complete current membership proof');
});

test('Qdrant warm reuse rebuilds on different count and fails closed on count outage', async () => {
  const index = mustOk(createCodeIndex(1, [candidate]));
  let upserts = 0;
  const qdrant: CodeCandidatePort = {
    upsert: () => { upserts += 1; return Effect.succeed(ok(undefined)); },
    search: () => Effect.succeed(ok([])),
  };
  const embeddings = {
    embedMany: (input: readonly string[]) => Effect.succeed(ok(input.map(() => [1, 2]))),
  };
  const qdrantRequests: Array<{ readonly url: string; readonly body?: Readonly<Record<string, unknown>> }> = [];
  const http: HttpPort = {
    request: (request) => {
      qdrantRequests.push({ url: request.url, ...(request.body === undefined ? {} : { body: request.body }) });
      return Effect.succeed(ok(request.url.endsWith('/points/count')
        ? { status: 200, body: { result: { count: 0 } } }
        : request.url.endsWith('/points/scroll')
          ? { status: 200, body: { result: { points: [{ payload: { candidate_id: candidate.candidateId } }], next_page_offset: null } } }
          : { status: 200, body: { result: true } }));
    },
  };
  const rebuilt = mustOk(await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
    index, qdrant, embeddings, http, 'http://127.0.0.1:6333', 'ace-test', workspaceId, 'snapshot-digest',
    [], true, undefined, undefined, undefined, undefined, sdk(http), false,
  )));
  assert.deepEqual(rebuilt, { count: 1, reused: false, reusedVectorCount: 0 });
  assert.equal(upserts, 1);
  assert.equal(qdrantRequests.length, 2, 'count mismatch rebuilds idempotently and verifies membership');
  assert.match(qdrantRequests[1]?.url ?? '', /\/points\/scroll$/u);
  const offline: HttpPort = { request: () => Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'offline'))) };
  const failed = await Effect.runPromise(hasExactQdrantSnapshot(
    offline, 'http://127.0.0.1:6333', 'ace-test', workspaceId, 'snapshot-digest', 1,
    [], sdk(offline),
  ));
  assert.equal(failed._tag, 'Err');
});

test('snapshot maintenance scrolls request only the payload fields they consume', async () => {
  const requests: Array<Readonly<Record<string, unknown>>> = [];
  const http: HttpPort = {
    request: (request) => {
      if (request.url.endsWith('/points/scroll')) {
        requests.push(request.body ?? {});
        const withPayload = request.body?.with_payload;
        const points = JSON.stringify(withPayload) === JSON.stringify(['index_key'])
          ? [{ payload: { index_key: 'a'.repeat(64) } }]
          : [{
            payload: {
              candidate_id: candidate.candidateId,
              ...(Array.isArray(withPayload) && withPayload.includes('embedding_key')
                ? { embedding_key: 'content-key' }
                : {}),
            },
            vector: [0.1, 0.9],
          }];
        return Effect.succeed(ok({ status: 200, body: { result: { points, next_page_offset: null } } }));
      }
      throw new Error('unexpected HTTP request: ' + request.url);
    },
  };

  const membership = await Effect.runPromise(verifyQdrantSnapshotMembership(
    http, 'http://127.0.0.1:6333', 'ace-test', workspaceId, 'a'.repeat(64), [candidate.candidateId],
    [], sdk(http),
  ));
  assert.equal(mustOk(membership), true);
  const vectors = await Effect.runPromise(readQdrantSnapshotVectors(
    http, 'http://127.0.0.1:6333', 'ace-test', workspaceId, 'a'.repeat(64),
    [], sdk(http),
  ));
  assert.deepEqual([...mustOk(vectors).entries()], [['content-key', [0.1, 0.9]]]);
  assert.deepEqual(requests.map((body) => body.with_payload), [
    ['candidate_id'],
    ['candidate_id', 'embedding_key'],
  ]);
  assert.deepEqual(requests.map((body) => body.with_vector), [false, true]);
});

test('Qdrant→current filesystem→LSP→ContextBundle includes verified snippet and exact expansion handle', async () => {
  let upserts = 0;
  let searches = 0;
  let definitions = 0;
  const qdrant: CodeCandidatePort = {
    upsert: (points) => {
      upserts += 1;
      assert.equal(points[0]?.vector.length, 2);
      return Effect.succeed(ok(undefined));
    },
    search: () => {
      searches += 1;
      return Effect.succeed(ok([{ candidate, score: 0.96, freshness: 'unknown' as const }]));
    },
  };
  const embeddings = {
    embedMany: (input: readonly string[]) => Effect.succeed(ok(input.map(() => [0.2, 0.7]))),
  };
  const index = mustOk(createCodeIndex(1, [candidate]));
  assert.equal(mustOk(await Effect.runPromise(populateQdrantFromStructuralIndex(index, qdrant, embeddings))), 1);
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    observeChanges: () => Effect.succeed(ok({ headRevision: 'a'.repeat(40), changedPaths: [], addedPaths: [], deletedPaths: [], renamed: [] })),
    snapshot: () => { throw new Error('query must not snapshot repository'); },
    readExact: () => Effect.succeed(ok({ bytes: source, digest: digest as never })),
  };
  const artifacts: ArtifactStore = {
    storeExact: () => Effect.succeed(ok({ handle: 'full-file-handle', digest: digest as never, sizeBytes: source.length })),
    readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not needed'))),
  };
  const semantics: SemanticAnalysisPort = {
    definition: () => {
      definitions += 1;
      return Effect.succeed(ok([{
        location: { repoPath: 'src/connection.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 26 },
        name: 'reconnect', kind: 'function',
      }]));
    },
    references: () => Effect.succeed(ok([])),
    typeInfo: () => Effect.succeed(ok(undefined)),
    diagnostics: () => Effect.succeed(ok([])),
  };
  const workspaceManifest = workspaceManifestFromSnapshot({ headRevision: 'a'.repeat(40), files: [], removedPaths: [] }, 'scope-v1');
  const workspaceSync = makeWorkspaceSync({
    initial: {
      workspaceId,
      workspaceManifest,
      generation: 1,
      indexKey: 'index-v1',
      candidateIdsByPath: new Map(),
    },
    observeChanges: () => Effect.succeed(ok({ changed: false })),
    rebuild: () => Effect.succeed(err(domainError('NOT_READY', 'workspace_sync', 'not needed by the no-change fixture'))),
  });
  const provider = makeQdrantContextProvider({
    workspaceId, rootPath: '/repo', files, qdrant, embeddings, artifacts, semantics, newRequestId: () => 'qdrant-request',
    workspaceManifest, workspaceSync,
  });
  const context = mustOk(await Effect.runPromise(provider.search({
    workspaceId, query: 'retry database connection', includeDocs: false, includeMemory: false,
  })));
  assert.equal(searches, 1);
  assert.equal(upserts, 1);
  assert.equal(definitions, 1);
  assert.equal(context.complete, true);
  assert.equal(context.evidence[0]?.freshness, 'current');
  assert.equal(context.evidence[0]?.expansionHandle, 'full-file-handle');
  const spanOffset = Number(context.evidence[0]?.expansionCursor);
  const spanLength = context.evidence[0]?.expansionMaxBytes ?? 0;
  assert.ok(Number.isSafeInteger(spanOffset));
  assert.ok(spanLength > 0);
  assert.equal(source.subarray(spanOffset, spanOffset + spanLength).toString('utf8'), candidate.text,
    'one precise expansion range restores only the verified AST symbol, not the entire file');
  assert.equal(context.evidence[0]?.content, source.toString('utf8').trim());
});


test('synchronized provider catches up when another request already published a newer index key', async () => {
  let searchedIndexKey: string | undefined;
  let reconcileCalls = 0;
  const qdrant: CodeCandidatePort = {
    upsert: () => Effect.succeed(ok(undefined)),
    search: (input) => {
      searchedIndexKey = input.indexKey;
      return Effect.succeed(ok([{ candidate, score: 0.96, freshness: 'unknown' as const }]));
    },
  };
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    observeChanges: () => Effect.succeed(ok({
      headRevision: 'a'.repeat(40), changedPaths: [], addedPaths: [], deletedPaths: [], renamed: [],
    })),
    snapshot: () => { throw new Error('synchronized catch-up must not snapshot repository'); },
    readExact: () => Effect.succeed(ok({ bytes: source, digest: digest as never })),
  };
  const artifacts: ArtifactStore = {
    storeExact: () => Effect.succeed(ok({ handle: 'catch-up-file', digest: digest as never, sizeBytes: source.length })),
    readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
  };
  const semantics: SemanticAnalysisPort = {
    definition: () => Effect.succeed(ok([{
      location: { repoPath: 'src/connection.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 26 },
      name: 'reconnect', kind: 'function',
    }])),
    references: () => Effect.succeed(ok([])),
    typeInfo: () => Effect.succeed(ok(undefined)),
    diagnostics: () => Effect.succeed(ok([])),
  };
  const workspaceManifest = workspaceManifestFromSnapshot({
    headRevision: 'a'.repeat(40), files: [], removedPaths: [],
  }, 'scope-v1');
  const syncState = {
    workspaceId,
    workspaceManifest,
    generation: 2,
    indexKey: 'index-v2',
    candidateIdsByPath: new Map(),
  };
  const workspaceSync = {
    initialize: () => Effect.succeed(ok(syncState)),
    refresh: () => Effect.succeed(ok({
      state: syncState,
      delta: { changed: [], added: [], deleted: [], renamed: [], scopeChanged: false },
      refreshed: false,
    })),
  };
  let config: Parameters<typeof makeQdrantContextProvider>[0];
  const reconcile = () => {
    reconcileCalls += 1;
    return Effect.succeed(ok({ ...config, indexKey: 'index-v2' }));
  };
  config = {
    workspaceId,
    rootPath: '/repo',
    files,
    qdrant,
    embeddings: { embedMany: () => Effect.succeed(ok([[0.2, 0.7]])) },
    artifacts,
    semantics,
    newRequestId: () => 'sync-catch-up',
    workspaceManifest,
    workspaceSync,
    indexKey: 'index-v1',
    reconcile,
  };
  const provider = makeQdrantContextProvider(config);
  const context = await Effect.runPromise(provider.search({
    workspaceId, query: 'retry database connection', includeDocs: false, includeMemory: false,
  }));
  assert.equal(context._tag, 'Ok');
  assert.equal(reconcileCalls, 1);
  assert.equal(searchedIndexKey, 'index-v2');
});

test('LSP disagreement keeps exact code visible only as uncertain partial evidence', async () => {
  const qdrant: CodeCandidatePort = {
    upsert: () => Effect.succeed(ok(undefined)),
    search: () => Effect.succeed(ok([{ candidate, score: 0.95, freshness: 'unknown' as const }])),
  };
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => { throw new Error('query must not snapshot repository'); },
    readExact: () => Effect.succeed(ok({ bytes: source, digest: digest as never })),
  };
  const artifacts: ArtifactStore = {
    storeExact: () => Effect.succeed(ok({ handle: 'exact-file', digest: digest as never, sizeBytes: source.length })),
    readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
  };
  const semantics: SemanticAnalysisPort = {
    definition: () => Effect.succeed(ok([])),
    references: () => Effect.succeed(ok([])),
    typeInfo: () => Effect.succeed(ok(undefined)),
    diagnostics: () => Effect.succeed(ok([])),
  };
  const provider = makeQdrantContextProvider({
    workspaceId, rootPath: '/repo', files, qdrant, artifacts, semantics,
    embeddings: { embedMany: () => Effect.succeed(ok([[0.2, 0.7]])) },
    newRequestId: () => 'lsp-disagreement',
  });
  const context = mustOk(await Effect.runPromise(provider.search({
    workspaceId, query: 'retry database connection', includeDocs: false, includeMemory: false,
  })));
  assert.equal(context.complete, false);
  assert.ok(context.partialSources.includes('lsp'));
  assert.equal(context.evidence[0]?.freshness, 'current');
  assert.equal(context.evidence[0]?.proofClass, 'uncertain');
  assert.equal(context.evidence[0]?.content, candidate.text);
});

test('multiple Qdrant symbols from one file cause one initial read plus one final revalidation', async () => {
  let exactReads = 0;
  let storedSources = 0;
  const qdrant: CodeCandidatePort = {
    upsert: () => Effect.succeed(ok(undefined)),
    search: () => Effect.succeed(ok([
      { candidate, score: 1, freshness: 'unknown' as const },
      { candidate: { ...candidate, candidateId: 'another-symbol' as never }, score: 0.8, freshness: 'unknown' as const },
    ])),
  };
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => { throw new Error('no workspace-wide scan per retrieval'); },
    readExact: () => { exactReads += 1; return Effect.succeed(ok({ bytes: source, digest: digest as never })); },
  };
  const artifacts: ArtifactStore = {
    storeExact: () => { storedSources += 1; return Effect.succeed(ok({ handle: 'same-file-handle', digest: digest as never, sizeBytes: source.length })); },
    readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
  };
  const semantics: SemanticAnalysisPort = {
    definition: () => Effect.succeed(ok([{
      location: { repoPath: 'src/connection.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 26 },
      name: 'reconnect', kind: 'function',
    }])),
    references: () => Effect.succeed(ok([])),
    typeInfo: () => Effect.succeed(ok(undefined)),
    diagnostics: () => Effect.succeed(ok([])),
  };
  const provider = makeQdrantContextProvider({
    workspaceId, rootPath: '/repo', files, qdrant, artifacts, semantics,
    embeddings: { embedMany: () => Effect.succeed(ok([[0.2, 0.7]])) },
    newRequestId: () => 'same-file-query',
  });
  const context = mustOk(await Effect.runPromise(provider.search({
    workspaceId, query: 'reconnect function', includeDocs: false, includeMemory: false,
  })));
  assert.equal(exactReads, 2, 'initial source read and end-of-request freshness revalidation only');
  assert.equal(storedSources, 1, 'exact original stored once per distinct file');
  assert.equal(context.evidence.length, 2, 'distinct evidence IDs remain visible under the merged core provenance contract');
  assert.ok(context.evidence.every((item) => item.freshness === 'current'));
});
test('DBC-14 documentation conflict preserves code and ADR provenance explicitly', async () => {
  const documentation: DocumentationPort = {
    search: () => Effect.succeed(ok([{
      evidenceId: 'documentation-evidence' as never,
      source: 'documentation',
      citation: 'docs/adr-reconnect.md#policy',
      content: 'ADR states reconnect waits for operator confirmation.',
      proofClass: 'derived',
      freshness: 'unknown',
      sourceRevision: 'adr-r1',
      sourceTimestampMs: 1000,
      conflictKey: 'reconnect-policy',
      conflictValue: 'ADR requires operator confirmation',
    }])),
  };
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => { throw new Error('query must not snapshot repository'); },
    readExact: () => Effect.succeed(ok({ bytes: source, digest: digest as never })),
  };
  const artifacts: ArtifactStore = {
    storeExact: () => Effect.succeed(ok({ handle: 'conflict-file-handle', digest: digest as never, sizeBytes: source.length })),
    readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not needed'))),
  };
  const semantics: SemanticAnalysisPort = {
    definition: () => Effect.succeed(ok([{
      location: { repoPath: 'src/connection.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 26 },
      name: 'reconnect', kind: 'function',
    }])),
    references: () => Effect.succeed(ok([])),
    typeInfo: () => Effect.succeed(ok(undefined)),
    diagnostics: () => Effect.succeed(ok([])),
  };
  const qdrant: CodeCandidatePort = {
    upsert: () => Effect.succeed(ok(undefined)),
    search: () => Effect.succeed(ok([{ candidate, score: 0.99, freshness: 'unknown' as const }])),
  };
  const embeddings = {
    embedMany: (input: readonly string[]) => Effect.succeed(ok(input.map(() => [0.2, 0.7]))),
  };
  const provider = makeQdrantContextProvider({
    workspaceId, rootPath: '/repo', files, qdrant, embeddings, artifacts, semantics, documentation,
    newRequestId: () => 'conflict-request',
  });
  const context = mustOk(await Effect.runPromise(provider.search({
    workspaceId, query: 'reconnect policy', includeDocs: true, includeMemory: false,
  })));
  assert.equal(context.complete, false);
  assert.equal(context.evidence.length, 2);
  assert.equal(context.evidence.find((item) => item.source === 'code')?.sourceRevision, digest);
  assert.equal(context.evidence.find((item) => item.source === 'documentation')?.sourceRevision, 'adr-r1');
  assert.equal(context.conflicts?.length, 1);
  assert.equal(context.conflicts?.[0]?.conflictKey, 'reconnect-policy');
  assert.ok(context.warnings.some((warning) => warning.includes('evidence sources disagree')));
});

test('Qdrant existing collection must use cosine distance even with matching vector dimensions', async () => {
  const check = (distance: string, sparseModifier = 'Idf'): HttpPort => ({
    request: () => Effect.succeed(ok({ status: 200, body: {
      result: { config: { params: {
        vectors: { dense: { size: 384, distance } },
        sparse_vectors: { sparse: { modifier: sparseModifier } },
      } } },
    } })),
  });
  const ready = (distance: string) => Effect.runPromise(ensureQdrantCollection(
    check(distance), 'http://127.0.0.1:6333', 'ace-test', 384,
    [], undefined, sdk(check(distance)),
  ));
  assert.equal((await ready('Cosine'))._tag, 'Ok');
  assert.equal((await ready('Dot'))._tag, 'Err');
  assert.equal((await ready('Euclid'))._tag, 'Err');
  assert.equal((await Effect.runPromise(ensureQdrantCollection(
    check('Cosine', 'None'), 'http://127.0.0.1:6333', 'ace-test', 384,
    [], undefined, sdk(check('Cosine', 'None')),
  )))._tag, 'Err');
});

test('Qdrant byte-range verification rejects cross-line columns and split UTF-8 sequences', () => {
  const bytes = Buffer.from('abc\nxyz\n');
  assert.deepEqual(exactUtf8ByteRange(bytes, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 }), { offset: 0, length: 3 });
  assert.equal(exactUtf8ByteRange(bytes, { startLine: 1, startColumn: 6, endLine: 2, endColumn: 2 }), undefined);
  assert.equal(exactUtf8ByteRange(bytes, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 }), undefined);
  assert.equal(exactUtf8ByteRange(bytes, { startLine: 2, startColumn: 1, endLine: 1, endColumn: 4 }), undefined);
  const unicode = Buffer.from('éclair\n');
  assert.equal(exactUtf8ByteRange(unicode, { startLine: 1, startColumn: 2, endLine: 1, endColumn: 3 }), undefined);
});

test('shared UTF-8 ranges preserve Cyrillic, combining marks, emoji, CRLF and multiline spans', () => {
  const first = 'тест 😀 e\u0301';
  const second = 'вторая строка';
  const bytes = Buffer.from(`${first}\r\n${second}\r\n`, 'utf8');
  const emojiStart = Buffer.byteLength('тест ', 'utf8') + 1;
  const emojiEnd = emojiStart + Buffer.byteLength('😀', 'utf8');
  const combiningStart = Buffer.byteLength('тест 😀 ', 'utf8') + 1;
  const combiningEnd = combiningStart + Buffer.byteLength('e\u0301', 'utf8');

  assert.equal(exactUtf8Span(bytes, {
    startLine: 1,
    startColumn: emojiStart,
    endLine: 1,
    endColumn: emojiEnd,
  }), '😀');
  assert.equal(exactUtf8Span(bytes, {
    startLine: 1,
    startColumn: combiningStart,
    endLine: 1,
    endColumn: combiningEnd,
  }), 'e\u0301');
  assert.equal(exactUtf8Span(bytes, {
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: Buffer.byteLength(first, 'utf8') + 1,
  }), first);
  assert.equal(exactUtf8Span(bytes, {
    startLine: 1,
    startColumn: 1,
    endLine: 2,
    endColumn: Buffer.byteLength(second, 'utf8') + 1,
  }), `${first}\r\n${second}`);

  const emojiLine = Buffer.from('😀X', 'utf8');
  assert.equal(utf16ColumnAtUtf8Byte(emojiLine, 1, 1), 1);
  assert.equal(utf16ColumnAtUtf8Byte(emojiLine, 1, 5), 3);
  assert.equal(utf16ColumnAtUtf8Byte(emojiLine, 1, 6), 4);
});

// A slow optional provider must not open a post-verification edit window.
test('DBC-05 final worktree revalidation runs after documentation retrieval', async () => {
  let edited = false;
  let reads = 0;
  const changed = Buffer.from('export function reconnect(): string { return "changed"; }\n');
  const changedDigest = createHash('sha256').update(changed).digest('hex');
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => { throw new Error('not used'); },
    readExact: () => {
      reads += 1;
      return Effect.succeed(ok(edited
        ? { bytes: changed, digest: changedDigest as never }
        : { bytes: source, digest: digest as never }));
    },
  };
  const qdrant: CodeCandidatePort = {
    upsert: () => Effect.succeed(ok(undefined)),
    search: () => Effect.succeed(ok([{ candidate, score: 0.99, freshness: 'unknown' as const }])),
  };
  const artifacts: ArtifactStore = {
    storeExact: () => Effect.succeed(ok({ handle: 'docs-race', digest: digest as never, sizeBytes: source.length })),
    readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not needed'))),
  };
  const semantics: SemanticAnalysisPort = {
    definition: () => Effect.succeed(ok([{
      location: { repoPath: 'src/connection.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 26 },
      name: 'reconnect', kind: 'function',
    }])),
    references: () => Effect.succeed(ok([])),
    typeInfo: () => Effect.succeed(ok(undefined)),
    diagnostics: () => Effect.succeed(ok([])),
  };
  const documentation: DocumentationPort = {
    search: () => {
      edited = true;
      return Effect.succeed(ok([{
        evidenceId: 'document-during-edit' as never,
        source: 'documentation',
        citation: 'docs/reconnect.md',
        content: 'Document remains available',
        proofClass: 'direct',
        freshness: 'current',
      }]));
    },
  };
  const provider = makeQdrantContextProvider({
    workspaceId, rootPath: '/repo', files, qdrant, artifacts, semantics, documentation,
    embeddings: { embedMany: () => Effect.succeed(ok([[1, 0]])) },
    newRequestId: () => 'docs-race-request',
  });
  const result = mustOk(await Effect.runPromise(provider.search({
    workspaceId, query: 'reconnect', includeDocs: true, includeMemory: false,
  })));
  assert.equal(reads, 2);
  assert.equal(result.complete, false);
  assert.ok(result.partialSources.includes('code'));
  assert.equal(result.partialSources.includes('documentation'), false);
  assert.equal(result.evidence.find((item) => item.source === 'code')?.freshness, 'changed_during_request');
  assert.equal(result.evidence.find((item) => item.source === 'code')?.proofClass, 'uncertain');
});


test('Qdrant snapshot membership rejects equal-count wrong candidates', async () => {
  const http: HttpPort = {
    request: () => Effect.succeed(ok({
      status: 200,
      body: { result: { points: [{ payload: { candidate_id: 'wrong-candidate' } }], next_page_offset: null } },
    })),
  };
  const result = await Effect.runPromise(verifyQdrantSnapshotMembership(
    http, 'http://127.0.0.1:6333', 'ace-test', workspaceId, 'snapshot-a', [candidate.candidateId],
    [], sdk(http),
  ));
  assert.equal(mustOk(result), false);
});

test('exact LSP confirmation rejects a different declaration on the same AST line', async () => {
  const sameLineSource = Buffer.from('export function alpha(){} export function beta(){}\n');
  const sameLineDigest = createHash('sha256').update(sameLineSource).digest('hex');
  const beta = mustOk(makeCodeCandidate({
    candidateId: mustOk(makeCandidateId('same-line-beta')),
    workspaceId,
    repoPath: 'src/same-line.ts' as never,
    range: { startLine: 1, startColumn: 27, endLine: 1, endColumn: 51 },
    symbolName: 'beta',
    semanticAnchor: { line: 1, byteColumn: 43, endLine: 1, endByteColumn: 47 },
    text: 'export function beta(){}',
    sourceDigest: sameLineDigest as never,
    generation: 1 as never,
    indexedAtMs: 1,
  }));
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files: {
      canonicalizeRoot: () => Effect.succeed(ok('/repo')),
      snapshot: () => { throw new Error('not used'); },
      readExact: () => Effect.succeed(ok({ bytes: sameLineSource, digest: sameLineDigest as never })),
    },
    qdrant: {
      upsert: () => Effect.succeed(ok(undefined)),
      search: () => Effect.succeed(ok([{ candidate: beta, score: 1, freshness: 'unknown' as const }])),
    },
    embeddings: { embedMany: () => Effect.succeed(ok([[1, 0]])) },
    artifacts: {
      storeExact: () => Effect.succeed(ok({ handle: 'same-line', digest: sameLineDigest as never, sizeBytes: sameLineSource.length })),
      readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
    },
    semantics: {
      definition: () => Effect.succeed(ok([{
        location: { repoPath: 'src/same-line.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 22 },
        name: 'alpha',
      }])),
      references: () => Effect.succeed(ok([])),
      typeInfo: () => Effect.succeed(ok(undefined)),
      diagnostics: () => Effect.succeed(ok([])),
    },
    newRequestId: () => 'same-line-lsp',
  });
  const bundle = mustOk(await Effect.runPromise(provider.search({
    workspaceId, query: 'beta', includeDocs: false, includeMemory: false,
  })));
  assert.equal(bundle.complete, false);
  assert.ok(bundle.partialSources.includes('lsp'));
  assert.equal(bundle.evidence[0]?.proofClass, 'uncertain');
});

test('index coverage failures make an otherwise current result incomplete', async () => {
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files: {
      canonicalizeRoot: () => Effect.succeed(ok('/repo')),
      snapshot: () => { throw new Error('not used'); },
      readExact: () => Effect.succeed(ok({ bytes: source, digest: digest as never })),
    },
    qdrant: {
      upsert: () => Effect.succeed(ok(undefined)),
      search: () => Effect.succeed(ok([{ candidate, score: 1, freshness: 'unknown' as const }])),
    },
    embeddings: { embedMany: () => Effect.succeed(ok([[1, 0]])) },
    artifacts: {
      storeExact: () => Effect.succeed(ok({ handle: 'coverage', digest: digest as never, sizeBytes: source.length })),
      readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
    },
    semantics: {
      definition: () => Effect.succeed(ok([{
        location: { repoPath: 'src/connection.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 26 },
        name: 'reconnect',
      }])),
      references: () => Effect.succeed(ok([])),
      typeInfo: () => Effect.succeed(ok(undefined)),
      diagnostics: () => Effect.succeed(ok([])),
    },
    coverage: {
      schemaVersion: 1,
      sourceSnapshotDigest: 'a'.repeat(64) as never,
      parserVersion: 'fixture/parser-v1',
      attemptedPaths: 2,
      indexedPaths: 1,
      policyExcludedPaths: 0,
      outOfScopePaths: 0,
      failedPaths: 1,
      failureCounts: {
        read_failed: 1,
        binary_source: 0,
        invalid_utf8: 0,
        digest_raced: 0,
        structural_failed: 0,
        digest_mismatch: 0,
        parser_partial: 0,
        unsupported_parser: 0,
      },
      failures: [{ repoPath: 'src/unreadable.ts' as never, kind: 'read_failed', code: 'FILE_NOT_FOUND' }],
    },
    newRequestId: () => 'coverage-request',
  });
  const bundle = mustOk(await Effect.runPromise(provider.search({
    workspaceId, query: 'reconnect', includeDocs: false, includeMemory: false,
  })));
  assert.equal(bundle.complete, false);
  assert.ok(bundle.partialSources.includes('code'));
  assert.equal(bundle.indexCoverage?.failedPaths, 1);
});


test('Qdrant context does not claim complete history from bounded Graphiti memory', async () => {
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files: {
      canonicalizeRoot: () => Effect.succeed(ok('/repo')),
      snapshot: () => { throw new Error('not used'); },
      readExact: () => Effect.succeed(ok({ bytes: source, digest: digest as never })),
    },
    qdrant: {
      upsert: () => Effect.succeed(ok(undefined)),
      search: () => Effect.succeed(ok([{ candidate, score: 1, freshness: 'unknown' as const }])),
    },
    embeddings: { embedMany: () => Effect.succeed(ok([[1, 0]])) },
    artifacts: {
      storeExact: () => Effect.succeed(ok({ handle: 'memory-context', digest: digest as never, sizeBytes: source.length })),
      readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
    },
    semantics: {
      definition: () => Effect.succeed(ok([{
        location: { repoPath: 'src/connection.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 26 },
        name: 'reconnect',
      }])),
      references: () => Effect.succeed(ok([])),
      typeInfo: () => Effect.succeed(ok(undefined)),
      diagnostics: () => Effect.succeed(ok([])),
    },
    memory: {
      search: () => Effect.succeed(ok({
        hits: [{
          episode: {
            episodeId: 'episode-memory' as never,
            workspaceId,
            sessionId: 'session-memory',
            sourcePointer: 'codex://session-memory/1',
            occurredAtMs: 10,
            importedAtMs: 11,
            contentDigest: 'c'.repeat(64) as never,
            searchText: 'we selected local qdrant',
            tombstoned: false,
          },
          matchingExcerpt: 'Local Qdrant was selected for private code retrieval.',
        }],
        conflicts: [],
        evidenceCompleteness: 'provider_bounded_top_k',
      })),
    },
    newRequestId: () => 'memory-context-request',
  });
  const bundle = mustOk(await Effect.runPromise(provider.search({
    workspaceId, query: 'why local qdrant', includeDocs: false, includeMemory: true,
  })));
  assert.equal(bundle.complete, false);
  assert.deepEqual(bundle.partialSources, ['memory']);
  assert.equal(bundle.sourceCoverage?.find((item) => item.source === 'memory')?.status, 'partial');
  assert.equal(bundle.sourceCoverage?.find((item) => item.source === 'memory')?.reason, 'provider_bounded_top_k');
  assert.match(bundle.warnings.find((warning) => warning.startsWith('memory:')) ?? '', /not establish exhaustive history/u);
  const memoryEvidence = bundle.evidence.find((item) => item.source === 'memory');
  assert.equal(memoryEvidence?.citation, 'codex://session-memory/1');
  assert.equal(memoryEvidence?.proofClass, 'derived');
  assert.equal(memoryEvidence?.sourceDigest, 'c'.repeat(64));

  const emptyProvider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files: {
      canonicalizeRoot: () => Effect.succeed(ok('/repo')),
      snapshot: () => { throw new Error('not used'); },
      readExact: () => Effect.succeed(ok({ bytes: source, digest: digest as never })),
    },
    qdrant: {
      upsert: () => Effect.succeed(ok(undefined)),
      search: () => Effect.succeed(ok([{ candidate, score: 1, freshness: 'unknown' as const }])),
    },
    embeddings: { embedMany: () => Effect.succeed(ok([[1, 0]])) },
    artifacts: {
      storeExact: () => Effect.succeed(ok({ handle: 'empty-memory', digest: digest as never, sizeBytes: source.length })),
      readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
    },
    semantics: {
      definition: () => Effect.succeed(ok([{
        location: { repoPath: 'src/connection.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 26 },
        name: 'reconnect',
      }])),
      references: () => Effect.succeed(ok([])),
      typeInfo: () => Effect.succeed(ok(undefined)),
      diagnostics: () => Effect.succeed(ok([])),
    },
    memory: { search: () => Effect.succeed(ok({ hits: [], conflicts: [] })) },
    newRequestId: () => 'empty-memory-context',
  });
  const empty = mustOk(await Effect.runPromise(emptyProvider.search({
    workspaceId, query: 'unknown historical thing', includeDocs: false, includeMemory: true,
  })));
  assert.equal(empty.complete, true);
  assert.equal(empty.partialSources.includes('memory'), false);
});


test('new snapshot reuses vectors only for unchanged candidate IDs from a compatible prior snapshot', async () => {
  const changed = mustOk(makeCodeCandidate({
    ...candidate,
    candidateId: mustOk(makeCandidateId('changed-candidate')),
    text: 'export function reconnectChanged() { return true; }',
  }));
  const index = { generation: 2 as never, candidates: [candidate, changed] };
  let embeddingInputs: readonly string[] = [];
  const upserted: CodePoint[] = [];
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: (points) => {
      upserted.push(...points);
      return Effect.succeed(ok(undefined));
    },
  };
  let scrollCalls = 0;
  const http: HttpPort = {
    request: (request) => {
      if (request.url.endsWith('/points/count')) {
        return Effect.succeed(ok({ status: 200, body: { result: { count: 0 } } }));
      }
      if (request.url.endsWith('/points/scroll')) {
        scrollCalls += 1;
        if (scrollCalls === 1) {
          return Effect.succeed(ok({
            status: 200,
            body: {
              result: {
                points: [{ payload: { candidate_id: candidate.candidateId }, vector: [0.1, 0.9] }],
                next_page_offset: null,
              },
            },
          }));
        }
        return Effect.succeed(ok({
          status: 200,
          body: {
            result: {
              points: [
                { payload: { candidate_id: candidate.candidateId } },
                { payload: { candidate_id: changed.candidateId } },
              ],
              next_page_offset: null,
            },
          },
        }));
      }
      throw new Error('unexpected HTTP request: ' + request.url);
    },
  };
  const embeddings: VectorEmbeddingPort = {
    embedMany: (texts) => {
      embeddingInputs = texts;
      return Effect.succeed(ok(texts.map(() => [0.8, 0.2])));
    },
  };
  const result = mustOk(await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
    index,
    qdrant,
    embeddings,
    http,
    'http://127.0.0.1:6333',
    'ace-test',
    workspaceId,
    'd'.repeat(64),
    [],
    false,
    'e'.repeat(64),
    undefined,
    undefined,
    undefined,
    sdk(http),
    false,
  )));
  assert.equal(result.reused, false);
  assert.equal(result.reusedVectorCount, 1);
  assert.deepEqual(embeddingInputs, [changed.text]);
  assert.equal(upserted.length, 2);
  assert.deepEqual(upserted.find((point) => point.candidate.candidateId === candidate.candidateId)?.vector, [0.1, 0.9]);
});


test('one ACE request id correlates docs, memory and final source verification without payload logging', async () => {
  const requestId = 'cross-provider-request';
  let docsRequestId: string | undefined;
  let memoryRequestId: string | undefined;
  const events: ProviderTraceEvent[] = [];
  const trace: ProviderTraceSink = { record: (event) => { events.push(event); } };
  const documentation: DocumentationPort = {
    search: (input) => {
      docsRequestId = input.requestId;
      return Effect.succeed(ok([]));
    },
  };
  const memory: MemorySearchPort = {
    search: (input) => {
      memoryRequestId = input.requestId;
      return Effect.succeed(ok({ hits: [], conflicts: [] }));
    },
  };
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files: {
      canonicalizeRoot: () => Effect.succeed(ok('/repo')),
      snapshot: () => { throw new Error('not used'); },
      readExact: () => Effect.succeed(ok({ bytes: source, digest: digest as never })),
    },
    qdrant: {
      upsert: () => Effect.succeed(ok(undefined)),
      search: () => Effect.succeed(ok([{ candidate, score: 1, freshness: 'unknown' as const }])),
    },
    embeddings: { embedMany: () => Effect.succeed(ok([[1, 0]])) },
    artifacts: {
      storeExact: () => Effect.succeed(ok({ handle: 'trace-file', digest: digest as never, sizeBytes: source.length })),
      readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
    },
    semantics: {
      definition: () => Effect.succeed(ok([{
        location: { repoPath: 'src/connection.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 26 },
        name: 'reconnect',
      }])),
      references: () => Effect.succeed(ok([])),
      typeInfo: () => Effect.succeed(ok(undefined)),
      diagnostics: () => Effect.succeed(ok([])),
    },
    documentation,
    memory,
    trace,
    newRequestId: () => requestId,
  });
  const result = mustOk(await Effect.runPromise(provider.search({
    workspaceId,
    query: 'why reconnect architecture',
    includeDocs: true,
    includeMemory: true,
  })));
  assert.equal(result.requestId, requestId);
  assert.equal(docsRequestId, requestId);
  assert.equal(memoryRequestId, requestId);
  const verification = events.find((event) => event.provider === 'source_verification');
  assert.equal(verification?.requestId, requestId);
  assert.equal(verification?.status, 'success');
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('why reconnect architecture'), false);
  assert.equal(serialized.includes(candidate.text), false);
});


test('DBC-05 final worktree revalidation also runs after temporal memory retrieval', async () => {
  let edited = false;
  let reads = 0;
  const changed = Buffer.from('export function reconnect(): string { return "changed-by-memory"; }\n');
  const changedDigest = createHash('sha256').update(changed).digest('hex');
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => { throw new Error('not used'); },
    readExact: () => {
      reads += 1;
      return Effect.succeed(ok(edited
        ? { bytes: changed, digest: changedDigest as never }
        : { bytes: source, digest: digest as never }));
    },
  };
  const qdrant: CodeCandidatePort = {
    upsert: () => Effect.succeed(ok(undefined)),
    search: () => Effect.succeed(ok([{ candidate, score: 0.99, freshness: 'unknown' as const }])),
  };
  const artifacts: ArtifactStore = {
    storeExact: () => Effect.succeed(ok({ handle: 'memory-race', digest: digest as never, sizeBytes: source.length })),
    readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not needed'))),
  };
  const semantics: SemanticAnalysisPort = {
    definition: () => Effect.succeed(ok([{
      location: { repoPath: 'src/connection.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 26 },
      name: 'reconnect', kind: 'function',
    }])),
    references: () => Effect.succeed(ok([])),
    typeInfo: () => Effect.succeed(ok(undefined)),
    diagnostics: () => Effect.succeed(ok([])),
  };
  const memory: MemorySearchPort = {
    search: () => {
      edited = true;
      return Effect.succeed(ok({
        hits: [{
          episode: {
            episodeId: 'race-memory-episode' as never,
            workspaceId,
            sessionId: 'race-memory-session',
            sourcePointer: 'codex://race-memory-session/1',
            occurredAtMs: 100,
            importedAtMs: 101,
            contentDigest: 'f'.repeat(64) as never,
            searchText: 'we selected local qdrant',
            tombstoned: false,
          },
          matchingExcerpt: 'We selected local Qdrant for private code retrieval.',
        }],
        conflicts: [],
      }));
    },
  };
  const provider = makeQdrantContextProvider({
    workspaceId, rootPath: '/repo', files, qdrant, artifacts, semantics, memory,
    embeddings: { embedMany: () => Effect.succeed(ok([[1, 0]])) },
    newRequestId: () => 'memory-race-request',
  });
  const result = mustOk(await Effect.runPromise(provider.search({
    workspaceId, query: 'why qdrant', includeDocs: false, includeMemory: true,
  })));

  assert.equal(reads, 2);
  assert.equal(result.complete, false);
  assert.ok(result.partialSources.includes('code'));
  assert.equal(result.partialSources.includes('memory'), false);
  const code = result.evidence.find((item) => item.source === 'code');
  const temporal = result.evidence.find((item) => item.source === 'memory');
  assert.equal(code?.freshness, 'changed_during_request');
  assert.equal(code?.proofClass, 'uncertain');
  assert.equal(temporal?.freshness, 'current');
  assert.equal(temporal?.proofClass, 'derived');
  assert.equal(temporal?.citation, 'codex://race-memory-session/1');
});


test('W10 docs-only route skips embeddings, Qdrant, source reads and LSP entirely', async () => {
  let embeddingCalls = 0;
  let qdrantCalls = 0;
  let sourceReads = 0;
  let semanticCalls = 0;
  let documentationCalls = 0;
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files: {
      canonicalizeRoot: () => Effect.succeed(ok('/repo')),
      snapshot: () => { throw new Error('not used'); },
      readExact: () => {
        sourceReads += 1;
        return Effect.succeed(ok({ bytes: source, digest: digest as never }));
      },
    },
    qdrant: {
      upsert: () => Effect.succeed(ok(undefined)),
      search: () => {
        qdrantCalls += 1;
        return Effect.succeed(ok([{ candidate, score: 1, freshness: 'unknown' as const }]));
      },
    },
    embeddings: {
      embedMany: () => {
        embeddingCalls += 1;
        return Effect.succeed(ok([[1, 0]]));
      },
    },
    artifacts: {
      storeExact: () => Effect.succeed(ok({ handle: 'not-used', digest: digest as never, sizeBytes: source.length })),
      readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
    },
    semantics: {
      definition: () => {
        semanticCalls += 1;
        return Effect.succeed(ok([]));
      },
      references: () => {
        semanticCalls += 1;
        return Effect.succeed(ok([]));
      },
      typeInfo: () => {
        semanticCalls += 1;
        return Effect.succeed(ok(undefined));
      },
      diagnostics: () => {
        semanticCalls += 1;
        return Effect.succeed(ok([]));
      },
    },
    documentation: {
      search: () => {
        documentationCalls += 1;
        return Effect.succeed(ok([{
          evidenceId: 'docs-only-evidence' as never,
          source: 'documentation',
          citation: 'docs/decision.md',
          content: 'The historical architecture rationale.',
          proofClass: 'derived',
          freshness: 'current',
        }]));
      },
    },
    newRequestId: () => 'docs-only-route',
  });

  const result = mustOk(await Effect.runPromise(provider.search({
    workspaceId,
    query: 'architecture rationale',
    includeCode: false,
    includeDocs: true,
    includeMemory: false,
  })));

  assert.equal(embeddingCalls, 0);
  assert.equal(qdrantCalls, 0);
  assert.equal(sourceReads, 0);
  assert.equal(semanticCalls, 0);
  assert.equal(documentationCalls, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.evidence.map((item) => item.source), ['documentation']);
});


test('stable warm restart reuses an exact mixed-key workspace without embeddings or unsafe cleanup', async () => {
  const second = {
    ...candidate,
    repoPath: 'src/other.ts' as never,
    candidateId: mustOk(makeCandidateId('warm-mixed-other')),
  };
  const index = mustOk(createCodeIndex(2, [candidate, second]));
  let embeddings = 0;
  let upserts = 0;
  let deletions = 0;
  let countRequests = 0;
  let membershipRequests = 0;
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: () => { upserts += 1; return Effect.succeed(ok(undefined)); },
    deleteWorkspaceVersions: () => { deletions += 1; return Effect.succeed(ok(undefined)); },
  };
  const http: HttpPort = {
    request: (request) => {
      const filter = request.body?.filter as { must?: Array<{ key: string }> } | undefined;
      if (request.url.endsWith('/points/count')) {
        countRequests += 1;
        // Only the edited candidate carries the newest global publication key.
        return Effect.succeed(ok({ status: 200, body: { result: { count: 1 } } }));
      }
      assert.ok(request.url.endsWith('/points/scroll'));
      membershipRequests += 1;
      assert.deepEqual(filter?.must, [{ key: 'workspace_id', match: { value: workspaceId } }],
        'mixed-key reuse must verify complete physical workspace membership, not latest index_key');
      return Effect.succeed(ok({
        status: 200,
        body: { result: {
          points: [
            { payload: { candidate_id: candidate.candidateId } },
            { payload: { candidate_id: second.candidateId } },
          ],
          next_page_offset: null,
        } },
      }));
    },
  };
  const result = mustOk(await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
    index, qdrant,
    { embedMany: () => { embeddings += 1; return Effect.succeed(ok([])); } },
    http, 'http://127.0.0.1:6333', 'ace-stable', workspaceId, 'latest-key',
    [], true, undefined, undefined, undefined, undefined, sdk(http), true,
  )));
  assert.deepEqual(result, { count: 2, reused: true, reusedVectorCount: 2 });
  assert.equal(countRequests, 1);
  assert.equal(membershipRequests, 1);
  assert.equal(embeddings, 0);
  assert.equal(upserts, 0);
  assert.equal(deletions, 0, 'old publication keys may still hold current unchanged points');
});

test('stable warm restart refuses incomplete mixed-key membership without workspace-wide cleanup', async () => {
  const second = {
    ...candidate,
    repoPath: 'src/other.ts' as never,
    candidateId: mustOk(makeCandidateId('warm-missing-other')),
  };
  const index = mustOk(createCodeIndex(2, [candidate, second]));
  let upserts = 0;
  let deletes = 0;
  let scrolls = 0;
  const http: HttpPort = {
    request: (request) => {
      if (request.url.endsWith('/points/count')) {
        return Effect.succeed(ok({ status: 200, body: { result: { count: 1 } } }));
      }
      scrolls += 1;
      return Effect.succeed(ok({
        status: 200,
        body: { result: {
          points: scrolls === 1
            ? [{ payload: { candidate_id: candidate.candidateId } }]
            : [
              { payload: { candidate_id: candidate.candidateId } },
              { payload: { candidate_id: second.candidateId } },
            ],
          next_page_offset: null,
        } },
      }));
    },
  };
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: () => { upserts += 1; return Effect.succeed(ok(undefined)); },
    deleteWorkspaceVersions: () => { deletes += 1; return Effect.succeed(ok(undefined)); },
  };
  const result = mustOk(await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
    index, qdrant,
    { embedMany: (chunks: readonly string[]) => Effect.succeed(ok(chunks.map(() => [0.2, 0.7]))) },
    http, 'http://127.0.0.1:6333', 'ace-stable', workspaceId, 'latest-key',
    [], true, undefined, undefined, undefined, undefined, sdk(http), true,
  )));
  assert.equal(result.reused, false);
  assert.equal(upserts, 1);
  assert.equal(scrolls, 3, 'verify mixed membership, rebuilt membership, and final physical membership');
  assert.equal(deletes, 0, 'stable publication must not prune the workspace by index key');
});

test('changed-path publication rejects a falsely successful stale-version delete', async () => {
  const index = mustOk(createCodeIndex(2, [candidate]));
  let deleted = 0;
  let scrolls = 0;
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: () => Effect.succeed(ok(undefined)),
    deletePaths: () => { deleted += 1; return Effect.succeed(ok(undefined)); },
  };
  const http: HttpPort = {
    request: (request) => {
      scrolls += 1;
      const filter = request.body?.filter as { must?: Array<{ key: string }> };
      const withIndexKey = filter.must?.some((item) => item.key === 'index_key');
      return Effect.succeed(ok({
        status: 200,
        body: { result: {
          points: withIndexKey
            ? [{ payload: { candidate_id: candidate.candidateId } }]
            : [
              { payload: { candidate_id: candidate.candidateId } },
              { payload: { candidate_id: 'stale-previous-version' } },
            ],
          next_page_offset: null,
        } },
      }));
    },
  };
  const result = await Effect.runPromise(mutateQdrantChangedPaths(
    index, qdrant,
    { embedMany: (input: readonly string[]) => Effect.succeed(ok(input.map(() => [0.2, 0.7]))) },
    workspaceId, [candidate.repoPath], 'latest-key',
    undefined, undefined,
    { http, baseUrl: 'http://127.0.0.1:6333', collection: 'ace-stable', client: sdk(http) },
  ));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_EXTERNAL_RESPONSE');
  assert.equal(deleted, 1);
  assert.equal(scrolls, 2, 'verify current publication, then verify complete physical membership after prune');
});

test('deleted source must have zero remaining physical Qdrant points', async () => {
  const index = mustOk(createCodeIndex(2, []));
  let deletions = 0;
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: () => { throw new Error('deletion does not upsert'); },
    deletePaths: () => { deletions += 1; return Effect.succeed(ok(undefined)); },
  };
  const http: HttpPort = {
    request: () => Effect.succeed(ok({
      status: 200,
      body: { result: {
        points: [{ payload: { candidate_id: candidate.candidateId } }],
        next_page_offset: null,
      } },
    })),
  };
  const result = await Effect.runPromise(mutateQdrantChangedPaths(
    index, qdrant,
    { embedMany: () => { throw new Error('deletion does not embed'); } },
    workspaceId, [candidate.repoPath], 'latest-key',
    undefined, undefined,
    { http, baseUrl: 'http://127.0.0.1:6333', collection: 'ace-stable', client: sdk(http) },
  ));
  assert.equal(result._tag, 'Err');
  assert.equal(deletions, 1);
});


test('stable warm reuse rejects a falsely successful workspace cleanup', async () => {
  const index = mustOk(createCodeIndex(2, [candidate]));
  let cleanups = 0;
  let scrolls = 0;
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: () => { throw new Error('current key membership requires no upsert'); },
    deleteWorkspaceVersions: () => { cleanups += 1; return Effect.succeed(ok(undefined)); },
  };
  const http: HttpPort = {
    request: (request) => {
      if (request.url.endsWith('/points/count')) {
        return Effect.succeed(ok({ status: 200, body: { result: { count: 1 } } }));
      }
      scrolls += 1;
      const filter = request.body?.filter as { must?: Array<{ key: string }> };
      const filteredByKey = filter.must?.some((condition) => condition.key === 'index_key');
      return Effect.succeed(ok({
        status: 200,
        body: { result: {
          points: [
            { payload: { candidate_id: candidate.candidateId } },
            ...(filteredByKey ? [] : [{ payload: { candidate_id: 'crash-leftover' } }]),
          ],
          next_page_offset: null,
        } },
      }));
    },
  };
  const result = await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
    index, qdrant,
    { embedMany: () => { throw new Error('current index is already fully published'); } },
    http, 'http://127.0.0.1:6333', 'ace-stable', workspaceId, 'latest-key',
    [], true, undefined, undefined, undefined, undefined, sdk(http), true,
  ));
  assert.equal(result._tag, 'Err');
  assert.equal(cleanups, 0, 'stable reuse must not invoke workspace-wide version cleanup');
  assert.equal(scrolls, 2, 'current-key and physical membership must be checked before refusing unsafe cleanup');
});

test('stable cold rebuild rejects a falsely successful stale-workspace cleanup', async () => {
  const index = mustOk(createCodeIndex(2, [candidate]));
  let cleanups = 0;
  let scrolls = 0;
  const qdrant: CodeCandidatePort = {
    search: () => Effect.succeed(ok([])),
    upsert: () => Effect.succeed(ok(undefined)),
    deleteWorkspaceVersions: () => { cleanups += 1; return Effect.succeed(ok(undefined)); },
  };
  const http: HttpPort = {
    request: (request) => {
      if (request.url.endsWith('/points/count')) {
        return Effect.succeed(ok({ status: 200, body: { result: { count: 0 } } }));
      }
      scrolls += 1;
      // Before upsert, physical membership is incomplete; after publication
      // the latest-key filter looks complete while a stale crash point remains.
      const filter = request.body?.filter as { must?: Array<{ key: string }> };
      const filteredByKey = filter.must?.some((condition) => condition.key === 'index_key');
      return Effect.succeed(ok({
        status: 200,
        body: { result: {
          points: [
            { payload: { candidate_id: candidate.candidateId } },
            ...(filteredByKey ? [] : [{ payload: { candidate_id: 'crash-leftover' } }]),
          ],
          next_page_offset: null,
        } },
      }));
    },
  };
  const result = await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
    index, qdrant,
    { embedMany: (chunks: readonly string[]) => Effect.succeed(ok(chunks.map(() => [0.2, 0.7]))) },
    http, 'http://127.0.0.1:6333', 'ace-stable', workspaceId, 'latest-key',
    [], true, undefined, undefined, undefined, undefined, sdk(http), true,
  ));
  assert.equal(result._tag, 'Err');
  assert.equal(cleanups, 0, 'stable rebuild must not invoke workspace-wide version cleanup');
  assert.equal(scrolls, 3, 'unfiltered membership must be checked after full publication');
});


test('initial stale Qdrant hit triggers one bounded exact refresh and retries current evidence', async () => {
  const staleCandidate = {
    ...candidate,
    candidateId: mustOk(makeCandidateId('outdated-reconnect')),
    sourceDigest: 'f'.repeat(64) as never,
  };
  let searches = 0;
  let exactRefreshes = 0;
  let reconciles = 0;
  const qdrant: CodeCandidatePort = {
    upsert: () => Effect.succeed(ok(undefined)),
    search: () => {
      searches += 1;
      return Effect.succeed(ok([{
        candidate: searches === 1 ? staleCandidate : candidate,
        score: 0.97,
        freshness: 'unknown' as const,
      }]));
    },
  };
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => { throw new Error('retry must not snapshot the whole repository'); },
    observeChanges: () => { throw new Error('workspace sync owns the observation'); },
    readExact: () => Effect.succeed(ok({ bytes: source, digest: digest as never })),
  };
  const artifacts: ArtifactStore = {
    storeExact: () => Effect.succeed(ok({ handle: 'exact-current-file', digest: digest as never, sizeBytes: source.length })),
    readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
  };
  const semantics: SemanticAnalysisPort = {
    definition: () => Effect.succeed(ok([])),
    references: () => Effect.succeed(ok([])),
    typeInfo: () => Effect.succeed(ok(undefined)),
    diagnostics: () => Effect.succeed(ok([])),
  };
  const workspaceManifest = workspaceManifestFromSnapshot({
    headRevision: 'a'.repeat(40), files: [], removedPaths: [],
  }, 'scope-v1');
  const state = {
    workspaceId,
    workspaceManifest,
    generation: 1,
    indexKey: 'stable-published',
    candidateIdsByPath: new Map(),
  };
  const delta = { changed: [], added: [], deleted: [], renamed: [], scopeChanged: false };
  const workspaceSync = {
    initialize: () => Effect.succeed(ok(state)),
    refresh: () => Effect.succeed(ok({ state, delta, refreshed: false })),
    refreshExact: (paths: readonly string[]) => {
      exactRefreshes += 1;
      assert.deepEqual(paths, [candidate.repoPath]);
      return Effect.succeed(ok({ state, delta, refreshed: false }));
    },
  };
  let config: Parameters<typeof makeQdrantContextProvider>[0];
  const reconcile = () => {
    reconciles += 1;
    return Effect.succeed(ok(config));
  };
  config = {
    workspaceId, rootPath: '/repo', files, qdrant,
    embeddings: { embedMany: () => Effect.succeed(ok([[0.2, 0.7]])) },
    artifacts, semantics,
    workspaceManifest, workspaceSync, reconcile, qdrantStableCollection: true,
    newRequestId: () => 'initial-stale-retry',
  };
  const result = mustOk(await Effect.runPromise(makeQdrantContextProvider(config).search({
    workspaceId, query: 'reconnect', includeDocs: false, includeMemory: false,
  })));
  assert.equal(searches, 2, 'initial stale hit should cause exactly one retry');
  assert.equal(exactRefreshes, 1);
  assert.equal(reconciles, 1);
  assert.ok(result.evidence.some((item) => item.sourceDigest === candidate.sourceDigest
    && item.freshness === 'current'));
});
