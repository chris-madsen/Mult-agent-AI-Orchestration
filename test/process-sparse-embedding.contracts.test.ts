import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeProcessSparseEmbeddingPort } from '../src/adapters/process-sparse-embedding.js';

const workerScript = (model = 'Qdrant/bm25'): string => `
const readline = require('node:readline');
process.stdout.write(JSON.stringify({
  type: 'ready',
  identity: {
    provider: 'fixture/sparse',
    model: ${JSON.stringify(model)},
    preprocessing: 'fixture-bm25-v1',
    artifactDigest: 'a'.repeat(64),
    runtimeBuild: 'fixture-worker#abc',
    runtimeVersion: 'node/fixture',
  },
}) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const vectors = request.texts.map((text, index) => ({
    indices: request.mode === 'query' ? [10 + index] : [20 + index, 30 + index],
    values: request.mode === 'query' ? [1] : [0.5, 0.25],
  }));
  process.stdout.write(JSON.stringify({ id: request.id, vectors }) + '\\n');
});
`;

test('process sparse embedding exposes identity and distinct document/query modes', async () => {
  const port = makeProcessSparseEmbeddingPort({
    command: process.execPath,
    args: ['-e', workerScript()],
    expectedModel: 'Qdrant/bm25',
    timeoutMs: 5_000,
  });
  try {
    assert.equal((await Effect.runPromise(port.probe()))._tag, 'Ok');
    assert.deepEqual(port.identity(), {
      provider: 'fixture/sparse',
      model: 'Qdrant/bm25',
      preprocessing: 'fixture-bm25-v1',
      artifactDigest: 'a'.repeat(64),
      runtimeBuild: 'fixture-worker#abc',
      runtimeVersion: 'node/fixture',
    });
    const documents = await Effect.runPromise(port.embedDocuments(['alpha', 'beta']));
    assert.deepEqual(documents, {
      _tag: 'Ok',
      value: [
        { indices: [20, 30], values: [0.5, 0.25] },
        { indices: [21, 31], values: [0.5, 0.25] },
      ],
    });
    const queries = await Effect.runPromise(port.embedQueries(['alpha']));
    assert.deepEqual(queries, {
      _tag: 'Ok',
      value: [{ indices: [10], values: [1] }],
    });
  } finally {
    port.close();
  }
});

test('process sparse embedding fails closed on model mismatch', async () => {
  const port = makeProcessSparseEmbeddingPort({
    command: process.execPath,
    args: ['-e', workerScript('fixture/wrong')],
    expectedModel: 'Qdrant/bm25',
    timeoutMs: 5_000,
  });
  try {
    const result = await Effect.runPromise(port.probe());
    assert.equal(result._tag, 'Err');
    if (result._tag === 'Err') assert.equal(result.error.path, 'sparse_embedding.identity');
  } finally {
    port.close();
  }
});

test('process sparse embedding rejects malformed sparse vectors', async () => {
  const script = `
process.stdout.write(JSON.stringify({
  type: 'ready',
  identity: {
    provider: 'fixture/sparse',
    model: 'Qdrant/bm25',
    preprocessing: 'fixture',
    artifactDigest: 'a'.repeat(64),
    runtimeBuild: 'b',
    runtimeVersion: 'v',
  },
}) + '\\n');
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    id: request.id,
    vectors: [{ indices: [1, 1], values: [1, 0.5] }],
  }) + '\\n');
});
`;
  const port = makeProcessSparseEmbeddingPort({
    command: process.execPath,
    args: ['-e', script],
    expectedModel: 'Qdrant/bm25',
    timeoutMs: 5_000,
  });
  try {
    const result = await Effect.runPromise(port.embedQueries(['query']));
    assert.equal(result._tag, 'Err');
    if (result._tag === 'Err') assert.equal(result.error.path, 'sparse_embedding.vectors[0]');
  } finally {
    port.close();
  }
});
