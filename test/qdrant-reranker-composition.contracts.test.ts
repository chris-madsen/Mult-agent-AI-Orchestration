import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { makeQdrantContextProvider } from '../src/adapters/qdrant-context-provider.js';
import { domainError } from '../src/domain/errors.js';
import { makeCandidateId, makeCodeCandidate, type RankedCandidate } from '../src/domain/retrieval.js';
import { err, ok, type Result } from '../src/domain/result.js';
import { makeWorkspaceId, type RepoPath } from '../src/domain/workspace.js';
import { createRetrievalBenchmarkTraceCollector } from '../src/domain/retrieval-benchmark.js';
import type {
  ArtifactStore,
  CodeCandidatePort,
  RerankerPort,
  SemanticAnalysisPort,
  WorkspaceFilePort,
} from '../src/application/ports.js';

const mustOk = <T, E>(value: Result<T, E>): T => {
  assert.equal(value._tag, 'Ok');
  if (value._tag === 'Err') throw new Error(String(value.error));
  return value.value;
};

const workspaceId = mustOk(makeWorkspaceId('reranker-composition'));

const fixture = (name: string, suffix: string) => {
  const text = `export function ${name}(): string { return "${suffix}"; }`;
  const repoPath = `src/${name}.ts` as RepoPath;
  const digest = createHash('sha256').update(text).digest('hex');
  const start = 'export function '.length + 1;
  const candidate = mustOk(makeCodeCandidate({
    candidateId: mustOk(makeCandidateId(name)),
    workspaceId,
    repoPath,
    range: {
      startLine: 1,
      endLine: 1,
      startColumn: 1,
      endColumn: Buffer.byteLength(text, 'utf8') + 1,
    },
    symbolName: name,
    semanticAnchor: {
      line: 1,
      byteColumn: start,
      endLine: 1,
      endByteColumn: start + Buffer.byteLength(name, 'utf8'),
    },
    text,
    sourceDigest: digest as never,
    generation: 1 as never,
    indexedAtMs: 1,
  }));
  return { text, repoPath, digest, candidate };
};

const first = fixture('alphaHandler', 'alpha');
const second = fixture('betaHandler', 'beta');
const third = fixture('gammaHandler', 'gamma');
const ranked: readonly RankedCandidate[] = [
  { candidate: first.candidate, score: 0.9, freshness: 'unknown' },
  { candidate: second.candidate, score: 0.8, freshness: 'unknown' },
  { candidate: third.candidate, score: 0.7, freshness: 'unknown' },
];

const filesByPath = new Map([
  [first.repoPath, first],
  [second.repoPath, second],
  [third.repoPath, third],
]);

const files: WorkspaceFilePort = {
  canonicalizeRoot: () => Effect.succeed(ok('/repo')),
  snapshot: () => { throw new Error('snapshot not needed without a configured workspace manifest'); },
  readExact: (_rootPath, repoPath) => {
    const item = filesByPath.get(repoPath);
    return item === undefined
      ? Effect.succeed(err(domainError('FILE_NOT_FOUND', repoPath, 'missing fixture')))
      : Effect.succeed(ok({ bytes: Buffer.from(item.text), digest: item.digest as never }));
  },
};

const artifacts: ArtifactStore = {
  storeExact: (bytes) => Effect.succeed(ok({
    handle: 'artifact-' + createHash('sha256').update(bytes).digest('hex'),
    digest: createHash('sha256').update(bytes).digest('hex') as never,
    sizeBytes: bytes.length,
  })),
  readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
};

const semantics: SemanticAnalysisPort = {
  definition: (input) => {
    const item = [...filesByPath.values()].find((fixtureItem) => fixtureItem.repoPath === input.repoPath);
    if (item === undefined) return Effect.succeed(ok([]));
    const anchor = item.candidate.semanticAnchor;
    return Effect.succeed(ok(anchor === undefined ? [] : [{
      location: {
        repoPath: item.repoPath,
        startLine: anchor.line,
        startColumn: input.column,
        endLine: anchor.endLine,
        endColumn: input.column + (item.candidate.symbolName?.length ?? 0),
      },
      name: item.candidate.symbolName,
      kind: 'function',
    }]));
  },
  references: () => Effect.succeed(ok([])),
  typeInfo: () => Effect.succeed(ok(undefined)),
  diagnostics: () => Effect.succeed(ok([])),
};

