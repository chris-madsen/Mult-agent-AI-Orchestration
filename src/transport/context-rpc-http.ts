import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Effect } from 'effect';
import type { ResponsesProjectionService } from '../application/responses-projection-service.js';
import type { GatewayAttemptAuthorizationService } from '../application/gateway-attempt-authorization-service.js';
import { isIP } from 'node:net';
import type {
  ContextHealth as GeneratedContextHealth,
  ContextCapabilities as GeneratedContextCapabilities,
} from '../generated/ace-context/v3/types.gen.js';

export interface ContextRpcHttpService {
  readonly projectResponses?: ResponsesProjectionService['projectResponses'];
  readonly authorizePhysicalSend?: GatewayAttemptAuthorizationService['authorizePhysicalSend'];
}

export interface ContextRpcHttpOptions {
  readonly host?: string;
  readonly port?: number;
  readonly maxBodyBytes?: number;
  /** Shared token supplied out of band to the local Bifrost connector. */
  readonly authToken?: string;
}

export interface ContextRpcHttpResponse {
  readonly statusCode: number;
  readonly body: Readonly<Record<string, unknown>>;
}

const schemaVersion = 'ace.context.v3';
const defaultMaxBodyBytes = 4 * 1024 * 1024;
// The HTTP request is a JSON envelope containing Base64, not raw provider bytes.
// The query is repeated outside bodyBase64 and can occupy nearly all of the
// original provider body. Bound both representations, not just encoded bytes.
export const maxEnvelopeBytesFor = (bodyBytes: number): number => 4 * Math.ceil(bodyBytes / 3) + bodyBytes + 64 * 1024;
export const isLoopbackContextRpcHost = (host: string): boolean => {
  const normalizedHost = host.toLowerCase();
  if (normalizedHost === 'localhost') return true;
  const family = isIP(normalizedHost);
  if (family === 4) return normalizedHost.startsWith('127.');
  return family === 6 && (normalizedHost === '::1' || normalizedHost === '0:0:0:0:0:0:0:1');
};
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

const json = (body: Readonly<Record<string, unknown>>): ContextRpcHttpResponse => ({
  statusCode: 200,
  body,
});

const error = (statusCode: number, code: string, message: string): ContextRpcHttpResponse => ({
  statusCode,
  body: { error: { code, message } },
});

type ContextRpcRouteId = 'health' | 'capabilities' | 'project' | 'authorize-attempt' | 'not-found' | 'method-not-allowed';

const contextRpcRouteId = (method: string, path: string): ContextRpcRouteId => {
  switch (`${method} ${path}`) {
    case 'GET /internal/ace-context/v3/health': return 'health';
    case 'GET /internal/ace-context/v3/capabilities': return 'capabilities';
    case 'POST /internal/ace-context/v3/project': return 'project';
    case 'POST /internal/ace-context/v3/authorize-attempt': return 'authorize-attempt';
    default: return method === 'POST' ? 'not-found' : 'method-not-allowed';
  }
};

const healthRoute = async (): Promise<ContextRpcHttpResponse> => {
  const wire: GeneratedContextHealth = {
    schemaVersion, liveness: 'ready', readiness: 'adapter_implemented', providerWire: 'not_certified',
  };
  return json(wire as unknown as Readonly<Record<string, unknown>>);
};

const capabilitiesRoute = async (maxBodyBytes: number): Promise<ContextRpcHttpResponse> => {
  const wire: GeneratedContextCapabilities = {
    schemaVersion,
    // No provider generation route is advertised until final-wire certification.
    routes: [],
    maxBodyBytes,
    projectionModes: ['bifrost_hook'],
    providerWireCertification: 'not_certified',
  };
  return json(wire as unknown as Readonly<Record<string, unknown>>);
};

const projectRoute = async (
  service: ContextRpcHttpService,
  body: string,
  signal?: AbortSignal,
): Promise<ContextRpcHttpResponse> => {
  if (!service.projectResponses) return error(503, 'RESPONSES_NOT_READY', 'native Responses projector is not configured');
  let payload: unknown;
  try { payload = JSON.parse(body) as unknown; } catch {
    return error(400, 'INVALID_JSON', 'native Responses request must be JSON');
  }
  const response = await Effect.runPromise(service.projectResponses(payload), { signal });
  if (response._tag === 'Err') return error(400, response.error.code, response.error.message);
  // A policy denial is a typed projection decision, not an out-of-schema
  // error. The Go connector must still refuse BLOCK and never dispatch.
  return json(response.value);
};

