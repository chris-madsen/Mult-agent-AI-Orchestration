#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRealProviderRuntime } from './real-provider-runtime.mjs';

const runtime = await resolveRealProviderRuntime(import.meta.dirname);
const root = await mkdtemp(join(tmpdir(), 'ace-real-provider-'));
const workspace = join(root, 'workspace');
await mkdir(workspace);
const workspaceId = `real-provider-2000-line-${randomUUID()}`;

const targetLines = [
  'export function retryAfterTransientFailure(input: string) {',
  '  let attempt = 0;',
  '  let lastError: unknown;',
  '  while (attempt < 3) {',
  '    try {',
  '      const result = input.trim();',
  '      if (result.length === 0) {',
  "        throw new Error('empty');",
  '      }',
  '      return result;',
  '    } catch (error) {',
  '      lastError = error;',
  '      attempt += 1;',
  '      const backoffMs = attempt * 10;',
  '      void backoffMs;',
  '      if (attempt >= 3) {',
  '        break;',
  '      }',
  '    }',
  '  }',
  '  if (lastError instanceof Error) {',
  '    throw lastError;',
  '  }',
  "  throw new Error('retry failed');",
  '}',
];
assert.equal(targetLines.length, 25);

const filler = Array.from({ length: 1974 }, (_, index) => `export const filler_${index + 1} = ${index + 1};`);
const source = `${targetLines.join('\n')}\n${filler.join('\n')}\n`;
const sourcePath = join(workspace, 'service.ts');
await writeFile(sourcePath, source);
const sourceBytes = await readFile(sourcePath);
const sourceDigest = createHash('sha256').update(sourceBytes).digest('hex');