const qdrant: CodeCandidatePort = {
  upsert: () => Effect.succeed(ok(undefined)),
  search: (input) => {
    assert.equal(input.queryText, 'find beta behavior');
    assert.equal(input.limit, 8, 'reranker receives a wider fused shortlist before delivery trimming');
    return Effect.succeed(ok(ranked));
  },
};

test('configured reranker reorders the fused shortlist before exact source/LSP verification', async () => {
  const benchmarkTrace = createRetrievalBenchmarkTraceCollector('ace');
  const reranker: RerankerPort = {
    rerank: (input) => {
      assert.equal(input.documents.length, 3);
      assert.ok(input.documents[1]?.includes('betaHandler'));
      return Effect.succeed(ok([
        { index: 1, score: 0.99 },
        { index: 2, score: 0.5 },
        { index: 0, score: 0.1 },
      ]));
    },
  };
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files,
    qdrant,
    embeddings: { embedMany: () => Effect.succeed(ok([[0.2, 0.8]])) },
    artifacts,
    semantics,
    reranker,
    rerankerMode: 'optional',
    rerankerCandidateLimit: 8,
    candidateLimit: 2,
    newRequestId: () => 'reranked-request',
    benchmarkTrace,
    benchmarkRepositoryId: 'ace',
    benchmarkProviderIdentities: { dense: 'test/dense', sparse: 'test/sparse', reranker: 'test/reranker' },
  });
  const result = await Effect.runPromise(provider.search({
    workspaceId,
    query: 'find beta behavior',
    includeDocs: false,
    includeMemory: false,
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.evidence.length, 2);
  assert.equal(result.value.evidence[0]?.content, second.text);
  assert.equal(result.value.evidence[1]?.content, third.text);
  assert.deepEqual(
    benchmarkTrace.events.filter((event) => event.status === 'executed').map((event) => event.stage),
    ['dense', 'working_context', 'reranked', 'delivered'],
  );
  assert.equal(
    benchmarkTrace.events.find((event) => event.status === 'executed')?.candidates[0]?.runtimeCandidateId,
    first.candidate.candidateId,
  );
  assert.equal(benchmarkTrace.stageRanksFor('reranked-request').delivered.length, 2);
});

test('optional reranker outage falls back to fused ranking and reports degradation', async () => {
  const reranker: RerankerPort = {
    rerank: () => Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'reranker', 'offline'))),
  };
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files,
    qdrant,
    embeddings: { embedMany: () => Effect.succeed(ok([[0.2, 0.8]])) },
    artifacts,
    semantics,
    reranker,
    rerankerMode: 'optional',
    rerankerCandidateLimit: 8,
    candidateLimit: 2,
    newRequestId: () => 'optional-reranker-outage',
  });
  const result = await Effect.runPromise(provider.search({
    workspaceId,
    query: 'find beta behavior',
    includeDocs: false,
    includeMemory: false,
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.evidence[0]?.content, first.text);
  assert.ok(result.value.warnings.some((warning) => warning.includes('reranker unavailable')));
});

test('required reranker outage fails the code branch closed', async () => {
  const reranker: RerankerPort = {
    rerank: () => Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'reranker', 'offline'))),
  };
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files,
    qdrant,
    embeddings: { embedMany: () => Effect.succeed(ok([[0.2, 0.8]])) },
    artifacts,
    semantics,
    reranker,
    rerankerMode: 'required',
    rerankerCandidateLimit: 8,
    candidateLimit: 2,
    newRequestId: () => 'required-reranker-outage',
  });
  const result = await Effect.runPromise(provider.search({
    workspaceId,
    query: 'find beta behavior',
    includeDocs: false,
    includeMemory: false,
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') {
    assert.equal(result.error.code, 'EXTERNAL_UNAVAILABLE');
    assert.equal(result.error.path, 'reranker');
  }
});
