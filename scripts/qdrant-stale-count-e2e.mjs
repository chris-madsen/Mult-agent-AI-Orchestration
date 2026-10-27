#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '..');
const requestTimeoutMs = 180_000;
const [firstArg, secondArg] = process.argv.slice(2);
const outputArg = firstArg === '--output' ? secondArg : firstArg;
if ((firstArg === '--output' && secondArg === undefined) || process.argv.length > 4) {
  throw new Error('Usage: node scripts/qdrant-stale-count-e2e.mjs [--output output.json]');
}

const root = await mkdtemp(join(tmpdir(), 'ace-qdrant-stale-count-'));
const workspace = join(root, 'workspace');
const state = join(root, 'state');
const workspaceId = `qdrant-stale-count-${randomUUID()}`;
const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
const source = [
  'export function staleSnapshotSentinel(): string { return "stale-count"; }',
  'export function staleSnapshotSupport(): string { return "support"; }',
  '',
].join('\n');
const sourceDigest = createHash('sha256').update(source, 'utf8').digest('hex');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repository,
  encoding: 'utf8',
}).trim().toLowerCase();

const metricsFrom = (stderr) => {
  const line = stderr.split('\n').reverse().find((item) => item.includes('ace-mcp real retrieval workspace_id='));
  if (line === undefined) throw new Error(`missing real retrieval metrics: ${stderr.slice(-4000)}`);
  const value = (name) => {
    const match = new RegExp(`${name}=([^\\s]+)`, 'u').exec(line)?.[1];
    if (match === undefined) throw new Error(`missing metric ${name}: ${line}`);
    return match;
  };
  return {
    collection: value('collection'),
    publicationMode: value('publication_mode'),
    indexKey: value('index_key'),
    indexMode: value('index_mode'),
    reusedVectors: Number(value('reused_vectors')),
    generation: Number(value('generation')),
  };
};

const runOnce = async (label) => new Promise((resolveRun, rejectRun) => {
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
      ACE_EMBEDDING_WORKER: process.env.ACE_EMBEDDING_WORKER
        ?? resolve(import.meta.dirname, 'fastembed-worker.sh'),
      ACE_AST_GREP_COMMAND: process.env.ACE_AST_GREP_COMMAND
        ?? resolve(import.meta.dirname, '../node_modules/.bin/ast-grep'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let nextId = 1;
  let settled = false;
  const waiters = new Map();
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill('SIGTERM');
    rejectRun(new Error(`${label} timed out: ${stderr.slice(-4000)}`));
  }, requestTimeoutMs);
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolveStop) => {
      const force = setTimeout(() => {
        child.kill('SIGKILL');
        resolveStop();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(force);
        resolveStop();
      });
      child.stdin.end();
      child.kill('SIGTERM');
    });
  };
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
    for (;;) {
      const newline = stdout.indexOf('\n');
      if (newline < 0) break;
      const raw = stdout.slice(0, newline);
      stdout = stdout.slice(newline + 1);
      if (raw.trim().length === 0) continue;
      const message = JSON.parse(raw);
      const waiter = waiters.get(message.id);
      if (waiter !== undefined) {
        waiters.delete(message.id);
        waiter(message);
      }
    }
  });
  const request = (method, params) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++;
    const timerForRequest = setTimeout(() => {
      waiters.delete(id);
      rejectRequest(new Error(`${label} request timed out: ${stderr.slice(-4000)}`));
    }, requestTimeoutMs);
    waiters.set(id, (message) => {
      clearTimeout(timerForRequest);
      resolveRequest(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  (async () => {
    try {
      const initialized = await request('initialize', {
        protocolVersion: '2026-07-28',
        capabilities: {},
        clientInfo: { name: `ace-qdrant-stale-count-${label}`, version: '1' },
      });
      assert.equal(initialized.error, undefined, JSON.stringify(initialized));
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      const response = await request('tools/call', {
        name: 'ace_context',
        arguments: {
          workspace_id: workspaceId,
          query: 'staleSnapshotSentinel stale-count',
          include_docs: false,
          include_memory: false,
        },
      });
      assert.equal(response.result?.isError, undefined, JSON.stringify(response));
      const context = response.result?.structuredContent;
      assert.equal(context?.complete, true, JSON.stringify(context));
      const evidence = context.evidence?.find((item) => item?.content?.includes('staleSnapshotSentinel'));
      assert.notEqual(evidence, undefined, JSON.stringify(context));
      assert.equal(evidence.sourceDigest, sourceDigest);
      assert.equal(evidence.freshness, 'current');
      const metrics = metricsFrom(stderr);
      clearTimeout(timer);
      await stop();
      settled = true;
      resolveRun({ label, context, metrics, stderr });
    } catch (cause) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await stop();
      rejectRun(cause);
    }
  })();
});

