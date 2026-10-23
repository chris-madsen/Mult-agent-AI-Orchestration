import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
  makeContextTransformService,
  type AceTransformRequest,
} from '../src/application/context-transform-service.js';
import { ok } from '../src/domain/result.js';
import { makeWorkspaceId, type WorkspaceRecord } from '../src/domain/workspace.js';
import type { ContextBundle } from '../src/domain/retrieval.js';

const workspaceId = makeWorkspaceId('00000000-0000-4000-8000-000000000001');
if (workspaceId._tag === 'Err') throw new Error(workspaceId.error.message);

const workspace: WorkspaceRecord = {
  workspaceId: workspaceId.value,
  rootPath: '/workspace',
  observationEpoch: 1,
  createdAtMs: 1,
  lastObservation: {
    headRevision: 'a'.repeat(40),
    observationEpoch: 1,
    files: [],
    removedPaths: [],
    gitStatus: 'available',
  },
};

const request: AceTransformRequest = {
  schemaVersion: 1,
  requestId: 'request-1',
  sessionId: 'session-1',
  workspaceId: workspaceId.value,
  query: 'find the context transform service',
  budgetTokens: 200,
};

const bundle = (overrides: Partial<ContextBundle> = {}): ContextBundle => ({
  requestId: 'request-1' as ContextBundle['requestId'],
  query: request.query,
  evidence: [{
    evidenceId: 'evidence-1' as ContextBundle['evidence'][number]['evidenceId'],
    source: 'code',
    citation: 'src/application/context-transform-service.ts:1-20',
    content: 'context transform service is available;',
    sourceDigest: 'b'.repeat(64) as ContextBundle['evidence'][number]['sourceDigest'],
    proofClass: 'direct',
    freshness: 'current',
  }],
  warnings: [],
  partialSources: [],
  complete: true,
  ...overrides,
});

const makePorts = (result: ContextBundle = bundle()) => ({
  ids: { newRequestId: () => 'request-generated' },
  store: { get: () => Effect.succeed(ok(workspace)) },
  context: {
    search: () => Effect.succeed(ok(result)),
  },
});

test('transforms a request into bounded source-attributed context without mutating history', async () => {
  const service = makeContextTransformService(makePorts());
  const result = await Effect.runPromise(service.transform(request));

  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.status, 'ready');
  assert.match(result.value.contextText, /context transform service/u);
  assert.deepEqual(result.value.selectedEvidenceIds, ['evidence-1']);
  assert.equal(result.value.sourceCommit, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.match(result.value.receiptId, /^ace-transform-/u);
});

test('rejects a non-positive token budget before provider search', async () => {
  let called = false;
  const ports = makePorts();
  ports.context.search = () => {
    called = true;
    return Effect.succeed(ok(bundle()));
  };
  const service = makeContextTransformService(ports);
  const result = await Effect.runPromise(service.transform({ ...request, budgetTokens: 0 }));

  assert.equal(result._tag, 'Err');
  if (result._tag === 'Ok') return;
  assert.equal(result.error.code, 'INVALID_INPUT');
  assert.equal(called, false);
});

test('returns partial status and preserves omitted evidence when the provider is incomplete', async () => {
  const incomplete = bundle({
    complete: false,
    partialSources: ['lsp'],
    warnings: ['lsp unavailable'],
  });
  const service = makeContextTransformService(makePorts(incomplete));
  const result = await Effect.runPromise(service.transform(request));

  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.status, 'partial');
  assert.deepEqual(result.value.limitations, ['lsp unavailable', 'lsp: partial']);
});

test('does not report a successful transform when the provider returns no evidence', async () => {
  const empty = bundle({ evidence: [], complete: false, partialSources: ['code'] });
  const service = makeContextTransformService(makePorts(empty));
  const result = await Effect.runPromise(service.transform(request));

  assert.equal(result._tag, 'Err');
  if (result._tag === 'Ok') return;
  assert.equal(result.error.code, 'NOT_READY');
});
