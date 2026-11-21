import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
  createContextRpcServer,
  handleContextRpcHttp,
  isLoopbackContextRpcHost,
  maxEnvelopeBytesFor,
  runContextRpcHttp,
} from '../src/transport/context-rpc-http.js';
import { ok } from '../src/domain/result.js';

let projectCalls = 0;
const service = {
  projectResponses: () => {
    projectCalls += 1;
    return Effect.succeed(ok({ kind: 'BLOCK' as const, reasonCode: 'ROUTE_NOT_CERTIFIED', baseBodySha256: 'a'.repeat(64) }));
  },
};

test('gateway HTTP host validation accepts loopback addresses only', () => {
  for (const host of ['127.0.0.1', '127.10.20.30', '::1', '0:0:0:0:0:0:0:1', 'localhost', 'LOCALHOST']) {
    assert.equal(isLoopbackContextRpcHost(host), true, host);
  }
  for (const host of ['0.0.0.0', '192.168.1.4', '::', 'example.com', '127.0.0.1.example.com']) {
    assert.equal(isLoopbackContextRpcHost(host), false, host);
  }
});

test('gateway HTTP rejects non-loopback options and environment hosts before listening', async () => {
  await assert.rejects(runContextRpcHttp(service, { host: '0.0.0.0' }), /loopback address/u);

  const previousHost = process.env.ACE_CONTEXT_RPC_HOST;
  process.env.ACE_CONTEXT_RPC_HOST = '192.168.1.4';
  try {
    await assert.rejects(runContextRpcHttp(service), /loopback address/u);
  } finally {
    if (previousHost === undefined) delete process.env.ACE_CONTEXT_RPC_HOST;
    else process.env.ACE_CONTEXT_RPC_HOST = previousHost;
  }
});

test('ACE context RPC exposes v3 internal health and capabilities', async () => {
  const health = await handleContextRpcHttp(service, 'GET', '/internal/ace-context/v3/health', '');
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.schemaVersion, 'ace.context.v3');
  assert.equal(health.body.providerWire, 'not_certified');
  const capabilities = await handleContextRpcHttp(service, 'GET', '/internal/ace-context/v3/capabilities', '');
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.body.schemaVersion, 'ace.context.v3');
  assert.deepEqual(capabilities.body.routes, [], 'provider generation must not be advertised before certification');
});