const deleteOnePoint = async (metrics) => {
  const endpoint = `${qdrantUrl.replace(/\/$/u, '')}/collections/${encodeURIComponent(metrics.collection)}/points/scroll`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      limit: 1,
      with_payload: false,
      with_vector: false,
      filter: { must: [
        { key: 'workspace_id', match: { value: workspaceId } },
        { key: 'index_key', match: { value: metrics.indexKey } },
      ] },
    }),
  });
  const bodyText = await response.text();
  assert.equal(response.ok, true, bodyText);
  const body = JSON.parse(bodyText);
  const pointId = body.result?.points?.[0]?.id;
  assert.notEqual(pointId, undefined, bodyText);
  const deleted = await fetch(
    `${qdrantUrl.replace(/\/$/u, '')}/collections/${encodeURIComponent(metrics.collection)}/points/delete?wait=true`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ points: [pointId] }),
    },
  );
  assert.equal(deleted.ok, true, await deleted.text());
  return String(pointId);
};

try {
  await mkdir(join(workspace, 'src'), { recursive: true });
  await writeFile(join(workspace, 'src', 'stale-count.ts'), source, 'utf8');
  const first = await runOnce('first');
  assert.equal(first.metrics.indexMode, 'rebuilt');
  const deletedPointId = await deleteOnePoint(first.metrics);
  const second = await runOnce('second');
  assert.equal(second.metrics.indexKey, first.metrics.indexKey);
  assert.equal(second.metrics.indexMode, 'rebuilt', 'count mismatch must not be warm-reused');
  assert.ok(second.metrics.reusedVectors > 0, 'rebuild may reuse unchanged vectors by content identity');

  const result = {
    schemaVersion: 1,
    evidence: 'real-qdrant-stale-count-rebuild',
    generatedAt: new Date().toISOString(),
    sourceCommit,
    fixture: { workspaceId, sourcePath: 'src/stale-count.ts', sourceDigest },
    runtime: {
      node: process.version,
      qdrant: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
      qdrantUrlKind: qdrantUrl.startsWith('http://127.0.0.1') || qdrantUrl.startsWith('http://localhost')
        ? 'local-loopback' : 'configured-local-host',
      embeddingWorker: basename(process.env.ACE_EMBEDDING_WORKER?.trim()
        || resolve(import.meta.dirname, 'fastembed-worker.sh')),
    },
    mutation: {
      collection: first.metrics.collection,
      publicationMode: first.metrics.publicationMode,
      indexKey: first.metrics.indexKey,
      deletedPointId,
      firstGeneration: first.metrics.generation,
      secondGeneration: second.metrics.generation,
    },
    checks: {
      initialSnapshotRebuilt: 'PASS',
      realPointDeletedBetweenRuns: 'PASS',
      staleCountWasNotWarmReused: 'PASS',
      sameSnapshotKeyRebuilt: 'PASS',
      unchangedVectorsReusedByContentIdentity: second.metrics.reusedVectors > 0 ? 'PASS' : 'FAIL',
      secondCitationCurrent: 'PASS',
    },
    claims: {
      staleCountRecoveryMeasured: true,
      equalCountWrongMembershipMeasured: false,
      productionApproved: false,
      tokenSavings5x: false,
      graphitiLocalOnly: false,
      note: 'Real local Qdrant stale-count evidence only; equal-count membership and production C-A/PVC/k3s gates remain separate.',
    },
  };
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (outputArg !== undefined) {
    const output = resolve(outputArg);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized, 'utf8');
  }
  process.stdout.write(serialized);
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
