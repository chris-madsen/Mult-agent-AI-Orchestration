import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runner = await readFile('scripts/retrieval-benchmark-runner.ts', 'utf8');
const rankProbe = await readFile('scripts/qdrant-hybrid-rank-probe.ts', 'utf8');

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
  assert.match(runner, /expansionCalls: null/u);
  assert.match(runner, /nativeReadDuplicates: null/u);
  assert.doesNotMatch(runner, /events\.length === 0 \? 0 : 0/u);
});

test('generic runner requires immutable repository revisions and keeps evidence external', () => {
  assert.match(runner, /gitRevision/u);
  assert.match(runner, /revision mismatch/u);
  assert.match(runner, /outputDirectory/u);
  assert.doesNotMatch(runner, /benchmarks[\\/]harbor[\\/]chess/u);
  assert.doesNotMatch(runner, /Chess Trainer/u);
});

test('generic frozen runner requires the provenance-bound compiled MCP and forbids tsx fallback', () => {
  assert.match(runner, /compiled ACE MCP is missing/u);
  assert.match(runner, /dist\/bin\/ace-mcp\.js/u);
  assert.doesNotMatch(runner, /ACE_ALLOW_SOURCE_RUNTIME/u);
  assert.doesNotMatch(runner, /args:\s*\['--import', 'tsx'/u);
});

test('Qdrant rank probe leaves delivery instrumentation unknown', () => {
  assert.match(rankProbe, /expansionCalls: null/u);
  assert.match(rankProbe, /nativeReadDuplicates: null/u);
  assert.doesNotMatch(rankProbe, /expansionCalls: 0/u);
  assert.doesNotMatch(rankProbe, /nativeReadDuplicates: 0/u);
});
