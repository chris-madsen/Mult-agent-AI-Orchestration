import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeProcessRerankerPort } from '../src/adapters/process-reranker.js';

const workerScript = (model = 'fixture/reranker'): string => `
const readline = require('node:readline');
process.stdout.write(JSON.stringify({
  type: 'ready',
  identity: {
    provider: 'fixture/cross-encoder',
    model: ${JSON.stringify(model)},
    runtimeBuild: 'fixture-worker#abc',
    runtimeVersion: 'node/fixture',
  },
}) + '\\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const request = JSON.parse(line);
  const scores = request.documents.map((document, index) =>
    document.includes('best') ? 0.95 : 0.2 + index * 0.01);
  process.stdout.write(JSON.stringify({ id: request.id, scores }) + '\\n');
});
`;

test('process reranker exposes worker identity and returns sorted document scores', async () => {
  const port = makeProcessRerankerPort({
    command: process.execPath,
    args: ['-e', workerScript()],
    expectedModel: 'fixture/reranker',
    timeoutMs: 5_000,
  });
  try {
    const probe = await Effect.runPromise(port.probe());
    assert.equal(probe._tag, 'Ok');
    assert.deepEqual(port.identity(), {
      provider: 'fixture/cross-encoder',
      model: 'fixture/reranker',
      runtimeBuild: 'fixture-worker#abc',
      runtimeVersion: 'node/fixture',
    });
    const ranked = await Effect.runPromise(port.rerank({
      query: 'find best',
      documents: ['ordinary', 'best document', 'other'],
      requestId: 'rerank-request',
    }));
    assert.equal(ranked._tag, 'Ok');
    if (ranked._tag === 'Ok') {
      assert.deepEqual(ranked.value, [
        { index: 1, score: 0.95 },
        { index: 2, score: 0.22 },
        { index: 0, score: 0.2 },
      ]);
    }
  } finally {
    port.close();
  }
});

test('process reranker fails closed on configured model mismatch', async () => {
  const port = makeProcessRerankerPort({
    command: process.execPath,
    args: ['-e', workerScript('fixture/wrong')],
    expectedModel: 'fixture/reranker',
    timeoutMs: 5_000,
  });
  try {
    const probe = await Effect.runPromise(port.probe());
    assert.equal(probe._tag, 'Err');
    if (probe._tag === 'Err') assert.equal(probe.error.code, 'INVALID_EXTERNAL_RESPONSE');
  } finally {
    port.close();
  }
});

test('process reranker validates score cardinality and values', async () => {
  const script = `
process.stdout.write(JSON.stringify({
  type: 'ready',
  identity: { provider: 'fixture', model: 'fixture/reranker', runtimeBuild: 'b', runtimeVersion: 'v' },
}) + '\\n');
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id: request.id, scores: [0.5] }) + '\\n');
});
`;
  const port = makeProcessRerankerPort({
    command: process.execPath,
    args: ['-e', script],
    expectedModel: 'fixture/reranker',
    timeoutMs: 5_000,
  });
  try {
    const result = await Effect.runPromise(port.rerank({
      query: 'query',
      documents: ['one', 'two'],
    }));
    assert.equal(result._tag, 'Err');
    if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_EXTERNAL_RESPONSE');
  } finally {
    port.close();
  }
});

test('process reranker does not forward arbitrary secret environment variables', async () => {
  const script = `
if (process.env.OPENAI_API_KEY !== undefined || process.env.ACE_RERANKER_SECRET !== undefined) process.exit(23);
${workerScript()}
`;
  const port = makeProcessRerankerPort({
    command: process.execPath,
    args: ['-e', script],
    expectedModel: 'fixture/reranker',
    env: {
      OPENAI_API_KEY: 'must-not-cross-boundary',
      ACE_RERANKER_SECRET: 'must-not-cross-boundary',
    },
    timeoutMs: 5_000,
  });
  try {
    const probe = await Effect.runPromise(port.probe());
    assert.equal(probe._tag, 'Ok');
  } finally {
    port.close();
  }
});
