import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeVertexRagRetrievalPort } from '../src/adapters/vertex-rag.js';
import { defaultLocalPolicy } from '../src/domain/policy.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok } from '../src/domain/result.js';
import type { HttpPort, HttpRequest } from '../src/application/ports.js';

const workspace = makeWorkspaceId('vertex-auth-refresh-workspace');
if (workspace._tag === 'Err') throw new Error(workspace.error.message);

const policy = {
  ...defaultLocalPolicy(workspace.value),
  cloudOptIn: true,
  allowedCloudProviders: ['vertex'] as const,
};

test('Vertex retries exactly once with a newly acquired token after HTTP 401', async () => {
  const tokens = ['expired-token', 'fresh-token'];
  let tokenCalls = 0;
  const requests: HttpRequest[] = [];
  const http: HttpPort = {
    request: (request) => {
      requests.push(request);
      const authorization = request.headers?.authorization;
      return Effect.succeed(ok(authorization === 'Bearer expired-token'
        ? { status: 401, body: { error: 'expired' } }
        : { status: 200, body: {} }));
    },
  };
  const provider = makeVertexRagRetrievalPort({
    project: 'ace-dev',
    location: 'europe-west4',
    corpusId: 'fixture',
    accessToken: () => tokens[tokenCalls++] as string | undefined,
    policy,
    http,
  });

  const result = await Effect.runPromise(provider.search({
    workspaceId: workspace.value,
    query: 'architecture rationale',
    topK: 3,
    requestId: 'vertex-auth-refresh-1',
  }));
  assert.equal(result._tag, 'Ok');
  assert.equal(tokenCalls, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.headers?.authorization, 'Bearer expired-token');
  assert.equal(requests[1]?.headers?.authorization, 'Bearer fresh-token');
});

test('Vertex does not replay a 401 when token refresh returns the same credential', async () => {
  let tokenCalls = 0;
  let requests = 0;
  const provider = makeVertexRagRetrievalPort({
    project: 'ace-dev',
    location: 'europe-west4',
    corpusId: 'fixture',
    accessToken: () => {
      tokenCalls += 1;
      return 'same-expired-token';
    },
    policy,
    http: {
      request: () => {
        requests += 1;
        return Effect.succeed(ok({ status: 401, body: {} }));
      },
    },
  });

  const result = await Effect.runPromise(provider.search({
    workspaceId: workspace.value,
    query: 'architecture rationale',
    topK: 3,
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'AUTH_REQUIRED');
  assert.equal(tokenCalls, 2);
  assert.equal(requests, 1);
});

test('Vertex does not treat HTTP 403 as an expired-token retry signal', async () => {
  let tokenCalls = 0;
  let requests = 0;
  const provider = makeVertexRagRetrievalPort({
    project: 'ace-dev',
    location: 'europe-west4',
    corpusId: 'fixture',
    accessToken: () => {
      tokenCalls += 1;
      return 'valid-but-insufficient-token';
    },
    policy,
    http: {
      request: () => {
        requests += 1;
        return Effect.succeed(ok({ status: 403, body: {} }));
      },
    },
  });

  const result = await Effect.runPromise(provider.search({
    workspaceId: workspace.value,
    query: 'architecture rationale',
    topK: 3,
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'EXTERNAL_UNAVAILABLE');
  assert.equal(tokenCalls, 1);
  assert.equal(requests, 1);
});

test('policy denial happens before token acquisition and before every network attempt', async () => {
  let tokenCalls = 0;
  let requests = 0;
  const provider = makeVertexRagRetrievalPort({
    project: 'ace-dev',
    location: 'europe-west4',
    corpusId: 'fixture',
    accessToken: () => {
      tokenCalls += 1;
      return 'must-not-be-read';
    },
    policy: defaultLocalPolicy(workspace.value),
    http: {
      request: () => {
        requests += 1;
        return Effect.succeed(ok({ status: 200, body: {} }));
      },
    },
  });

  const result = await Effect.runPromise(provider.search({
    workspaceId: workspace.value,
    query: 'architecture rationale',
    topK: 3,
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'POLICY_DENIED');
  assert.equal(tokenCalls, 0);
  assert.equal(requests, 0);
});
