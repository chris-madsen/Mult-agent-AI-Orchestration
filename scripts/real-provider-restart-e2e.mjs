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
      ACE_TREE_SITTER_HELPER: resolve(import.meta.dirname, 'tree-sitter-structural.py'),
      ACE_TREE_SITTER_PYTHON: process.env.ACE_TREE_SITTER_PYTHON ?? resolve('.venv-system/bin/python'),
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
  const firstCollection = /generation=1 .*collection=([^\s]+)/u.exec(first.stderr)?.[1];
  assert.ok(firstCollection, first.stderr);

  await writeFile(sourcePath, 'export function currentValue() { return "D2"; }\n');
  const secondDigest = await digest();
  const second = await runOnce();
  const secondContext = second.response.result?.structuredContent;
  assert.equal(second.response.result?.isError, undefined, JSON.stringify(second.response));
  assert.equal(secondContext.complete, true, JSON.stringify(secondContext));
  assert.equal(secondContext.evidence[0]?.sourceDigest, secondDigest);
  assert.notEqual(secondDigest, firstDigest);
  const secondCollection = /generation=2 .*collection=([^\s]+)/u.exec(second.stderr)?.[1];
  assert.equal(secondCollection, firstCollection, 'collection is stable across observation generations');

  const scrollGeneration = async (generation) => {
    const response = await fetch(`${qdrantUrl}/collections/${encodeURIComponent(firstCollection)}/points/scroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        limit: 1,
        with_payload: false,
        with_vector: false,
        filter: {
          must: [
            { key: 'workspace_id', match: { value: workspaceId } },
            { key: 'generation', match: { value: generation } },
          ],
        },
      }),
    });
    assert.equal(response.ok, true, await response.text());
    const body = await response.json();
    return body.result?.points ?? [];
  };
  assert.equal((await scrollGeneration(1)).length, 0, 'obsolete generation is pruned after successful rebuild');
  assert.ok((await scrollGeneration(2)).length > 0, 'current generation remains indexed');

  console.log(JSON.stringify({
    status: 'provider-pass',
    first_generation: 1,
    second_generation: 2,
    collection: firstCollection,
    obsolete_generation_pruned: true,
    first_digest: firstDigest,
    second_digest: secondDigest,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
