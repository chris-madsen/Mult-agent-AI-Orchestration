import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Effect } from 'effect';
import * as z from 'zod/v4';
import type { GatewayResponse, ToolCall } from '../gateway/mcp-gateway.js';
import { contextTransportText } from '../domain/context-delivery.js';

export interface McpGatewayLike {
  readonly handle: (call: ToolCall) => Effect.Effect<GatewayResponse>;
}

const toToolResult = (response: GatewayResponse, toolName?: string) => {
  const payload: Readonly<Record<string, unknown>> = response.status === 'ok'
    ? response.result
    : response;
  return {
    ...(response.status === 'ok' ? {} : { isError: true }),
    // Context must not be mirrored in full as BOTH MCP text and structured data.
    // The short navigation text cites sources; structuredContent owns the body.
    content: [{ type: 'text' as const, text: toolName === 'ace_context' && response.status === 'ok'
      ? contextTransportText(payload) : JSON.stringify(payload) }],
    structuredContent: { ...payload },
  };
};

const cancelledToolResult = () => ({
  isError: true,
  content: [{ type: 'text' as const, text: 'ACE request cancelled' }],
  structuredContent: { status: 'error', code: 'REQUEST_CANCELLED' },
});

// The official v2 SDK owns framing, protocol initialization, request validation,
// cancellation and stdio lifecycle. Do not reimplement the protocol in ACE.
export const createAceServer = (gateway: McpGatewayLike): McpServer => {
  const server = new McpServer({ name: 'ace-harness', version: '0.1.0' });
  const run = async (name: string, args: unknown, signal?: AbortSignal) => {
    const isAborted = (): boolean => signal?.aborted === true;
    if (isAborted()) return cancelledToolResult();
    try {
      const operation = gateway.handle({ name, arguments: args });
      const response = signal === undefined
        ? await Effect.runPromise(operation)
        : await Effect.runPromise(operation, { signal });
      return toToolResult(response, name);
    } catch (error) {
      if (isAborted()) return cancelledToolResult();
      // The thrown failure is an ACE error, not an invitation to leak a stack trace.
      process.stderr.write(`ace gateway failure: ${error instanceof Error ? error.message : 'unknown error'}\n`);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: 'ACE gateway failed' }],
        structuredContent: { status: 'error', code: 'GATEWAY_FAILURE' },
      };
    }
  };
  server.registerTool('ace_context', {
    description: 'Find relevant verified code symbols. Default locate mode returns short source map and compact snippets; intent=inspect returns full selected snippets. Use ace_expand for byte-exact originals.',
    inputSchema: z.object({
      workspace_id: z.string().min(1),
      query: z.string(),
      intent: z.string().optional(),
      include_docs: z.boolean().optional(),
      include_memory: z.boolean().optional(),
    }),
  }, async (args, extra) => run('ace_context', args, extra.mcpReq.signal));

  server.registerTool('ace_expand', {
    description: 'Read an exact stored artifact byte range without silent truncation.',
    inputSchema: z.object({
      handle: z.string().min(1),
      cursor: z.string().optional(),
      max_bytes: z.number().int().positive().optional(),
    }),
  }, async (args, extra) => run('ace_expand', args, extra.mcpReq.signal));

  server.registerTool('ace_workspace_status', {
    description: 'Report the workspace observation and provider readiness status.',
    inputSchema: z.object({ workspace_id: z.string().min(1) }),
  }, async (args, extra) => run('ace_workspace_status', args, extra.mcpReq.signal));

  server.registerTool('ace_memory_search', {
    description: 'Search source-attributed project memory when a memory provider is configured.',
    inputSchema: z.object({
      workspace_id: z.string().min(1),
      query: z.string(),
      as_of: z.string().optional(),
      include_original: z.boolean().optional(),
    }),
  }, async (args, extra) => run('ace_memory_search', args, extra.mcpReq.signal));

  return server;
};

export const runMcpSdkStdio = async (gateway: McpGatewayLike): Promise<void> => {
  await serveStdio(() => createAceServer(gateway));
};
