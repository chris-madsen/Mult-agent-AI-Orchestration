import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Effect } from 'effect';
import { createAceServer } from '../src/transport/mcp-sdk-stdio.js';

test('DBC-09 official MCP client interoperates with the production executable', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-sdk-conformance-'));
  const workspace = join(parent, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'code.ts'), 'export const ready = true;\n');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/bin/ace-mcp.ts'],
    cwd: process.cwd(),
    stderr: 'pipe',
    env: {
      ACE_WORKSPACE_ROOT: workspace,
      ACE_ALLOWED_ROOTS: parent,
      ACE_STATE_DIR: join(parent, 'state'),
      ACE_WORKSPACE_ID: 'dbc09-sdk-workspace',
      ACE_ENABLE_EXPERIMENTAL_QDRANT: 'false',
      ACE_ALLOW_LOCAL_FALLBACK: 'false',
    },
  });
  const client = new Client({ name: 'ace-sdk-conformance-client', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      'ace_context',
      'ace_expand',
      'ace_workspace_status',
      'ace_memory_search',
    ]);

    const statuses = await Promise.all(
      [1, 2, 3].map(() => client.callTool({
        name: 'ace_workspace_status',
        arguments: { workspace_id: 'dbc09-sdk-workspace' },
      })),
    );
    for (const status of statuses) {
      assert.equal(status.isError, undefined);
      assert.equal((status.structuredContent as { index_status: string }).index_status, 'not_ready');
    }

    await assert.rejects(
      client.callTool({ name: 'ace_missing_tool', arguments: {} }),
      (error: unknown) => error instanceof Error && /not found/i.test(error.message),
    );
  } finally {
    await client.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test('DBC-09 official MCP cancellation reaches the tool callback without late success', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createAceServer({
    handle: () => Effect.promise(() => new Promise((resolve) => {
      setTimeout(() => resolve({ status: 'ok' as const, result: { late: true } }), 1_000);
    })),
  });
  const client = new Client({ name: 'ace-sdk-cancellation-client', version: '1.0.0' });
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const controller = new AbortController();
    const request = client.callTool({
      name: 'ace_workspace_status',
      arguments: { workspace_id: 'cancelled-workspace' },
    }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 25).unref();
    await assert.rejects(request, (error: unknown) => error instanceof Error && /abort|cancel/i.test(error.message));
  } finally {
    await client.close();
    await server.close();
  }
});
