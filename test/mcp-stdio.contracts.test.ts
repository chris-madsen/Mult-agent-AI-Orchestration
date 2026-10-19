import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { handleMcpMessage, mcpToolDefinitions } from '../src/transport/mcp-stdio.js';

test('MCP stdio contract exposes initialize and the unified tool surface', async () => {
  const gateway = { handle: () => Effect.succeed({ status: 'ok' as const, result: { ready: true } }) };
  const initialized = await handleMcpMessage(gateway, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  assert.equal(initialized?.result && (initialized.result as { serverInfo: { name: string } }).serverInfo.name, 'ace-harness');
  const listed = await handleMcpMessage(gateway, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(((listed?.result as { tools: readonly unknown[] }).tools).length, mcpToolDefinitions.length);
});

test('MCP tools/call delegates to the typed gateway and preserves structured content', async () => {
  const gateway = {
    handle: (call: { readonly name: string; readonly arguments: unknown }) =>
      Effect.succeed({ status: 'ok' as const, result: { tool: call.name, arguments: call.arguments } }),
  };
  const response = await handleMcpMessage(gateway, {
    jsonrpc: '2.0',
    id: 'call-1',
    method: 'tools/call',
    params: { name: 'ace_workspace_status', arguments: { workspace_id: 'w-1' } },
  });
  const result = response?.result as { isError: boolean; structuredContent: { tool: string } };
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.tool, 'ace_workspace_status');
});

test('MCP notifications do not produce responses', async () => {
  const gateway = { handle: () => Effect.succeed({ status: 'ok' as const, result: {} }) };
  assert.equal(await handleMcpMessage(gateway, { jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
});


test('ace_context tool schema exposes explicit include_code override', () => {
  const context = mcpToolDefinitions.find((tool) => tool.name === 'ace_context');
  assert.notEqual(context, undefined);
  if (context === undefined) return;
  const schema = context.inputSchema as {
    readonly properties?: Readonly<Record<string, unknown>>;
  };
  assert.ok(schema.properties?.include_code);
});