const authorizeAttemptRoute = async (
  service: ContextRpcHttpService,
  body: string,
  signal?: AbortSignal,
): Promise<ContextRpcHttpResponse> => {
  if (!service.authorizePhysicalSend) return error(503, 'ATTEMPT_AUTHORIZATION_NOT_READY', 'physical-send authorization is not configured');
  let payload: unknown;
  try { payload = JSON.parse(body) as unknown; } catch {
    return error(400, 'INVALID_JSON', 'physical-send authorization must be JSON');
  }
  const response = await Effect.runPromise(service.authorizePhysicalSend(payload), { signal });
  if (response._tag === 'Err') {
    const status = response.error.code === 'INVALID_INPUT' ? 400 : 503;
    return error(status, response.error.code, response.error.message);
  }
  return json(response.value);
};

export const handleContextRpcHttp = (
  service: ContextRpcHttpService,
  method: string,
  path: string,
  body: string,
  maxBodyBytes = defaultMaxBodyBytes,
  signal?: AbortSignal,
): Promise<ContextRpcHttpResponse> => {
  switch (contextRpcRouteId(method, path)) {
    case 'health': return healthRoute();
    case 'capabilities': return capabilitiesRoute(maxBodyBytes);
    case 'project': return projectRoute(service, body, signal);
    case 'authorize-attempt': return authorizeAttemptRoute(service, body, signal);
    case 'method-not-allowed': return Promise.resolve(error(405, 'METHOD_NOT_ALLOWED', 'unsupported ACE context RPC method'));
    case 'not-found': return Promise.resolve(error(404, 'NOT_FOUND', 'unknown ACE context RPC endpoint'));
  }
};

const writeResponse = (response: ServerResponse, result: ContextRpcHttpResponse): void => {
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

const authorizedProjectionRequest = (value: string | undefined, token: string): boolean => {
  if (!value || !token) return false;
  const actual = Buffer.from(value, 'utf8');
  const expected = Buffer.from(`Bearer ${token}`, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export const createContextRpcServer = (
  service: ContextRpcHttpService,
  options: ContextRpcHttpOptions = {},
): Server => {
  const maxBodyBytes = options.maxBodyBytes ?? defaultMaxBodyBytes;
  const maxEnvelopeBytes = maxEnvelopeBytesFor(maxBodyBytes);
  return createServer(async (request, response) => {
    try {
      const token = options.authToken ?? process.env.ACE_CONTEXT_RPC_SHARED_SECRET;
      if (!token?.trim()) {
        writeResponse(response, error(503, 'NOT_READY', 'ACE context RPC authentication is not configured'));
        return;
      }
      if (!authorizedProjectionRequest(request.headers.authorization, token)) {
        writeResponse(response, error(401, 'UNAUTHORIZED', 'ACE context RPC authentication failed'));
        return;
      }
      const body = await readRequestBody(request, maxEnvelopeBytes);
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      request.once('aborted', abort);
      response.once('close', abort);
      try {
        const result = await handleContextRpcHttp(
          service, request.method ?? 'GET', request.url ?? '/', body, maxBodyBytes, controller.signal,
        );
        if (!response.destroyed) writeResponse(response, result);
      } finally {
        request.off('aborted', abort);
        response.off('close', abort);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'ACE context RPC request failed';
      if (!response.destroyed) {
        writeResponse(response, error(message === 'BODY_TOO_LARGE' ? 413 : 400, message,
          message === 'BODY_TOO_LARGE' ? 'request body exceeds ACE context RPC bound' : 'request could not be read'));
      }
    }
  });
};

export const runContextRpcHttp = async (
  service: ContextRpcHttpService,
  options: ContextRpcHttpOptions = {},
): Promise<void> => {
  const host = options.host ?? process.env.ACE_CONTEXT_RPC_HOST ?? '127.0.0.1';
  if (!isLoopbackContextRpcHost(host)) throw new Error('ACE context RPC host must be a loopback address');
  const server = createContextRpcServer(service, options);
  const port = options.port ?? Number(process.env.ACE_CONTEXT_RPC_PORT ?? '8765');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      process.stderr.write(`ace-context-rpc listening host=${host} port=${port} schema=${schemaVersion}\n`);
    });
    const shutdown = (): void => {
      server.close(() => resolve());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
};
