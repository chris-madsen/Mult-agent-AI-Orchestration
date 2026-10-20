import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeVertexRagRetrievalPort } from '../src/adapters/vertex-rag.js';
import type { HttpPort } from '../src/application/ports.js';
import {
  authorizeOutbound,
  defaultLocalPolicy,
  type ProjectDataPolicy,
} from '../src/domain/policy.js';
import { ok } from '../src/domain/result.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';

const workspace = makeWorkspaceId('data-class-policy-workspace');
if (workspace._tag === 'Err') throw new Error(workspace.error.message);

const vertexDocsPolicy: ProjectDataPolicy = {
  ...defaultLocalPolicy(workspace.value),
  cloudOptIn: true,
  allowedCloudProviders: ['vertex'],
  allowedCloudDataClassesByProvider: {
    vertex: ['project_document'],
  },
};

test('cloud authorization requires both provider and data-class permission', () => {
  const docs = authorizeOutbound({
    workspaceId: workspace.value,
    operation: 'documentation_search',
    destination: 'vertex',
    dataClasses: ['project_document'],
    paths: [],
    secretDetected: false,
  }, vertexDocsPolicy);
  assert.equal(docs._tag, 'Ok');
  if (docs._tag === 'Ok') {
    assert.equal(docs.value.outcome, 'allowed');
    assert.equal(docs.value.reasonCode, 'ALLOWED');
  }

  const privateSource = authorizeOutbound({
    workspaceId: workspace.value,
    operation: 'source_search',
    destination: 'vertex',
    dataClasses: ['private_source'],
    paths: [],
    secretDetected: false,
  }, vertexDocsPolicy);
  assert.equal(privateSource._tag, 'Ok');
  if (privateSource._tag === 'Ok') {
    assert.equal(privateSource.value.outcome, 'denied');
    assert.equal(privateSource.value.reasonCode, 'DATA_CLASS_DENIED');
  }
});

test('data-class permission is scoped to one provider and is not shared across providers', () => {
  const policy: ProjectDataPolicy = {
    ...defaultLocalPolicy(workspace.value),
    cloudOptIn: true,
    allowedCloudProviders: ['vertex', 'jev'],
    allowedCloudDataClassesByProvider: {
      vertex: ['project_document'],
      jev: ['public'],
    },
  };

  const vertexDocs = authorizeOutbound({
    workspaceId: workspace.value,
    operation: 'docs',
    destination: 'vertex',
    dataClasses: ['project_document'],
    paths: [],
    secretDetected: false,
  }, policy);
  assert.equal(vertexDocs._tag, 'Ok');
  if (vertexDocs._tag === 'Ok') assert.equal(vertexDocs.value.outcome, 'allowed');

  const jevDocs = authorizeOutbound({
    workspaceId: workspace.value,
    operation: 'route',
    destination: 'jev',
    dataClasses: ['project_document'],
    paths: [],
    secretDetected: false,
  }, policy);
  assert.equal(jevDocs._tag, 'Ok');
  if (jevDocs._tag === 'Ok') {
    assert.equal(jevDocs.value.outcome, 'denied');
    assert.equal(jevDocs.value.reasonCode, 'DATA_CLASS_DENIED');
  }
});

test('external actions with no declared data class fail closed', () => {
  const result = authorizeOutbound({
    workspaceId: workspace.value,
    operation: 'unknown_external',
    destination: 'vertex',
    dataClasses: [],
    paths: [],
    secretDetected: false,
  }, vertexDocsPolicy);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.equal(result.value.outcome, 'denied');
    assert.equal(result.value.reasonCode, 'DATA_CLASS_DENIED');
  }
});

test('Vertex data-class denial happens before token lookup and HTTP', async () => {
  let tokenCalls = 0;
  let httpCalls = 0;
  const http: HttpPort = {
    request: () => {
      httpCalls += 1;
      return Effect.succeed(ok({ status: 200, body: {} }));
    },
  };
  const deniedPolicy: ProjectDataPolicy = {
    ...defaultLocalPolicy(workspace.value),
    cloudOptIn: true,
    allowedCloudProviders: ['vertex'],
    allowedCloudDataClassesByProvider: {
      vertex: ['public'],
    },
  };
  const vertex = makeVertexRagRetrievalPort({
    project: 'ace-dev',
    location: 'europe-west4',
    corpusId: 'fixture',
    accessToken: () => {
      tokenCalls += 1;
      return 'must-not-be-read';
    },
    policy: deniedPolicy,
    http,
  });

  const result = await Effect.runPromise(vertex.search({
    workspaceId: workspace.value,
    query: 'architecture decision record',
    topK: 3,
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'POLICY_DENIED');
  assert.equal(tokenCalls, 0);
  assert.equal(httpCalls, 0);
});

test('local private data remains allowed without cloud opt-in', () => {
  const result = authorizeOutbound({
    workspaceId: workspace.value,
    operation: 'local_memory',
    destination: 'local',
    dataClasses: ['private_conversation'],
    paths: [],
    secretDetected: false,
  }, defaultLocalPolicy(workspace.value));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') assert.equal(result.value.outcome, 'allowed');
});
