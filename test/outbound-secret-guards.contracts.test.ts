import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeGraphitiProjectionPort, makeVertexDocumentationPort } from '../src/adapters/http-provider-boundaries.js';
import { selectJevRouteOverHttp } from '../src/adapters/jev-route-provider.js';
import type { HttpPort } from '../src/application/ports.js';
import { defaultLocalPolicy, type ProjectDataPolicy } from '../src/domain/policy.js';
import { makeEpisodeId } from '../src/domain/memory.js';
import { containsLikelySecret } from '../src/domain/sensitive-text.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok, type Result } from '../src/domain/result.js';

const mustOk = <T, E>(value: Result<T, E>): T => {
  assert.equal(value._tag, 'Ok');
  if (value._tag === 'Err') throw new Error(String(value.error));
  return value.value;
};

const workspaceId = mustOk(makeWorkspaceId('secret-egress-workspace'));
const allowedPolicy: ProjectDataPolicy = {
  ...defaultLocalPolicy(workspaceId),
  cloudOptIn: true,
  allowedCloudProviders: ['vertex', 'jev', 'other_external'],
  allowedCloudDataClassesByProvider: {
    vertex: ['project_document'],
    jev: ['private_source', 'public'],
    other_external: ['private_conversation'],
  },
};

test('secret-bearing Vertex query is denied before token lookup and HTTP', async () => {
  let tokenCalls = 0;
  let httpCalls = 0;
  const http: HttpPort = {
    request: () => {
      httpCalls += 1;
      return Effect.succeed(ok({ status: 200, body: { documents: [] } }));
    },
  };
  const vertex = makeVertexDocumentationPort({
    endpoint: 'https://vertex.invalid',
    http,
    policy: allowedPolicy,
    accessToken: () => {
      tokenCalls += 1;
      return 'token';
    },
  });
  const result = await Effect.runPromise(vertex.search({
    workspaceId,
    query: 'look up deployment notes; api_key=abcd1234567890',
    topK: 3,
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') {
    assert.equal(result.error.code, 'POLICY_DENIED');
    assert.match(result.error.message, /SECRET_DETECTED/u);
  }
  assert.equal(tokenCalls, 0);
  assert.equal(httpCalls, 0);
});

test('secret-bearing Jev routing query is denied before token lookup and HTTP', async () => {
  let tokenCalls = 0;
  let httpCalls = 0;
  const http: HttpPort = {
    request: () => {
      httpCalls += 1;
      return Effect.succeed(ok({ status: 200, body: { sources: ['code'] } }));
    },
  };
  const result = await Effect.runPromise(selectJevRouteOverHttp({
    endpoint: 'https://jev.invalid',
    http,
    policy: allowedPolicy,
    accessToken: () => {
      tokenCalls += 1;
      return 'token';
    },
  }, {
    requestId: 'secret-route',
    query: 'route this private task password=supersecret123',
    privateCode: true,
    jevOptIn: true,
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') {
    assert.equal(result.error.code, 'POLICY_DENIED');
    assert.match(result.error.message, /SECRET_DETECTED/u);
  }
  assert.equal(tokenCalls, 0);
  assert.equal(httpCalls, 0);
});

test('secret-bearing Graphiti HTTP claims are denied before token lookup and HTTP', async () => {
  let tokenCalls = 0;
  let httpCalls = 0;
  const http: HttpPort = {
    request: () => {
      httpCalls += 1;
      return Effect.succeed(ok({ status: 200, body: {} }));
    },
  };
  const graphiti = makeGraphitiProjectionPort({
    endpoint: 'https://graphiti.invalid',
    http,
    policy: allowedPolicy,
    workspaceId,
    accessToken: () => {
      tokenCalls += 1;
      return 'token';
    },
  });
  const episodeId = mustOk(makeEpisodeId('secret-episode'));
  const result = await Effect.runPromise(graphiti.project({
    episodeId,
    occurredAtMs: 1,
    extractorVersion: 'extractor-v1',
    claims: [{
      subject: 'deployment',
      predicate: 'credential',
      object: 'access_token=abcdef1234567890',
    }],
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') {
    assert.equal(result.error.code, 'POLICY_DENIED');
    assert.match(result.error.message, /SECRET_DETECTED/u);
  }
  assert.equal(tokenCalls, 0);
  assert.equal(httpCalls, 0);
});

test('outbound text guard catches common credential shapes without leaking fixtures', () => {
  const candidates = [
    'xoxb-' + '1'.repeat(13) + '-' + '2'.repeat(13) + '-' + 'a'.repeat(26),
    'gho_' + 'a'.repeat(30),
    'aws_secret_access_key = ' + 'a'.repeat(40),
    '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    'Authorization: Bearer ' + 'a'.repeat(20) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(20),
  ];
  for (const candidate of candidates) assert.equal(containsLikelySecret(candidate), true, candidate.slice(0, 18));
  for (const ordinary of [
    'docs explain how to configure a bearer token without showing its value',
    'src/secret-service.ts exports credentialsProvider()',
  ]) assert.equal(containsLikelySecret(ordinary), false, ordinary);
});
