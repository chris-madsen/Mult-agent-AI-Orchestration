import { createInterface } from 'node:readline';
import { Effect } from 'effect';
import type { GatewayResponse, ToolCall } from '../gateway/mcp-gateway.js';

export interface McpGatewayLike {
  readonly handle: (call: ToolCall) => Effect.Effect<GatewayResponse>;
}

type JsonRpcId = string | number;

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

const tools = [
  {
    name: 'ace_context',
    description: 'Retrieve source-attributed context from the registered workspace.',
    inputSchema: {
      type: 'object',
      required: ['workspace_id', 'query'],
      properties: {
        workspace_id: { type: 'string' },
        query: { type: 'string' },
        intent: { type: 'string' },
        include_docs: { type: 'boolean' },
        include_memory: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ace_expand',
    description: 'Read an exact artifact range without silent truncation.',
    inputSchema: {
      type: 'object',
      required: ['handle'],
      properties: {
        handle: { type: 'string' },
        cursor: { type: 'string' },
        max_bytes: { type: 'number', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ace_workspace_status',
    description: 'Report observed workspace and index freshness state.',
    inputSchema: {
      type: 'object',
      required: ['workspace_id'],
      properties: { workspace_id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'ace_memory_search',
    description: 'Search project memory when a memory provider is configured.',
    inputSchema: {
      type: 'object',
      required: ['workspace_id', 'query'],
      properties: {
        workspace_id: { type: 'string' },
        query: { type: 'string' },
        as_of: { type: 'string' },
        include_original: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
] as const;

const json = (value: unknown): string => JSON.stringify(value);

const responseForGateway = (response: GatewayResponse): Readonly<Record<string, unknown>> => {
  if (response.status === 'ok') {
    return {
      isError: false,
      structuredContent: response.result,
      content: [{ type: 'text', text: json(response.result) }],
    };
  }
  return {
    isError: true,
    structuredContent: response,
    content: [{ type: 'text', text: json(response) }],
  };
};

const errorResponse = (id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

const isRequest = (value: unknown): value is JsonRpcRequest => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.jsonrpc === '2.0' && typeof candidate.method === 'string';
};

export const handleMcpMessage = async (
  gateway: McpGatewayLike,
  input: unknown,
): Promise<JsonRpcResponse | undefined> => {
  if (!isRequest(input)) return errorResponse(null, -32600, 'Invalid Request');
  const id = input.id ?? null;
  if (input.id === undefined && input.method !== 'notifications/initialized') return undefined;
  if (input.method === 'notifications/initialized') return undefined;
  if (input.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ace-harness', version: '0.1.0' },
      },
    };
  }
  if (input.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } };
  if (input.method !== 'tools/call') return errorResponse(id, -32601, `Method not found: ${input.method}`);
  if (typeof input.params !== 'object' || input.params === null) return errorResponse(id, -32602, 'tools/call params must be an object');
  const params = input.params as Record<string, unknown>;
  if (typeof params.name !== 'string') return errorResponse(id, -32602, 'tools/call requires a tool name');
  try {
    const response = await Effect.runPromise(gateway.handle({ name: params.name, arguments: params.arguments }));
    return { jsonrpc: '2.0', id, result: responseForGateway(response) };
  } catch (cause) {
    return errorResponse(id, -32603, 'ACE gateway failed', { cause: cause instanceof Error ? cause.message : 'unknown error' });
  }
};

export const runMcpStdio = async (
  gateway: McpGatewayLike,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> => {
  const lines = createInterface({ input });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      output.write(`${json(errorResponse(null, -32700, 'Parse error'))}\n`);
      continue;
    }
    const response = await handleMcpMessage(gateway, value);
    if (response !== undefined) output.write(`${json(response)}\n`);
  }
};

export const mcpToolDefinitions = tools;
