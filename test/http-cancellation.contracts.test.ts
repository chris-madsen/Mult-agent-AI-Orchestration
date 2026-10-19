import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Effect } from 'effect';
import { makeFetchHttpPort } from '../src/adapters/http-provider-boundaries.js';

const listen = async (): Promise<{
  readonly url: string;
  readonly waitForRequest: Promise<void>;
  readonly waitForClose: Promise<void>;
  readonly close: () => Promise<void>;
}> => {
  let requestResolve: (() => void) | undefined;
  let closeResolve: (() => void) | undefined;
  const waitForRequest = new Promise<void>((resolve) => { requestResolve = resolve; });
  const waitForClose = new Promise<void>((resolve) => { closeResolve = resolve; });
  const server = createServer((request, response) => {
    void request;
    requestResolve?.();
    response.on('close', () => closeResolve?.());
    // Deliberately never send headers/body. The client must cancel/timeout.
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test HTTP server did not bind TCP');
  return {
    url: `http://127.0.0.1:${address.port}/hang`,
    waitForRequest,
    waitForClose,
    close: async () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  };
};

const within = async <T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label + ' timed out')), milliseconds);
      timer.unref();
    }),
  ]);

test('Effect cancellation aborts an in-flight fetch socket instead of leaving provider I/O alive', async () => {
  const server = await listen();
  const port = makeFetchHttpPort();
  const controller = new AbortController();
  try {
    const running = Effect.runPromise(port.request({
      method: 'GET',
      url: server.url,
      timeoutMs: 10_000,
    }), { signal: controller.signal }).catch(() => undefined);

    await within(server.waitForRequest, 1_000, 'request arrival');
    controller.abort();
    await within(running, 1_000, 'Effect cancellation');
    await within(server.waitForClose, 1_000, 'server-side socket close');
  } finally {
    await server.close();
  }
});

test('HTTP timeout returns explicit provider failure and closes the hanging socket', async () => {
  const server = await listen();
  const port = makeFetchHttpPort();
  try {
    const running = Effect.runPromise(port.request({
      method: 'GET',
      url: server.url,
      timeoutMs: 200,
    }));
    await within(server.waitForRequest, 1_000, 'request arrival');
    const result = await within(running, 1_000, 'HTTP timeout result');
    assert.equal(result._tag, 'Err');
    if (result._tag === 'Err') assert.equal(result.error.code, 'EXTERNAL_UNAVAILABLE');
    await within(server.waitForClose, 1_000, 'server-side timeout socket close');
  } finally {
    await server.close();
  }
});
