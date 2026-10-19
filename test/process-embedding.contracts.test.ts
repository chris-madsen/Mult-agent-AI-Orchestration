import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
  makeProcessEmbeddingPort,
  type ResolvedEmbeddingConfig,
} from '../src/adapters/process-embedding.js';

const digest = 'a'.repeat(64);
const expected: ResolvedEmbeddingConfig = {
  provider: 'fixture/provider',
  model: 'fixture/model',
  modelRevision: 'model-r1',
  artifactModel: 'fixture/artifact',
  artifactRevision: 'artifact-r1',
  artifactDigest: digest,
  dimension: 2,
  preprocessing: 'raw_text_v1',
};

const workerScript = (model = expected.model): string => `
const readline = require('node:readline');
const identity = {
  provider: 'fixture/provider',
  model: ${JSON.stringify(model)},
  modelRevision: 'model-r1',
  artifactModel: 'fixture/artifact',
  artifactRevision: 'artifact-r1',
  artifactDigest: '${digest}',
  dimension: 2,
  preprocessing: 'raw_text_v1',
  runtime: 'fixture-runtime/1',
};
process.stdout.write(JSON.stringify({ type: 'ready', identity }) + '\\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const request = JSON.parse(line);
  const vectors = request.texts.map(() => [0.25, 0.75]);
  process.stdout.write(JSON.stringify({ id: request.id, vectors }) + '\\n');
});
`;

test('embedding process requires and exposes a matching effective worker identity', async () => {
  const port = makeProcessEmbeddingPort({
    command: process.execPath,
    args: ['-e', workerScript()],
    dimension: 2,
    expectedIdentity: expected,
    timeoutMs: 5_000,
  });
  try {
    const probe = await Effect.runPromise(port.probe());
    assert.equal(probe._tag, 'Ok');
    assert.deepEqual(port.identity(), { ...expected, runtime: 'fixture-runtime/1' });
    const embedded = await Effect.runPromise(port.embedMany(['hello']));
    assert.equal(embedded._tag, 'Ok');
    if (embedded._tag === 'Ok') assert.deepEqual(embedded.value, [[0.25, 0.75]]);
  } finally {
    port.close();
  }
});

test('embedding process fails closed when worker receipt names a different model', async () => {
  const port = makeProcessEmbeddingPort({
    command: process.execPath,
    args: ['-e', workerScript('fixture/wrong-model')],
    dimension: 2,
    expectedIdentity: expected,
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
