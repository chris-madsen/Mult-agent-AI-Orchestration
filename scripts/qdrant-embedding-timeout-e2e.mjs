#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '..');
const timeoutMs = 30_000;
const [firstArg, secondArg] = process.argv.slice(2);
const outputArg = firstArg === '--output' ? secondArg : firstArg;
if ((firstArg === '--output' && secondArg === undefined) || process.argv.length > 4) {
  throw new Error('Usage: node scripts/qdrant-embedding-timeout-e2e.mjs [--output output.json]');
}

const root = await mkdtemp(join(tmpdir(), 'ace-qdrant-timeout-'));
const workspace = join(root, 'workspace');
const state = join(root, 'state');
const workspaceId = `qdrant-timeout-${randomUUID()}`;
const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
const source = 'export function timeoutSentinel(): string { return "timeout"; }\n';
const sourceDigest = createHash('sha256').update(source, 'utf8').digest('hex');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repository,
  encoding: 'utf8',
}).trim().toLowerCase();

const requestProcess = async () => {
  await mkdir(join(workspace, 'src'), { recursive: true });
  await writeFile(join(workspace, 'src', 'timeout-sentinel.ts'), source, 'utf8');
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
      ACE_ENABLE_TEST_FAILPOINTS: 'true',
      ACE_EMBEDDING_DELAY_MS: '1000',
      ACE_EMBEDDING_TIMEOUT_MS: '100',
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
  const responses = new Map();
  const waiters = new Map();
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
      } else if (message.id !== undefined) {
        responses.set(message.id, message);
      }
    }
  });
  const request = (method, params) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      waiters.delete(id);
      rejectRequest(new Error(`MCP request timed out: ${stderr.slice(-4000)}`));
    }, timeoutMs);
    waiters.set(id, (message) => {
      clearTimeout(timer);
      resolveRequest(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  try {
    const initialized = await request('initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'ace-qdrant-embedding-timeout', version: '1' },
    });
    assert.equal(initialized.error, undefined, JSON.stringify(initialized));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const statusResponse = await request('tools/call', {
      name: 'ace_workspace_status',
      arguments: { workspace_id: workspaceId },
    });
    assert.equal(statusResponse.result?.isError, undefined, JSON.stringify(statusResponse));
    const status = statusResponse.result?.structuredContent;
    assert.equal(status?.capabilities?.unified_context?.state, 'not_ready', JSON.stringify(status));
    assert.equal(status?.capabilities?.unified_context?.reason, 'embedding_provider_unavailable', JSON.stringify(status));

    const contextResponse = await request('tools/call', {
      name: 'ace_context',
      arguments: { workspace_id: workspaceId, query: 'timeoutSentinel' },
    });
    assert.equal(contextResponse.result?.isError, true, JSON.stringify(contextResponse));
    assert.equal(contextResponse.result?.structuredContent?.status, 'not_ready', JSON.stringify(contextResponse));
    assert.equal(contextResponse.result?.structuredContent?.code, 'NOT_READY', JSON.stringify(contextResponse));
    assert.match(stderr, /embedding provider preflight failed \(EXTERNAL_UNAVAILABLE\)/u);
    assert.doesNotMatch(stderr, /degraded retrieval/u);
    return {
      status,
      context: contextResponse.result?.structuredContent,
      stderrDigest: createHash('sha256').update(stderr, 'utf8').digest('hex'),
    };
  } finally {
    child.stdin.end();
    child.kill('SIGTERM');
  }
};

try {
  const observed = await requestProcess();
  const result = {
    schemaVersion: 1,
    evidence: 'real-qdrant-embedding-timeout',
    generatedAt: new Date().toISOString(),
    sourceCommit,
    fixture: { workspaceId, sourcePath: 'src/timeout-sentinel.ts', sourceDigest },
    runtime: {
      node: process.version,
      qdrant: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
      qdrantUrlKind: qdrantUrl.startsWith('http://127.0.0.1') || qdrantUrl.startsWith('http://localhost')
        ? 'local-loopback' : 'configured-local-host',
      embeddingTimeoutMs: 100,
      embeddingDelayMs: 1000,
      testFailpointsDoubleOptIn: true,
    },
    checks: {
      realWorkerTimedOut: 'PASS',
      mcpProcessRemainedAlive: 'PASS',
      readinessStayedNotReady: 'PASS',
      contextDidNotSimulateSuccess: 'PASS',
      localFallbackDisabled: 'PASS',
    },
    observed,
    claims: {
      timeoutMeasured: true,
      cancellationMeasured: false,
      productionApproved: false,
      tokenSavings5x: false,
      graphitiLocalOnly: false,
      note: 'Real local FastEmbed timeout evidence only. MCP request cancellation during pre-serve startup remains an explicit architecture gap.',
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
