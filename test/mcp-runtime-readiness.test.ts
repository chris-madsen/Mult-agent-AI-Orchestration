import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

interface ContextResponse {
  readonly result?: {
    readonly isError?: boolean;
    readonly structuredContent?: { readonly status?: string; readonly capability?: string };
  };
}

const requestContext = async (workspaceId: string, environment: Record<string, string>): Promise<ContextResponse> => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/bin/ace-mcp.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...environment,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    return await new Promise<ContextResponse>((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('MCP timeout')), 10000);
      const onData = (chunk: Buffer): void => {
        output += chunk.toString('utf8');
        while (output.includes('\n')) {
          const newline = output.indexOf('\n');
          const line = output.slice(0, newline);
          output = output.slice(newline + 1);
          try {
            const message = JSON.parse(line) as { id?: number };
            if (message.id !== 2) continue;
            clearTimeout(timeout);
            child.stdout.off('data', onData);
            resolve(message as ContextResponse);
            return;
          } catch (error) { reject(error); return; }
        }
      };
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error('MCP exited prematurely: ' + code)));
      child.stdout.on('data', onData);
      child.stdin.write([
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'ace-test', version: '1' } } }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
          params: { name: 'ace_context', arguments: { workspace_id: workspaceId, query: 'reconnect' } } }),
      ].join('\n') + '\n');
    });
  } finally {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(forceKill);
        resolve();
      };
      const forceKill = setTimeout(() => {
        child.kill('SIGKILL');
        finish();
      }, 250);
      child.once('exit', finish);
      child.kill('SIGTERM');
    });
  }
};

const assertNotReady = (body: ContextResponse): void => {
  assert.equal(body.result?.isError, true);
  assert.equal(body.result?.structuredContent?.status, 'not_ready');
  assert.equal(body.result?.structuredContent?.capability, 'unified_context');
};

test('DBC-01 missing selected providers returns NOT_READY from the actual MCP executable', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-runtime-'));
  const workspace = join(parent, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'code.ts'), 'export function reconnect() { return true; }\n');
  const response = await requestContext('dbc01-test-workspace', {
    ACE_WORKSPACE_ROOT: workspace,
    ACE_ALLOWED_ROOTS: parent,
    ACE_STATE_DIR: join(parent, 'state'),
    ACE_WORKSPACE_ID: 'dbc01-test-workspace',
    ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
    ACE_QDRANT_URL: 'http://127.0.0.1:6339',
    ACE_ALLOW_LOCAL_FALLBACK: 'false',
  });
  assertNotReady(response);
});

test('DBC-01 embedding preflight failure keeps the MCP executable alive', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-runtime-'));
  const workspace = join(parent, 'workspace');
  const worker = join(parent, 'embedding-worker.sh');
  await mkdir(workspace);
  await writeFile(join(workspace, 'code.ts'), 'export function reconnect() { return true; }\n');
  await writeFile(worker, '#!/bin/sh\nexit 17\n');
  await chmod(worker, 0o755);

  const qdrant = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ result: { collections: [] } }));
  });
  await new Promise<void>((resolve, reject) => {
    qdrant.once('error', reject);
    qdrant.listen(0, '127.0.0.1', () => resolve());
  });
  try {
    const address = qdrant.address();
    assert.equal(typeof address, 'object');
    if (address === null || typeof address === 'string') throw new Error('Qdrant test server did not expose a port');
    const response = await requestContext('dbc01-embedding-preflight-workspace', {
      ACE_WORKSPACE_ROOT: workspace,
      ACE_ALLOWED_ROOTS: parent,
      ACE_STATE_DIR: join(parent, 'state'),
      ACE_WORKSPACE_ID: 'dbc01-embedding-preflight-workspace',
      ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
      ACE_QDRANT_URL: `http://127.0.0.1:${address.port}`,
      ACE_EMBEDDING_WORKER: worker,
      ACE_ALLOW_LOCAL_FALLBACK: 'false',
    });
    assertNotReady(response);
  } finally {
    qdrant.closeAllConnections();
    await new Promise<void>((resolve, reject) => qdrant.close((error) => error === undefined ? resolve() : reject(error)));
  }
});
