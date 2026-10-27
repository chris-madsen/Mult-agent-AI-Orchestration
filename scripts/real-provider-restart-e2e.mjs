#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '..');
const root = await mkdtemp(join(tmpdir(), 'ace-restart-provider-'));
const workspace = join(root, 'workspace');
const state = join(root, 'state');
await mkdir(workspace);
const sourcePath = join(workspace, 'versioned.ts');
const workspaceId = 'real-provider-restart';
const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
const publishedCollections = new Set();

const digest = async () => createHash('sha256').update(await readFile(sourcePath)).digest('hex');

const runOnce = () => new Promise((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, ['dist/bin/ace-mcp.js'], {
    cwd: repository,
    env: {
      ...process.env,
      ACE_WORKSPACE_ROOT: workspace,
      ACE_ALLOWED_ROOTS: root,
      ACE_STATE_DIR: state,
      ACE_WORKSPACE_ID: workspaceId,
      ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
      ACE_QDRANT_URL: qdrantUrl,
      ACE_EMBEDDING_WORKER: resolve(import.meta.dirname, 'fastembed-worker.sh'),
      ACE_AST_GREP_COMMAND: process.env.ACE_AST_GREP_COMMAND ?? resolve(import.meta.dirname, '../node_modules/.bin/ast-grep'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const responses = new Map();
  const waiters = new Map();
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    rejectRun(new Error(`restart MCP request timed out: ${stderr.slice(-2000)}`));
  }, 180_000);
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
    for (;;) {
      const newline = stdout.indexOf('\n');
      if (newline < 0) break;
      const message = JSON.parse(stdout.slice(0, newline));
      stdout = stdout.slice(newline + 1);
      const waiter = waiters.get(message.id);
      if (waiter !== undefined) {
        waiters.delete(message.id);
        waiter(message);
      } else responses.set(message.id, message);
    }
  });
  const request = (id, message) => new Promise((resolveRequest) => {
    const existing = responses.get(id);
    if (existing !== undefined) {
      responses.delete(id);
      resolveRequest(existing);
      return;
    }
    waiters.set(id, resolveRequest);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
  (async () => {
    try {
      await request(1, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'ace-restart-e2e', version: '1' } } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      const response = await request(2, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ace_context', arguments: { workspace_id: workspaceId, query: 'current value' } } });
      clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      resolveRun({ response, stderr });
    } catch (error) {
      clearTimeout(timer);
      child.kill('SIGTERM');
      rejectRun(error);
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
  assert.equal(warm.response.result?.isError, undefined, JSON.stringify(warm.response));
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
