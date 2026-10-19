import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import {
  ensureQdrantCollection,
  hasExactQdrantSnapshot,
  reuseOrPopulateQdrantSnapshot,
  makeQdrantContextProvider,
  populateQdrantFromStructuralIndex,
} from '../src/adapters/qdrant-context-provider.js';
import { createCodeIndex, makeCandidateId, makeCodeCandidate } from '../src/domain/retrieval.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { err, ok, type Result } from '../src/domain/result.js';
import { domainError } from '../src/domain/errors.js';
import type {
  ArtifactStore,
  CodeCandidatePort,
  DocumentationPort,
  HttpPort,
  SemanticAnalysisPort,
  WorkspaceFilePort,
} from '../src/application/ports.js';

const mustOk = <T, E>(value: Result<T, E>): T => {
  assert.equal(value._tag, 'Ok');
  if (value._tag === 'Err') throw new Error(String(value.error));
  return value.value;
};

const workspaceId = mustOk(makeWorkspaceId('real-pipeline-fixture'));
const source = Buffer.from('export function reconnect(): string { return "ok"; }\n');
const digest = createHash('sha256').update(source).digest('hex');
const candidate = mustOk(makeCodeCandidate({
  candidateId: mustOk(makeCandidateId('function-reconnect')),
  workspaceId, repoPath: 'src/connection.ts' as never,
  range: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 53 },
  symbolName: 'reconnect',
  text: source.toString('utf8').trim(),
  sourceDigest: digest as never,
  generation: 1 as never,
  indexedAtMs: 1234,
  conflictKey: 'reconnect-policy',
  conflictValue: 'current code retries immediately',
}));

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
  assert.equal((await Effect.runPromise(ensureQdrantCollection(http, 'http://127.0.0.1:6333', 'ace-test', 2)))._tag, 'Ok');
  assert.deepEqual(requests, ['GET', 'PUT']);

  const wrong: HttpPort = {
    request: () => Effect.succeed(ok({ status: 200, body: { result: { config: { params: { vectors: { size: 64 } } } } } })),
  };
  assert.equal((await Effect.runPromise(ensureQdrantCollection(wrong, 'http://127.0.0.1:6333', 'ace-test', 2)))._tag, 'Err');
});

test('warm Qdrant snapshot reuse does not re-embed or upsert current source', async () => {
  let requests = 0;
  let upserts = 0;
  let embeds = 0;
  const http: HttpPort = {
    request: (request) => {
      requests += 1;
      assert.equal(request.url.endsWith('/points/count'), true);
      assert.deepEqual((request.body?.filter as { must: unknown[] }).must, [
        { key: 'workspace_id', match: { value: workspaceId } },
        { key: 'index_key', match: { value: 'snapshot-digest' } },
      ]);
      return Effect.succeed(ok({ status: 200, body: { result: { count: 1 } } }));
    },
  };
  const qdrant: CodeCandidatePort = {
    upsert: () => { upserts += 1; return Effect.succeed(ok(undefined)); },
    search: () => Effect.succeed(ok([])),
  };
  const embeddings = {
    embedMany: (_input: readonly string[]) => { embeds += 1; return Effect.succeed(ok([[1, 2]])); },
  };
  const index = mustOk(createCodeIndex(1, [candidate]));
  const ready = mustOk(await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
    index, qdrant, embeddings, http, 'http://127.0.0.1:6333', 'ace-test', workspaceId, 'snapshot-digest',
  )));
  assert.deepEqual(ready, { count: 1, reused: true });
  assert.equal(requests, 1);
  assert.equal(upserts, 0);
  assert.equal(embeds, 0);
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
  const http: HttpPort = { request: () => Effect.succeed(ok({ status: 200, body: { result: { count: 0 } } })) };
  const rebuilt = mustOk(await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
    index, qdrant, embeddings, http, 'http://127.0.0.1:6333', 'ace-test', workspaceId, 'snapshot-digest',
  )));
  assert.deepEqual(rebuilt, { count: 1, reused: false });
  assert.equal(upserts, 1);
  const offline: HttpPort = { request: () => Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'offline'))) };
  const failed = await Effect.runPromise(hasExactQdrantSnapshot(
    offline, 'http://127.0.0.1:6333', 'ace-test', workspaceId, 'snapshot-digest', 1,
  ));
  assert.equal(failed._tag, 'Err');
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
  const provider = makeQdrantContextProvider({
    workspaceId, rootPath: '/repo', files, qdrant, embeddings, artifacts, semantics, newRequestId: () => 'qdrant-request',
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
  assert.equal(context.evidence[0]?.content, source.toString('utf8').trim());
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
  assert.ok(context.warnings.some((warning) => warning.includes('documentation and current code disagree')));
});
