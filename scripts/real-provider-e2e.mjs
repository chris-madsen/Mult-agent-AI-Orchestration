#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'ace-real-provider-'));
const workspace = join(root, 'workspace');
await mkdir(workspace);

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
const child = spawn(process.execPath, ['dist/bin/ace-mcp.js'], {
  cwd: resolve(import.meta.dirname, '..'),
  env: {
    ...process.env,
    ACE_WORKSPACE_ROOT: workspace,
    ACE_ALLOWED_ROOTS: root,
    ACE_STATE_DIR: join(root, 'state'),
    ACE_WORKSPACE_ID: 'real-provider-2000-line',
    ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
    ACE_QDRANT_URL: outage || hardOutage ? 'http://127.0.0.1:6339' : qdrantUrl,
    ACE_EMBEDDING_WORKER: resolve(import.meta.dirname, 'fastembed-worker.sh'),
    ACE_AST_GREP_COMMAND: process.env.ACE_AST_GREP_COMMAND ?? resolve(import.meta.dirname, '../node_modules/.bin/ast-grep'),
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
child.stderr.on('data', (chunk) => stderr.push(chunk.toString('utf8')));
child.stdout.on('data', (chunk) => {
  output += chunk.toString('utf8');
  for (;;) {
    const newline = output.indexOf('\n');
    if (newline < 0) break;
    const line = output.slice(0, newline);
    output = output.slice(newline + 1);
    if (line.trim().length === 0) continue;
    const message = JSON.parse(line);
    const waiter = waiters.get(message.id);
    if (waiter !== undefined) {
      waiters.delete(message.id);
      waiter(message);
    } else {
      responses.set(message.id, message);
    }
  }
});

const request = (id, message) => new Promise((resolveResponse, reject) => {
  const timer = setTimeout(() => {
    waiters.delete(id);
    reject(new Error(`MCP request ${id} timed out; stderr=${stderr.join('').slice(-2000)}`));
  }, 180_000);
  const existing = responses.get(id);
  if (existing !== undefined) {
    responses.delete(id);
    clearTimeout(timer);
    resolveResponse(existing);
    return;
  }
  waiters.set(id, (response) => {
    clearTimeout(timer);
    resolveResponse(response);
  });
  child.stdin.write(`${JSON.stringify(message)}\n`);
});

try {
  await request(1, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'ace-real-provider-e2e', version: '1' } } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const contextRequest = request(2, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ace_context', arguments: { workspace_id: 'real-provider-2000-line', query: outage ? 'retryAfterTransientFailure' : 'retry an operation after a transient failure' } } });
  if (!outage && race) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    await writeFile(sourcePath, `${source.replace('return result;', 'return result + \'-changed\';')}`);
  }
  const contextResponse = await contextRequest;
  const statusResponse = await request(4, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ace_workspace_status', arguments: { workspace_id: 'real-provider-2000-line' } } });
  const expectedIndexStatus = hardOutage ? 'not_ready' : outage ? 'degraded' : 'ready';
  assert.equal(statusResponse.result?.structuredContent?.index_status, expectedIndexStatus, JSON.stringify(statusResponse));
  const context = contextResponse.result?.structuredContent;
  if (outage) {
    assert.equal(contextResponse.result?.isError, undefined, JSON.stringify(contextResponse));
    assert.equal(context.complete, false, JSON.stringify(context));
    assert.ok(context.partialSources.includes('code'), JSON.stringify(context));
    assert.equal(context.sourceCoverage?.find((source) => source.source === 'code')?.status, 'partial', JSON.stringify(context));
    assert.ok(context.warnings.some((warning) => warning.includes('Qdrant unavailable')), JSON.stringify(context));
    assert.ok(context.evidence.some((item) => item.freshness === 'current'), JSON.stringify(context));
    console.log(JSON.stringify({ status: 'provider-partial-is-honest', outage: true, complete: context.complete, warnings: context.warnings, partial_sources: context.partialSources }, null, 2));
  } else if (hardOutage) {
    assert.equal(contextResponse.result?.isError, true, JSON.stringify(contextResponse));
    assert.equal(context.status, 'not_ready', JSON.stringify(context));
    assert.equal(context.code, 'NOT_READY', JSON.stringify(context));
    console.log(JSON.stringify({ status: 'provider-failure-is-honest', hard_outage: true, code: context.code }, null, 2));
  } else {
    assert.equal(contextResponse.result?.isError, undefined, JSON.stringify(contextResponse));
    if (race) {
      assert.equal(context.complete, false, JSON.stringify(context));
      assert.ok(context.partialSources.includes('code'), JSON.stringify(context));
      assert.ok(context.warnings.some((warning) => warning.includes('stale') || warning.includes('changed')), JSON.stringify(context));
      const evidence = context.evidence.find((item) => item.content.includes('retryAfterTransientFailure'));
      assert.ok(evidence === undefined || evidence.freshness !== 'current', JSON.stringify(context));
      console.log(JSON.stringify({ status: 'provider-pass', race: true, complete: context.complete, warnings: context.warnings, partial_sources: context.partialSources }, null, 2));
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
  child.kill('SIGTERM');
  await rm(root, { recursive: true, force: true });
}
