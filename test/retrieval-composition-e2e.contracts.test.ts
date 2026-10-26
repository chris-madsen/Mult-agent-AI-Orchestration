import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { makeQdrantContextProvider } from '../src/adapters/qdrant-context-provider.js';
import { createRetrievalBenchmarkTraceCollector } from '../src/domain/retrieval-benchmark.js';
import { domainError } from '../src/domain/errors.js';
import { makeCandidateId, makeCodeCandidate, type RankedCandidate } from '../src/domain/retrieval.js';
import { err, ok, type Result } from '../src/domain/result.js';
import { makeWorkspaceId, type RepoPath } from '../src/domain/workspace.js';
import type {
  ArtifactStore,
  CodeCandidatePort,
  SemanticAnalysisPort,
  WorkspaceFilePort,
} from '../src/application/ports.js';

const mustOk = <T, E>(value: Result<T, E>): T => {
  assert.equal(value._tag, 'Ok');
  if (value._tag === 'Err') throw new Error(String(value.error));
  return value.value;
};

const workspaceId = mustOk(makeWorkspaceId('retrieval-composition-e2e'));

const fixture = (name: string, suffix: string) => {
  const text = `export function ${name}(): string { return "${suffix}"; }`;
  const repoPath = `src/${name}.ts` as RepoPath;
  const digest = createHash('sha256').update(text).digest('hex');
  const nameStart = 'export function '.length + 1;
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
      byteColumn: nameStart,
      endLine: 1,
      endByteColumn: nameStart + Buffer.byteLength(name, 'utf8'),
    },
    text,
    sourceDigest: digest as never,
    generation: 1 as never,
    indexedAtMs: 1,
  }));
  return { text, repoPath, digest, candidate };
};

const alpha = fixture('alphaHandler', 'alpha');
const beta = fixture('betaHandler', 'beta');
const gamma = fixture('gammaHandler', 'gamma');
const fixtures = new Map([
  [alpha.repoPath, alpha],
  [beta.repoPath, beta],
  [gamma.repoPath, gamma],
]);
let readExactCalls = 0;
let storeExactCalls = 0;
let definitionCalls = 0;
const ranked: readonly RankedCandidate[] = [
  { candidate: beta.candidate, score: 0.9, freshness: 'unknown' },
  { candidate: alpha.candidate, score: 0.8, freshness: 'unknown' },
  { candidate: gamma.candidate, score: 0.7, freshness: 'unknown' },
];

const files: WorkspaceFilePort = {
  canonicalizeRoot: () => Effect.succeed(ok('/repo')),
  snapshot: () => Effect.succeed(err(domainError('NOT_READY', 'snapshot', 'not used by this fixture'))),
  readExact: (_rootPath, repoPath) => {
    readExactCalls += 1;
    const item = fixtures.get(repoPath);
    return item === undefined
      ? Effect.succeed(err(domainError('FILE_NOT_FOUND', repoPath, 'missing fixture')))
      : Effect.succeed(ok({ bytes: Buffer.from(item.text), digest: item.digest as never }));
  },
};

const artifacts: ArtifactStore = {
  storeExact: (bytes) => {
    storeExactCalls += 1;
    const digest = createHash('sha256').update(bytes).digest('hex');
    return Effect.succeed(ok({ handle: `artifact-${digest}`, digest: digest as never, sizeBytes: bytes.length }));
  },
  readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
};

const semantics: SemanticAnalysisPort = {
  definition: (input) => {
    definitionCalls += 1;
    const item = fixtures.get(input.repoPath);
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
    assert.equal(input.queryText, 'betaHandler behavior');
    assert.equal(input.strategy, 'dense');
    return Effect.succeed(ok(ranked));
  },
};

test('dense retrieval composition records LSP-confirmed exact delivery and trace stages', async () => {
  const benchmarkTrace = createRetrievalBenchmarkTraceCollector('repo-a');
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files,
    qdrant,
    embeddings: { embedMany: () => Effect.succeed(ok([[0.2, 0.8]])) },
    artifacts,
    semantics,
    retrievalStrategy: 'dense',
    candidateLimit: 1,
    newRequestId: () => 'replacement-request',
    benchmarkTrace,
    benchmarkRepositoryId: 'repo-a',
    benchmarkProviderIdentities: {
      dense: 'test/dense',
      sparse: 'not-required',
      qdrant: 'test/qdrant',
      structural: 'test/ast-grep',
      semantic: 'test/lsp',
    },
  });

  const result = await Effect.runPromise(provider.search({
    workspaceId,
    query: 'betaHandler behavior',
    includeCode: true,
    includeDocs: false,
    includeMemory: false,
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;

  assert.equal(result.value.evidence.length, 1);
  assert.equal(result.value.evidence[0]?.content, beta.text);
  assert.equal(result.value.evidence[0]?.proofClass, 'direct');
  assert.equal(readExactCalls, 2);
  assert.equal(storeExactCalls, 1);
  assert.equal(definitionCalls, 1);
  assert.deepEqual(
    benchmarkTrace.events.filter((event) => event.status === 'executed').map((event) => event.stage),
    ['dense', 'working_context', 'delivered'],
  );
  assert.deepEqual(benchmarkTrace.stageRanksFor('replacement-request').delivered.length, 1);
});
