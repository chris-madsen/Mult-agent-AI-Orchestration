import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFileProviderTrace, providerTraceEvent } from '../src/adapters/provider-trace.js';
import { makeVertexRagRetrievalPort } from '../src/adapters/vertex-rag.js';
import { defaultLocalPolicy } from '../src/domain/policy.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { Effect } from 'effect';
import { ok } from '../src/domain/result.js';
import type { ProviderTraceEvent } from '../src/domain/provider-trace.js';

test('provider trace is append-only safe JSONL without source or token payloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ace-provider-trace-'));
  const path = join(directory, 'provider-trace.jsonl');
  const trace = makeFileProviderTrace(path);
  providerTraceEvent(trace, {
    provider: 'qdrant',
    providerVersion: 'qdrant/1.19.2',
    operation: 'query_points',
    status: 'success',
    durationMs: 12,
    requestId: 'ace-request-123',
    collection: 'ace_code_workspace_model',
    generation: 7,
    vectorDimension: 384,
  });
  const [line] = (await readFile(path, 'utf8')).trim().split('\n');
  const event = JSON.parse(line) as Record<string, unknown>;
  assert.equal(event.provider, 'qdrant');
  assert.equal(event.status, 'success');
  assert.equal(event.vectorDimension, 384);
  assert.equal(event.requestId, 'ace-request-123');
  assert.equal(Object.hasOwn(event, 'source'), false);
  assert.equal(Object.hasOwn(event, 'query'), false);
  assert.equal(Object.hasOwn(event, 'token'), false);
  assert.equal(Object.hasOwn(event, 'secret'), false);
});


test('Vertex trace carries request correlation but no query or OAuth token', async () => {
  const workspace = makeWorkspaceId('trace-vertex');
  assert.equal(workspace._tag, 'Ok');
  if (workspace._tag === 'Err') return;
  const events: ProviderTraceEvent[] = [];
  const provider = makeVertexRagRetrievalPort({
    project: 'ace-dev',
    location: 'europe-west4',
    corpusId: 'fixture',
    accessToken: () => 'oauth-secret-value',
    policy: { ...defaultLocalPolicy(workspace.value), cloudOptIn: true, allowedCloudProviders: ['vertex'] },
    http: { request: () => Effect.succeed(ok({ status: 200, body: {} })) },
    trace: { record: (event) => { events.push(event); } },
    providerVersion: 'vertex-rag/test',
  });
  const result = await Effect.runPromise(provider.search({
    workspaceId: workspace.value,
    query: 'architecture secret-free fixture query',
    topK: 3,
    requestId: 'trace-request-1',
  }));
  assert.equal(result._tag, 'Ok');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.provider, 'vertex_rag');
  assert.equal(events[0]?.requestId, 'trace-request-1');
  assert.equal(events[0]?.status, 'success');
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('architecture secret-free fixture query'), false);
  assert.equal(serialized.includes('oauth-secret-value'), false);
});
