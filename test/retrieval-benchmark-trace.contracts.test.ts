import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeFileRetrievalBenchmarkTrace } from '../src/adapters/retrieval-benchmark-trace.js';
import {
  retrievalBenchmarkStages,
  validateRetrievalBenchmarkTraceArtifact,
  type RetrievalBenchmarkTraceEvent,
  type RetrievalBenchmarkTraceSink,
} from '../src/domain/retrieval-benchmark.js';
import { createAceServer } from '../src/transport/mcp-sdk-stdio.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

const candidate = {
  runtimeCandidateId: 'workspace-candidate',
  canonicalCandidateId: 'canonical-candidate',
  repoPath: 'src/example.ts',
  sourceDigest: 'a'.repeat(64),
  range: { startLine: 1, endLine: 1 },
};

const eventFor = (
  requestId: string,
  stage: RetrievalBenchmarkTraceEvent['stage'],
  status: NonNullable<RetrievalBenchmarkTraceEvent['status']> = 'executed',
): RetrievalBenchmarkTraceEvent => ({
  requestId,
  stage,
  status,
  candidates: status === 'executed' ? [candidate] : [],
  durationMs: 1,
  providerIdentities: { dense: 'test-provider' },
});

const allStageEvents = (requestId: string): readonly RetrievalBenchmarkTraceEvent[] =>
  retrievalBenchmarkStages.map((stage) => eventFor(requestId, stage));

const withTempDirectory = async <T>(run: (directory: string) => Promise<T>): Promise<T> => {
  const directory = await mkdtemp(join(tmpdir(), 'ace-benchmark-trace-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('file trace drains JSONL and writes a complete terminal receipt', async () => {
  await withTempDirectory(async (directory) => {
    const trace = await makeFileRetrievalBenchmarkTrace(join(directory, 'run.jsonl'), {
      sourceCommit: 'a'.repeat(40),
      runnerVersion: 'test-runner/1',
    });
    for (const event of allStageEvents('request-1')) trace.record(event);
    await trace.flush();
    assert.equal(trace.status.recordedEvents, retrievalBenchmarkStages.length);
    assert.equal(trace.status.persistedEvents, retrievalBenchmarkStages.length);
    const jsonl = await readFile(trace.tracePath, 'utf8');
    assert.equal(jsonl.trim().split('\n').length, retrievalBenchmarkStages.length);
    await trace.close();
    await trace.close();
    assert.equal(trace.status.state, 'closed');
    const receipt = JSON.parse(await readFile(trace.terminalReceiptPath, 'utf8')) as unknown;
    const validation = validateRetrievalBenchmarkTraceArtifact(jsonl, receipt, ['request-1']);
    assert.equal(validation.valid, true, validation.failures.join(', '));
    assert.doesNotMatch(jsonl, /query|content|token|sourceBytes/u);
  });
});

test('file trace record and close remain observable after append failure', async () => {
  await withTempDirectory(async (directory) => {
    const path = join(directory, 'failing.jsonl');
    const trace = await makeFileRetrievalBenchmarkTrace(path);
    await rm(path);
    await mkdir(path);
    trace.record(eventFor('request-1', 'dense'));
    await assert.rejects(trace.flush(), /benchmark trace persistence failed/u);
    assert.equal(trace.status.state, 'failed');
    assert.equal(trace.status.persistedEvents, 0);
    assert.throws(() => trace.record(eventFor('request-1', 'sparse')), /benchmark trace persistence failed/u);
    await assert.rejects(trace.close(), /benchmark trace persistence failed/u);
    const receipt = JSON.parse(await readFile(trace.terminalReceiptPath, 'utf8')) as { flushStatus: string; closeStatus: string };
    assert.equal(receipt.flushStatus, 'failed');
    assert.equal(receipt.closeStatus, 'ok');
  });
});

test('file trace rejects an unwritable trace target before a run starts', async () => {
  await withTempDirectory(async (directory) => {
    await assert.rejects(
      makeFileRetrievalBenchmarkTrace(directory),
    );
  });
});

test('trace evaluator rejects missing terminal receipt, incomplete stages, and corrupt JSONL', async () => {
  await withTempDirectory(async (directory) => {
    const trace = await makeFileRetrievalBenchmarkTrace(join(directory, 'partial.jsonl'));
    trace.record(eventFor('request-1', 'dense'));
    await trace.close();
    const jsonl = await readFile(trace.tracePath, 'utf8');
    const receipt = JSON.parse(await readFile(trace.terminalReceiptPath, 'utf8')) as unknown;
    const incomplete = validateRetrievalBenchmarkTraceArtifact(jsonl, receipt, ['request-1']);
    assert.equal(incomplete.valid, false);
    assert.ok(incomplete.failures.includes('request_request-1_stage_completeness'));
    assert.equal(validateRetrievalBenchmarkTraceArtifact(jsonl, undefined).valid, false);
    assert.equal(validateRetrievalBenchmarkTraceArtifact(jsonl + '{', receipt).valid, false);
  });
});

test('trace persistence failure turns an MCP request into a safe error', async () => {
  const status = { state: 'failed' as const, recordedEvents: 1, persistedEvents: 0, failureCode: 'trace_persistence_failed' as const };
  const trace: RetrievalBenchmarkTraceSink = {
    record: () => undefined,
    flush: async () => { throw new Error('must not be exposed'); },
    close: async () => undefined,
    status,
  };
  const server = createAceServer({
    handle: () => Effect.succeed({
      status: 'ok' as const,
      result: { status: 'ok', query: 'private query' },
    }),
  }, { benchmarkTrace: trace });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'trace-test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: 'ace_workspace_status',
      arguments: { workspace_id: 'workspace-1' },
    });
    assert.equal(response.isError, true);
    assert.equal((response.structuredContent as { code?: string }).code, 'BENCHMARK_TRACE_FAILURE');
    assert.doesNotMatch(JSON.stringify(response), /private query|must not be exposed/u);
  } finally {
    await client.close();
    await server.close();
  }
});
