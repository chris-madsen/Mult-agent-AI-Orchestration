import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Effect } from 'effect';
import type { DomainError } from '../domain/errors.js';
import type { Result } from '../domain/result.js';
import type { GatewayProjectionDecision } from '../domain/gateway-projection.js';

export interface GatewayProjectionHttpService {
  readonly project: (value: unknown) => Effect.Effect<Result<GatewayProjectionDecision, DomainError>>;
}

export interface GatewayProjectionHttpOptions {
  readonly host?: string;
  readonly port?: number;
  readonly maxBodyBytes?: number;
}

export interface GatewayProjectionHttpResponse {
  readonly statusCode: number;
  readonly body: Readonly<Record<string, unknown>>;
}

const schemaVersion = 'ace.gateway.v1';
const defaultMaxBodyBytes = 4 * 1024 * 1024;
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

const json = (body: Readonly<Record<string, unknown>>): GatewayProjectionHttpResponse => ({
  statusCode: 200,
  body,
});

const error = (statusCode: number, code: string, message: string): GatewayProjectionHttpResponse => ({
  statusCode,
  body: { error: { code, message } },
});

export const handleGatewayProjectionHttp = async (
  service: GatewayProjectionHttpService,
  method: string,
  path: string,
  body: string,
): Promise<GatewayProjectionHttpResponse> => {
  if (method === 'GET' && path === '/internal/ace-gateway/v1/health') {
    return json({ schemaVersion, liveness: 'ready', readiness: 'adapter_implemented', providerWire: 'not_certified' });
  }
  if (method === 'GET' && path === '/internal/ace-gateway/v1/capabilities') {
    return json({
      schemaVersion,
      routes: [{ protocol: 'openai.chat.completions', mode: 'structured', capability: 'G2_GATEWAY_VISIBLE_ONLY' }],
      maxBodyBytes: defaultMaxBodyBytes,
      projectionModes: ['native', 'gateway', 'assist-only', 'observe-only', 'off'],
      providerWireCertification: 'not_certified',
    });
  }
  if (method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', 'unsupported gateway method');
  if (path === '/internal/ace-gateway/v1/record-delivery') {
    return error(501, 'PROVIDER_WIRE_NOT_CERTIFIED', 'delivery recording requires a verified final-send integration');
  }
  if (path !== '/internal/ace-gateway/v1/project') return error(404, 'NOT_FOUND', 'unknown gateway endpoint');
  let input: unknown;
  try {
    input = JSON.parse(body) as unknown;
  } catch {
    return error(400, 'INVALID_INPUT', 'request body is not valid JSON');
  }
  try {
    const result = await Effect.runPromise(service.project(input));
    if (result._tag === 'Err') return error(400, result.error.code, result.error.message);
    return json(result.value as unknown as Readonly<Record<string, unknown>>);
  } catch {
    return error(503, 'NOT_READY', 'gateway projection service is unavailable');
  }
};

const writeResponse = (response: ServerResponse, result: GatewayProjectionHttpResponse): void => {
  response.writeHead(result.statusCode, jsonHeaders);
  response.end(JSON.stringify(result.body));
};

const readRequestBody = async (request: IncomingMessage, maxBodyBytes: number): Promise<string> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBodyBytes) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

export const createGatewayProjectionServer = (
  service: GatewayProjectionHttpService,
  options: GatewayProjectionHttpOptions = {},
): Server => {
  const maxBodyBytes = options.maxBodyBytes ?? defaultMaxBodyBytes;
  return createServer(async (request, response) => {
    try {
      const body = await readRequestBody(request, maxBodyBytes);
      writeResponse(response, await handleGatewayProjectionHttp(service, request.method ?? 'GET', request.url ?? '/', body));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'gateway request failed';
      writeResponse(response, error(message === 'BODY_TOO_LARGE' ? 413 : 400, message, message === 'BODY_TOO_LARGE' ? 'request body exceeds gateway bound' : 'request could not be read'));
    }
  });
};

export const runGatewayProjectionHttp = async (
  service: GatewayProjectionHttpService,
  options: GatewayProjectionHttpOptions = {},
): Promise<void> => {
  const server = createGatewayProjectionServer(service, options);
  const host = options.host ?? process.env.ACE_GATEWAY_HTTP_HOST ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.ACE_GATEWAY_HTTP_PORT ?? '8765');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      process.stderr.write(`ace-gateway-http listening host=${host} port=${port} schema=${schemaVersion}\n`);
    });
    const shutdown = (): void => {
      server.close(() => resolve());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
};
