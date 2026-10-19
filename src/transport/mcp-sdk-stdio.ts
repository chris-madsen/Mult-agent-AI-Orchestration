import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Effect } from 'effect';
import * as z from 'zod/v4';
import type { GatewayResponse, ToolCall } from '../gateway/mcp-gateway.js';

export interface McpGatewayLike {
  readonly handle: (call: ToolCall) => Effect.Effect<GatewayResponse>;
}

const toToolResult = (response: GatewayResponse) => {
  const payload: Readonly<Record<string, unknown>> = response.status === 'ok'
    ? response.result
    : response;
  return {
    ...(response.status === 'ok' ? {} : { isError: true }),
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
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
    if (signal?.aborted === true) return cancelledToolResult();
    const operation = Effect.runPromise(gateway.handle({ name, arguments: args }));
    try {
      const response = await new Promise<GatewayResponse | undefined>((resolve, reject) => {
        let settled = false;
        const onAbort = (): void => {
          if (settled) return;
          settled = true;
          resolve(undefined);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        operation.then((value) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        }, (error: unknown) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        });
      });
      return response === undefined ? cancelledToolResult() : toToolResult(response);
    } catch (error) {
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
    description: 'Retrieve source-attributed workspace context when configured.',
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
