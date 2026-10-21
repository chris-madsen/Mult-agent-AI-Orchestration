import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runner = await readFile('scripts/retrieval-benchmark-runner.ts', 'utf8');

test('generic retrieval runner uses the official MCP client and all five frozen strategies', () => {
  assert.match(runner, /@modelcontextprotocol\/client/u);
  assert.match(runner, /StdioClientTransport/u);
  for (const strategy of [
    'sparse',
    'dense',
    'hybrid_rrf',
    'hybrid_reranker',
    'hybrid_reranker_working_context',
  ]) assert.match(runner, new RegExp(`'${strategy}'`, 'u'));
  assert.match(runner, /name: 'ace_context'/u);
  assert.match(runner, /validateRetrievalBenchmarkTraceArtifact/u);
  assert.match(runner, /ACE_BENCHMARK_TRACE_FILE/u);
});

test('generic runner requires immutable repository revisions and keeps evidence external', () => {
  assert.match(runner, /gitRevision/u);
  assert.match(runner, /revision mismatch/u);
  assert.match(runner, /outputDirectory/u);
  assert.doesNotMatch(runner, /benchmarks[\\/]harbor[\\/]chess/u);
  assert.doesNotMatch(runner, /Chess Trainer/u);
});
