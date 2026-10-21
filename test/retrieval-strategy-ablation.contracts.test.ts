import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeQdrantContextProvider } from '../src/adapters/qdrant-context-provider.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok, type Result } from '../src/domain/result.js';
import type {
  ArtifactStore,
  CodeCandidatePort,
  SemanticAnalysisPort,
  VectorEmbeddingPort,
  WorkspaceFilePort,
} from '../src/application/ports.js';

const mustOk = <T, E>(value: Result<T, E>): T => {
  assert.equal(value._tag, 'Ok');
  if (value._tag === 'Err') throw new Error(String(value.error));
  return value.value;
};

const workspaceId = mustOk(makeWorkspaceId('retrieval-strategy-ablation'));

const unusedFiles: WorkspaceFilePort = {
  canonicalizeRoot: () => { throw new Error('not used'); },
  snapshot: () => { throw new Error('not used'); },
  readExact: () => { throw new Error('not used'); },
};

const unusedArtifacts: ArtifactStore = {
  storeExact: () => { throw new Error('not used'); },
  readRange: () => { throw new Error('not used'); },
};

const unusedSemantics: SemanticAnalysisPort = {
  definition: () => { throw new Error('not used'); },
  references: () => { throw new Error('not used'); },
  typeInfo: () => { throw new Error('not used'); },
  diagnostics: () => { throw new Error('not used'); },
};

test('sparse strategy does not invoke dense embedding inference', async () => {
  let embeddingCalls = 0;
  let observedSearch: unknown;
  const embeddings: VectorEmbeddingPort = {
    embedMany: () => {
      embeddingCalls += 1;
      return Effect.succeed(ok([[0.1, 0.2]]));
    },
  };
  const qdrant: CodeCandidatePort = {
    search: (input) => {
      observedSearch = input;
      return Effect.succeed(ok([]));
    },
    upsert: () => Effect.succeed(ok(undefined)),
  };
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files: unusedFiles,
    qdrant,
    embeddings,
    artifacts: unusedArtifacts,
    semantics: unusedSemantics,
    newRequestId: () => 'sparse-ablation-request',
    retrievalStrategy: 'sparse',
  });
  const result = await Effect.runPromise(provider.search({
    workspaceId,
    query: 'ACE_QDRANT_URL',
    includeDocs: false,
    includeMemory: false,
  }));
  assert.equal(result._tag, 'Ok');
  assert.equal(embeddingCalls, 0);
  assert.deepEqual(observedSearch, {
    workspaceId,
    queryText: 'ACE_QDRANT_URL',
    strategy: 'sparse',
    limit: 6,
    requestId: 'sparse-ablation-request',
  });
});

test('dense and hybrid strategies invoke dense embeddings and forward the configured strategy', async () => {
  for (const strategy of ['dense', 'hybrid_rrf'] as const) {
    let embeddingCalls = 0;
    let observedSearch: unknown;
    const embeddings: VectorEmbeddingPort = {
      embedMany: () => {
        embeddingCalls += 1;
        return Effect.succeed(ok([[0.25, 0.75]]));
      },
    };
    const qdrant: CodeCandidatePort = {
      search: (input) => {
        observedSearch = input;
        return Effect.succeed(ok([]));
      },
      upsert: () => Effect.succeed(ok(undefined)),
    };
    const provider = makeQdrantContextProvider({
      workspaceId,
      rootPath: '/repo',
      files: unusedFiles,
      qdrant,
      embeddings,
      artifacts: unusedArtifacts,
      semantics: unusedSemantics,
      newRequestId: () => `${strategy}-request`,
      retrievalStrategy: strategy,
    });
    const result = await Effect.runPromise(provider.search({
      workspaceId,
      query: 'find retry behavior',
      includeDocs: false,
      includeMemory: false,
    }));
    assert.equal(result._tag, 'Ok');
    assert.equal(embeddingCalls, 1);
    assert.deepEqual(observedSearch, {
      workspaceId,
      vector: [0.25, 0.75],
      queryText: 'find retry behavior',
      strategy,
      limit: 6,
      requestId: `${strategy}-request`,
    });
  }
});
