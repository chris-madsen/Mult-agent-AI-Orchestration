import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFileProviderTrace, providerTraceEvent } from '../src/adapters/provider-trace.js';

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
    collection: 'ace_code_workspace_model',
    generation: 7,
    vectorDimension: 384,
  });
  const [line] = (await readFile(path, 'utf8')).trim().split('\n');
  const event = JSON.parse(line) as Record<string, unknown>;
  assert.equal(event.provider, 'qdrant');
  assert.equal(event.status, 'success');
  assert.equal(event.vectorDimension, 384);
  assert.equal(Object.hasOwn(event, 'source'), false);
  assert.equal(Object.hasOwn(event, 'query'), false);
  assert.equal(Object.hasOwn(event, 'token'), false);
  assert.equal(Object.hasOwn(event, 'secret'), false);
});
