#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnRealProviderProcess, stopRealProviderProcess } from './real-provider-process.mjs';
import { resolveRealProviderRuntime } from './real-provider-runtime.mjs';

const runtime = await resolveRealProviderRuntime(import.meta.dirname);
const root = await mkdtemp(join(tmpdir(), 'ace-restart-provider-'));
const workspace = join(root, 'workspace');
const state = join(root, 'state');
await mkdir(workspace);
const sourcePath = join(workspace, 'versioned.ts');
const workspaceId = `real-provider-restart-${randomUUID()}`;
const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
const publishedCollections = new Set();

const digest = async () => createHash('sha256').update(await readFile(sourcePath)).digest('hex');

const runOnce = () => new Promise((resolveRun, rejectRun) => {
  const child = spawnRealProviderProcess(process.execPath, [runtime.executable], {
    cwd: runtime.runtimeRoot,
    env: {
      ...process.env,
      ACE_RUNTIME_ROOT: runtime.runtimeRoot,
      ACE_WORKSPACE_ROOT: workspace,
      ACE_ALLOWED_ROOTS: root,
      ACE_STATE_DIR: state,
      ACE_WORKSPACE_ID: workspaceId,
      ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
      ACE_RETRIEVAL_STRATEGY: process.env.ACE_RETRIEVAL_STRATEGY?.trim() || 'dense',
      ACE_QDRANT_URL: qdrantUrl,
      ACE_EMBEDDING_WORKER: process.env.ACE_EMBEDDING_WORKER ?? runtime.embeddingWorker,
      ACE_AST_GREP_COMMAND: process.env.ACE_AST_GREP_COMMAND ?? runtime.astGrepCommand,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const responses = new Map();
  const waiters = new Map();
  let settled = false;
  const fail = (cause) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const error = cause instanceof Error ? cause : new Error(String(cause));
    for (const waiter of waiters.values()) waiter.reject(error);
    waiters.clear();
    void stopRealProviderProcess(child).then(
      () => rejectRun(error),
      (stopError) => rejectRun(new AggregateError([error, stopError], 'restart MCP failed and cleanup was incomplete')),
    );
  };
  const timer = setTimeout(() => {
    fail(new Error(`restart MCP request timed out: ${stderr.slice(-2000)}`));
  }, 180_000);
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
    for (;;) {
      const newline = stdout.indexOf('\n');
      if (newline < 0) break;
      let message;
      try {
        message = JSON.parse(stdout.slice(0, newline));
      } catch (cause) {
        fail(new Error(`restart MCP emitted malformed JSON: ${String(cause)}`));
        return;
      }
      stdout = stdout.slice(newline + 1);
      const waiter = waiters.get(message.id);
      if (waiter !== undefined) {
        waiters.delete(message.id);
        waiter.resolve(message);
      } else responses.set(message.id, message);
    }
  });
  child.once('error', fail);
  child.once('exit', (code, signal) => {
    fail(new Error(`restart MCP exited before response code=${code} signal=${signal}: ${stderr.slice(-2000)}`));
  });
  child.stdin.on('error', fail);
  const request = (id, message) => new Promise((resolveRequest, rejectRequest) => {
    const existing = responses.get(id);
    if (existing !== undefined) {
      responses.delete(id);
      resolveRequest(existing);
      return;
    }
    waiters.set(id, { resolve: resolveRequest, reject: rejectRequest });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
  void (async () => {
    try {
      await request(1, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'ace-restart-e2e', version: '1' } } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      const response = await request(2, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ace_context', arguments: { workspace_id: workspaceId, query: 'current value' } } });
      settled = true;
      clearTimeout(timer);
      try {
        await stopRealProviderProcess(child);
      } catch (error) {
        rejectRun(error);
        return;
      }
      resolveRun({ response, stderr });
    } catch (error) {
      fail(error);
    }
  })();
});

try {
  await writeFile(sourcePath, 'export function currentValue() { return "D1"; }\n');
  const firstDigest = await digest();
  const first = await runOnce();
  const firstContext = first.response.result?.structuredContent;
  assert.equal(first.response.result?.isError, undefined, JSON.stringify(first.response));
  assert.equal(firstContext.complete, true, JSON.stringify(firstContext));
  assert.equal(firstContext.evidence[0]?.sourceDigest, firstDigest);
  const metricsFrom = (stderr, generation) => {
    const line = stderr.split('\n').find((item) => item.includes(`generation=${generation} `));
    assert.ok(line, stderr);
    const value = (name) => {
      const match = new RegExp(`${name}=([^\\s]+)`, 'u').exec(line)?.[1];
      assert.ok(match, line);
      return match;
    };
    const metrics = {
      collection: value('collection'),
      publicationMode: value('publication_mode'),
      indexKey: value('index_key'),
      sourceSnapshotDigest: value('source_snapshot_digest'),
      indexMode: value('index_mode'),
    };
    publishedCollections.add(metrics.collection);
    return metrics;
  };
  const firstMetrics = metricsFrom(first.stderr, 1);

  // Unchanged checkout: observationEpoch still advances, but the exact
  // content-derived snapshot must reuse already persisted Qdrant vectors.
  const warm = await runOnce();
  const warmContext = warm.response.result?.structuredContent;
  assert.equal(warm.response.result?.isError, undefined, JSON.stringify({ response: warm.response, stderr: warm.stderr }));
  assert.equal(warmContext.complete, true, JSON.stringify(warmContext));
  assert.equal(warmContext.evidence[0]?.sourceDigest, firstDigest);
  assert.match(warm.stderr, /generation=2 .*index_mode=warm_reused/u,
    'unchanged checkout must not re-embed on the next MCP process');
  const warmMetrics = metricsFrom(warm.stderr, 2);
  assert.equal(warmMetrics.collection, firstMetrics.collection,
    'unchanged checkout must reuse the content-addressed collection');
  assert.equal(warmMetrics.indexKey, firstMetrics.indexKey);

  await writeFile(sourcePath, 'export function currentValue() { return "D2"; }\n');
  const secondDigest = await digest();
  const second = await runOnce();
  const secondContext = second.response.result?.structuredContent;
  assert.equal(second.response.result?.isError, undefined, JSON.stringify(second.response));
  assert.equal(secondContext.complete, true, JSON.stringify({ context: secondContext, stderr: second.stderr }));
  const secondMetrics = metricsFrom(second.stderr, 3);
  assert.notEqual(secondMetrics.sourceSnapshotDigest, firstMetrics.sourceSnapshotDigest,
    `changed source must change the authoritative snapshot digest\nfirst=${first.stderr}\nsecond=${second.stderr}`);
  assert.notEqual(secondMetrics.indexKey, firstMetrics.indexKey,
    `changed source must change the index key\nfirst=${first.stderr}\nsecond=${second.stderr}`);
  assert.match(second.stderr, /index_mode=rebuilt/u, 'changed source must rebuild semantic vectors');
  assert.equal(secondContext.evidence[0]?.sourceDigest, secondDigest);
  assert.notEqual(secondDigest, firstDigest);
  assert.equal(secondMetrics.collection, firstMetrics.collection,
    'changed source must mutate the stable workspace collection');
  assert.equal(firstMetrics.publicationMode, 'stable_collection_direct');
  assert.equal(warmMetrics.publicationMode, 'stable_collection_direct');
  assert.equal(secondMetrics.publicationMode, 'stable_collection_direct');

  console.log(JSON.stringify({
    status: 'provider-pass',
    runner: { commit: runtime.runnerCommit, cleanAtStart: runtime.runnerClean },
    first_generation: 1,
    warm_generation: 2,
    warm_index_reused: true,
    second_generation: 3,
    initial_collection: firstMetrics.collection,
    warm_collection_reused: warmMetrics.collection === firstMetrics.collection,
    changed_collection: secondMetrics.collection,
    publication_mode: secondMetrics.publicationMode,
    first_digest: firstDigest,
    second_digest: secondDigest,
  }, null, 2));
} finally {
  try {
    for (const collection of publishedCollections) {
      await fetch(`${qdrantUrl.replace(/\/$/u, '')}/collections/${encodeURIComponent(collection)}`, { method: 'DELETE' });
    }
  } catch {
    // Best-effort cleanup; the run's evidence is retained independently.
  }
  await rm(root, { recursive: true, force: true });
}
