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
      ? contextTransportText(payload)
      : toolName === 'ace_expand' && response.status === 'ok'
        ? typeof payload.content_utf8 === 'string'
          ? `Exact UTF-8 source is in structuredContent.content_utf8 (offset=${String(payload.offset ?? '?')}, total_bytes=${String(payload.total_bytes ?? '?')}).`
          : 'Exact original bytes are in structuredContent.content_base64; use format=utf8 for readable code.'
        : JSON.stringify(payload) }],
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
    description: 'For ambiguous cross-file code investigations, find verified symbol locations without dumping whole files. Prefer native tools for trivial known-file edits; do not duplicate file scans when ACE already returns fresh evidence. Default locate gives a concise map; intent=inspect gives full selected snippets. ace_expand retrieves exact originals.',
    inputSchema: z.object({
      workspace_id: z.string().min(1),
      query: z.string(),
      intent: z.string().optional(),
      include_code: z.boolean().optional(),
      include_docs: z.boolean().optional(),
      include_memory: z.boolean().optional(),
      include_history: z.boolean().optional(),
      known_bundle_id: z.string().min(1).optional(),
      known_evidence_ids: z.string().min(1).array().max(1000).optional(),
      working_context: z.object({
        focused_path: z.string().min(1).optional(),
        open_paths: z.string().min(1).array().max(100).optional(),
        focused_range: z.object({
          start_line: z.number().int().positive(),
          end_line: z.number().int().positive(),
        }).strict().optional(),
      }).strict().optional(),
      source_obligations: z.object({
        required: z.enum(['code', 'structural', 'lsp', 'documentation', 'memory', 'history']).array().optional(),
        optional: z.enum(['code', 'structural', 'lsp', 'documentation', 'memory', 'history']).array().optional(),
      }).strict().optional(),
    }),
  }, async (args, extra) => run('ace_context', args, extra.mcpReq.signal));

  server.registerTool('ace_expand', {
    description: 'Expand an exact source artifact by handle. For readable source code set format=utf8 (lossless UTF-8 per page); default base64 preserves arbitrary bytes. No silent truncation.',
    inputSchema: z.object({
      handle: z.string().min(1),
      cursor: z.string().optional(),
      max_bytes: z.number().int().positive().optional(),
      format: z.enum(['base64', 'utf8']).optional(),
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