const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
const race = process.env.ACE_REAL_PROVIDER_RACE === 'true';
const outage = process.env.ACE_REAL_PROVIDER_OUTAGE === 'true';
const hardOutage = process.env.ACE_REAL_PROVIDER_HARD_OUTAGE === 'true';
const requestTimeoutMs = Number(process.env.ACE_REAL_PROVIDER_TIMEOUT_MS ?? 180_000);
if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 10_000 || requestTimeoutMs > 600_000) {
  throw new Error('ACE_REAL_PROVIDER_TIMEOUT_MS must be an integer between 10000 and 600000');
}
const child = spawn(process.execPath, [runtime.executable], {
  cwd: runtime.runtimeRoot,
  detached: process.platform !== 'win32',
  env: {
    ...process.env,
    ACE_RUNTIME_ROOT: runtime.runtimeRoot,
    ACE_WORKSPACE_ROOT: workspace,
    ACE_ALLOWED_ROOTS: root,
    ACE_STATE_DIR: join(root, 'state'),
    ACE_WORKSPACE_ID: workspaceId,
    ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
    ACE_RETRIEVAL_STRATEGY: process.env.ACE_RETRIEVAL_STRATEGY?.trim() || 'dense',
    ACE_QDRANT_URL: outage || hardOutage ? 'http://127.0.0.1:6339' : qdrantUrl,
    ACE_EMBEDDING_WORKER: process.env.ACE_EMBEDDING_WORKER ?? runtime.embeddingWorker,
    ACE_AST_GREP_COMMAND: process.env.ACE_AST_GREP_COMMAND ?? runtime.astGrepCommand,
    ...(race ? {
      // The runtime forwards the artificial delay only under its explicit
      // test-only double opt-in; production runs never receive this knob.
      ACE_ENABLE_TEST_FAILPOINTS: 'true',
      ACE_EMBEDDING_DELAY_MS: '1000',
    } : {}),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let output = '';
const responses = new Map();
const waiters = new Map();
const stderr = [];
let stopped = false;
let stopPromise;
child.stderr.on('data', (chunk) => stderr.push(chunk.toString('utf8')));
child.stdout.on('data', (chunk) => {
  output += chunk.toString('utf8');
  for (;;) {
    const newline = output.indexOf('\n');
    if (newline < 0) break;
    const line = output.slice(0, newline);
    output = output.slice(newline + 1);
    if (line.trim().length === 0) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (cause) {
      failChild(new Error(`MCP child emitted malformed JSON: ${cause instanceof Error ? cause.message : String(cause)}`));
      return;
    }
    const waiter = waiters.get(message.id);
    if (waiter !== undefined) {
      waiters.delete(message.id);
      waiter.resolve(message);
    } else {
      responses.set(message.id, message);
    }
  }
});

const signalChild = (signal) => {
  if (child.pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The process group may already have exited; signal the direct child below.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The child may have exited between the group and direct signals.
  }
};

const directChildAlive = () => child.exitCode === null && child.signalCode === null;

const processGroupAlive = () => {
  if (process.platform === 'win32' || child.pid === undefined) return directChildAlive();
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (cause) {
    return cause?.code === 'EPERM';
  }
};

const processTreeAlive = () => directChildAlive() || processGroupAlive();

const waitForProcessTreeExit = async (timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (processTreeAlive()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  return true;
};

const stopChild = () => {
  if (stopPromise !== undefined) return stopPromise;
  stopPromise = (async () => {
    stopped = true;
    for (const waiter of waiters.values()) waiter.reject(new Error('MCP child stopped'));
    waiters.clear();
    if (!processTreeAlive()) return;
    signalChild('SIGTERM');
    if (await waitForProcessTreeExit(750)) return;
    signalChild('SIGKILL');
    await waitForProcessTreeExit(250);
  })();
  return stopPromise;
};

const failChild = (cause) => {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (!stopped) {
    for (const waiter of waiters.values()) waiter.reject(error);
    waiters.clear();
    void stopChild();
  }
};

child.once('exit', (code, signal) => {
  if (stopped) return;
  failChild(new Error(`MCP child exited before response code=${code} signal=${signal}; stderr=${stderr.join('').slice(-2000)}`));
});
child.once('error', failChild);
child.stdin.on('error', failChild);

const request = (id, message) => new Promise((resolveResponse, reject) => {
  let settled = false;
  let timer;
  const settle = (settlement) => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    waiters.delete(id);
    settlement();
  };
  timer = setTimeout(() => settle(() => {
    const detail = `MCP request ${id} timed out after ${requestTimeoutMs}ms; stderr=${stderr.join('').slice(-2000)}`;
    process.stderr.write(`${JSON.stringify({ status: 'blocked', code: 'RUNNER_TIMEOUT', detail })}\n`);
    reject(new Error(detail));
  }), requestTimeoutMs);
  const existing = responses.get(id);
  if (existing !== undefined) {
    responses.delete(id);
    settle(() => resolveResponse(existing));
    return;
  }
  waiters.set(id, {
    resolve: (response) => settle(() => resolveResponse(response)),
    reject: (cause) => settle(() => reject(cause)),
  });
  if (stopped || !directChildAlive()) {
    settle(() => reject(new Error(stopped ? 'MCP child is already stopped' : 'MCP child exited before request')));
    return;
  }
  try {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  } catch (cause) {
    settle(() => reject(cause));
  }
});

try {
  await request(1, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'ace-real-provider-e2e', version: '1' } } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const contextRequest = request(2, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ace_context', arguments: { workspace_id: workspaceId, query: outage ? 'retryAfterTransientFailure' : 'retry an operation after a transient failure' } } });
  if (!outage && race) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    await writeFile(sourcePath, `${source.replace('return result;', 'return result + \'-changed\';')}`);
  }
  const contextResponse = await contextRequest;
  const statusResponse = await request(4, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ace_workspace_status', arguments: { workspace_id: workspaceId } } });
  // Provider outage is a live process with a not-ready capability. The
  // production composition has no lexical fallback, so an outage must not
  // be represented as a degraded-but-usable retrieval result.
  const expectedIndexStatus = outage || hardOutage ? 'not_ready' : 'ready';
  assert.equal(statusResponse.result?.structuredContent?.index_status, expectedIndexStatus, JSON.stringify(statusResponse));
  const context = contextResponse.result?.structuredContent;
  if (outage || hardOutage) {
    assert.equal(contextResponse.result?.isError, true, JSON.stringify(contextResponse));
    assert.equal(context.status, 'not_ready', JSON.stringify(context));
    assert.equal(context.code, 'NOT_READY', JSON.stringify(context));
    console.log(JSON.stringify({ status: 'provider-failure-is-honest', outage, hard_outage: hardOutage, code: context.code }, null, 2));
  } else {
    assert.equal(contextResponse.result?.isError, undefined, JSON.stringify(contextResponse));
    if (race) {
      const evidence = context.evidence.find((item) => item.content.includes('retryAfterTransientFailure'));
      if (context.complete) {
        // A concurrent request may finish by rebuilding against the changed
        // bytes. That is valid only when the delivered evidence is the new
        // source, never the old digest mislabeled as current.
        assert.ok(evidence, JSON.stringify(context));
        assert.notEqual(evidence.sourceDigest, sourceDigest, JSON.stringify(context));
        assert.match(evidence.content, /return result \+ '-changed';/u, JSON.stringify(context));
        console.log(JSON.stringify({
          status: 'provider-pass',
          race: true,
          outcome: 'reconciled-current',
          complete: true,
          warnings: context.warnings,
        }, null, 2));
      } else {
        assert.ok(context.partialSources.includes('code'), JSON.stringify(context));
        assert.ok(context.warnings.some((warning) => warning.includes('stale') || warning.includes('changed')), JSON.stringify(context));
        assert.ok(evidence === undefined || evidence.freshness !== 'current', JSON.stringify(context));
        console.log(JSON.stringify({ status: 'provider-pass', race: true, outcome: 'partial-raced', complete: false, warnings: context.warnings, partial_sources: context.partialSources }, null, 2));
      }
    } else {
      assert.equal(context.complete, true, JSON.stringify(context));
      const evidence = context.evidence.find((item) => item.content.includes('retryAfterTransientFailure'));
      assert.ok(evidence, JSON.stringify(context));
      assert.equal(evidence.freshness, 'current');
      assert.equal(evidence.sourceDigest, sourceDigest);
      assert.equal(evidence.citation, 'service.ts:1-25');
      assert.equal(evidence.content.split('\n').length, 25);
      assert.ok(evidence.expansionHandle);

      const expansionResponse = await request(3, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ace_expand', arguments: { handle: evidence.expansionHandle } } });
      const expansion = expansionResponse.result?.structuredContent;
      const expanded = Buffer.from(expansion.content_base64, 'base64');
      assert.equal(expansionResponse.result?.isError, undefined, JSON.stringify(expansionResponse));
      assert.equal(expansion.digest, sourceDigest);
      assert.equal(expansion.total_bytes, sourceBytes.byteLength);
      assert.deepEqual(expanded, sourceBytes);

      console.log(JSON.stringify({
        status: 'provider-pass',
        fixture: '2000-line TypeScript source / 25-line target function',
        qdrant: qdrantUrl,
        citation: evidence.citation,
        freshness: evidence.freshness,
        source_digest: sourceDigest,
        expansion_bytes: expanded.byteLength,
        complete: context.complete,
      }, null, 2));
    }
  }
} finally {
  child.stdin.end();
  await stopChild();
  await rm(root, { recursive: true, force: true });
}
