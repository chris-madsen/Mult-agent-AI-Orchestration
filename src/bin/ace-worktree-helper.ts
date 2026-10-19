#!/usr/bin/env node
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import type { TLSSocket } from 'node:tls';
import {
  makeHostWorktreeHelperService,
  type HostWorktreeRequest,
  type HostWorktreeWireResult,
} from '../adapters/host-worktree-helper.js';

const required = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(key + ' is required');
  return value;
};

const integerEnv = (key: string, fallback: number, minimum: number, maximum: number): number => {
  const raw = process.env[key]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
};

const run = async (): Promise<void> => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(required('ACE_WORKTREE_HELPER_WORKSPACES_JSON'));
  } catch {
    throw new Error('ACE_WORKTREE_HELPER_WORKSPACES_JSON must be valid JSON');
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)
    || !Object.values(decoded).every((value) => typeof value === 'string' && value.trim().length > 0)) {
    throw new Error('ACE_WORKTREE_HELPER_WORKSPACES_JSON must map workspace IDs to host directories');
  }
  const service = await makeHostWorktreeHelperService(decoded as Record<string, string>);
  if (service._tag === 'Err') throw new Error(service.error.message);

  const [cert, key, ca] = await Promise.all([
    readFile(required('ACE_WORKTREE_HELPER_TLS_CERT')),
    readFile(required('ACE_WORKTREE_HELPER_TLS_KEY')),
    readFile(required('ACE_WORKTREE_HELPER_TLS_CA')),
  ]);
  const host = process.env.ACE_WORKTREE_HELPER_HOST?.trim() || '0.0.0.0';
  const port = integerEnv('ACE_WORKTREE_HELPER_PORT', 7443, 1, 65_535);
  const maxRequestBytes = integerEnv('ACE_WORKTREE_HELPER_MAX_REQUEST_BYTES', 1024 * 1024, 1024, 16 * 1024 * 1024);

  const server = createServer({
    cert,
    key,
    ca,
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  }, (request, response) => {
    const socket = request.socket as TLSSocket;
    if (!socket.authorized) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'AUTH_REQUIRED', path: 'mtls', message: 'client certificate is not authorized' } }));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/worktree') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'INVALID_INPUT', path: 'route', message: 'unsupported helper route' } }));
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;
    request.on('data', (chunk: Buffer) => {
      if (rejected) return;
      total += chunk.length;
      if (total > maxRequestBytes) {
        rejected = true;
        response.writeHead(413, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: { code: 'INVALID_INPUT', path: 'request', message: 'helper request exceeds size limit' } }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      void (async () => {
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: { code: 'INVALID_INPUT', path: 'request', message: 'helper request must be JSON' } }));
          return;
        }
        if (typeof body !== 'object' || body === null || Array.isArray(body)
          || typeof (body as { operation?: unknown }).operation !== 'string'
          || typeof (body as { workspaceId?: unknown }).workspaceId !== 'string') {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: { code: 'INVALID_INPUT', path: 'request', message: 'helper request shape is invalid' } }));
          return;
        }
        const result = await service.value.handle(body as HostWorktreeRequest);
        const wire: HostWorktreeWireResult = result._tag === 'Ok'
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error };
        response.writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        response.end(JSON.stringify(wire));
      })();
    });
    request.on('error', () => {
      if (!response.headersSent) response.writeHead(400, { 'content-type': 'application/json' });
      if (!response.writableEnded) response.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  process.stderr.write(`ace-worktree-helper ready port=${port} workspaces=${Object.keys(decoded).length}\n`);

  const shutdown = (): void => {
    server.close(() => {
      process.exitCode = 0;
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
};

run().catch((cause: unknown) => {
  process.stderr.write('ACE worktree helper: ' + (cause instanceof Error ? cause.message : 'unknown error') + '\n');
  process.exitCode = 1;
});