test('capabilities report the effective configured raw body limit', async () => {
  const server = createContextRpcServer(service, { authToken: 'limit-fixture', maxBodyBytes: 1024 });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/internal/ace-context/v3/capabilities`,
      { headers: { Authorization: 'Bearer limit-fixture' } },
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { maxBodyBytes: number };
    assert.equal(body.maxBodyBytes, 1024);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('native Responses projection returns a typed denial until dispatch is certified', async () => {
  projectCalls = 0;
  const projected = await handleContextRpcHttp(service, 'POST', '/internal/ace-context/v3/project', '{}');
  assert.equal(projected.statusCode, 200);
  assert.equal(projected.body.kind, 'BLOCK');
  assert.equal(projected.body.reasonCode, 'ROUTE_NOT_CERTIFIED');
  assert.equal(projectCalls, 1);
  const missing = await handleContextRpcHttp(service, 'POST', '/unknown', '{}');
  assert.equal(missing.statusCode, 404);
  assert.equal(projectCalls, 1, 'unknown endpoints must not invoke the projection service');
  const unsupportedMethod = await handleContextRpcHttp(
    service, 'GET', '/internal/ace-context/v3/project', '{}',
  );
  assert.equal(unsupportedMethod.statusCode, 405);
});

test('ACE context RPC rejects provider-delivery recording because Bifröst owns it', async () => {
  const result = await handleContextRpcHttp(service, 'POST', '/internal/ace-context/v3/record-delivery', '{}');
  assert.equal(result.statusCode, 404);
});

test('attempt authorization is an authenticated ACE source-policy route', async () => {
  const body = {
    schemaVersion: 'ace.context.v3', attemptId: 'bf-attempt-' + 'a'.repeat(32),
    bodySha256: 'b'.repeat(64), requestId: 'ace-' + 'c'.repeat(32),
  };
  let calls = 0;
  const decisionService = {
    authorizePhysicalSend: (value: unknown) => {
      calls += 1;
      assert.deepEqual(value, body);
      return Effect.succeed(ok({
        kind: 'BLOCK' as const, attemptId: body.attemptId,
        bodySha256: body.bodySha256, reasonCode: 'PROJECTION_RECEIPT_INVALID',
      }));
    },
  };
  const result = await handleContextRpcHttp(
    decisionService, 'POST', '/internal/ace-context/v3/authorize-attempt', JSON.stringify(body),
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.kind, 'BLOCK');
  assert.equal(result.body.reasonCode, 'PROJECTION_RECEIPT_INVALID');
  assert.equal(calls, 1);

  const server = createContextRpcServer(decisionService, { authToken: 'attempt-test-secret' });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/internal/ace-context/v3/authorize-attempt`;
  try {
    const anonymous = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
    assert.equal(anonymous.status, 401);
    const authorized = await fetch(url, {
      method: 'POST', headers: { Authorization: 'Bearer attempt-test-secret' }, body: JSON.stringify(body),
    });
    assert.equal(authorized.status, 200);
    const decision = await authorized.json() as { kind: string; attemptId: string };
    assert.equal(decision.kind, 'BLOCK');
    assert.equal(decision.attemptId, body.attemptId);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const missingAuthorizer = await handleContextRpcHttp(
    service, 'POST', '/internal/ace-context/v3/authorize-attempt', JSON.stringify(body),
  );
  assert.equal(missingAuthorizer.statusCode, 503);
});

test('gateway allows Base64 and JSON framing beyond the raw four MiB body limit', () => {
  const rawBytes = 4 * 1024 * 1024;
  const encodedBytes = Buffer.alloc(rawBytes).toString('base64').length;
  assert.ok(encodedBytes > rawBytes);
  assert.ok(maxEnvelopeBytesFor(rawBytes) >= encodedBytes + rawBytes + 1024, 'query duplicates the user message outside Base64');
});

test('disconnect interrupts a long-running local projection instead of leaving retrieval running', async () => {
  let started!: () => void;
  let finalized!: () => void;
  const began = new Promise<void>((resolve) => { started = resolve; });
  const interrupted = new Promise<void>((resolve) => { finalized = resolve; });
  const hanging = {
    projectResponses: () => Effect.sync(() => started()).pipe(
      Effect.zipRight(Effect.never),
      Effect.onInterrupt(() => Effect.sync(() => finalized())),
    ),
  };
  const server = createContextRpcServer(hanging, { authToken: 'interrupt-fixture' });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const controller = new AbortController();
    const request = fetch(`http://127.0.0.1:${address.port}/internal/ace-context/v3/project`, {
      method: 'POST',
      headers: { Authorization: 'Bearer interrupt-fixture' },
      body: '{}', signal: controller.signal,
    }).catch(() => undefined);
    await began;
    controller.abort();
    await Promise.race([
      interrupted,
      new Promise<never>((_resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('projection was not interrupted after disconnect')), 3000);
        timeout.unref();
      }),
    ]);
    await request;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('native projection HTTP refuses local callers without the configured shared secret', async () => {
  const server = createContextRpcServer(service, { authToken: 'in-memory-test-token' });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/internal/ace-context/v3/project`;
  try {
    const anonymous = await fetch(url, { method: 'POST', body: '{}' });
    assert.equal(anonymous.status, 401);
    const wrong = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}' });
    assert.equal(wrong.status, 401);
    const anonymousHealth = await fetch(url.replace('/project', '/health'));
    assert.equal(anonymousHealth.status, 401);
    const authenticated = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer in-memory-test-token' },
      body: '{}',
    });
    assert.equal(authenticated.status, 200);
    const result = await authenticated.json() as { kind: string; reasonCode: string };
    assert.equal(result.kind, 'BLOCK');
    assert.equal(result.reasonCode, 'ROUTE_NOT_CERTIFIED');
    const authorizedHealth = await fetch(url.replace('/project', '/health'), {
      headers: { Authorization: 'Bearer in-memory-test-token' },
    });
    assert.equal(authorizedHealth.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('native projection HTTP without a server credential is NOT_READY, not public', async () => {
  const server = createContextRpcServer(service, { authToken: '' });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const reply = await fetch(`http://127.0.0.1:${address.port}/internal/ace-context/v3/project`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(reply.status, 503);
    const health = await fetch(`http://127.0.0.1:${address.port}/internal/ace-context/v3/health`);
    assert.equal(health.status, 503);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('only the internal ACE context v3 routes are recognized; obsolete RPC paths are not aliases', async () => {
  for (const old of ['/project', '/authorize-attempt'].map((suffix) => '/internal/ace' + '-gateway/v2' + suffix)) {
    const blocked = await handleContextRpcHttp(service, 'POST', old, '{}');
    assert.equal(blocked.statusCode, 404);
  }
  for (const modelRoute of ['/v1/responses', '/chatgpt_passthrough/backend-api/codex/responses', '/internal/ace-context/v3/generate']) {
    const result = await handleContextRpcHttp(service, 'POST', modelRoute, '{}');
    assert.equal(result.statusCode, 404, modelRoute);
  }
  const response = await handleContextRpcHttp(service, 'POST', '/internal/ace-context/v3/unsupported', '{}');
  assert.equal(response.statusCode, 404);
});
