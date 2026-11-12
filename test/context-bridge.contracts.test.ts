import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { Effect } from 'effect';
import {
  handleContextBridgeMessage,
  runContextBridgeStdio,
  type ContextBridgeService,
} from '../src/transport/context-bridge-stdio.js';
import type { AceTransformResult } from '../src/application/context-transform-service.js';
import { ok, err } from '../src/domain/result.js';
import { domainError } from '../src/domain/errors.js';

const result: AceTransformResult = {
  schemaVersion: 1,
  requestId: 'request-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  workspaceId: 'workspace-1' as AceTransformResult['workspaceId'],
  status: 'ready',
  contextText: 'verified context',
  evidence: [],
  selectedEvidenceIds: ['evidence-1'],
  omittedEvidenceIds: [],
  estimatedTokens: 3,
  sourceCommit: 'a'.repeat(40),
  sourceManifestSha256: 'b'.repeat(64),
  providerIdentities: { qdrant: 'qdrant/test' },
  receiptId: 'ace-transform-bundle-1',
  providerRequestId: 'retrieval-1',
  limitations: [],
};

const service = (value: typeof result = result): ContextBridgeService => ({
  transform: () => Effect.succeed(ok(value)),
});

const publicContract = JSON.parse(readFileSync(new URL('../.github/fixtures/contracts/ace-public-v1-baseline.json', import.meta.url), 'utf8')) as {
  readonly hermes: {
    readonly bridgeHandshake: { readonly type: string; readonly schemaVersion: number; readonly runtimeId: string };
    readonly bridgeReadyRequired: readonly string[];
    readonly transformRequestRequired: readonly string[];
    readonly transformRequestProperties: readonly string[];
    readonly responseTypes: readonly string[];
  };
};

test('bridge returns one successful response with the same request id', async () => {
  const response = await handleContextBridgeMessage(service(), {
    type: 'transform',
    schemaVersion: 1,
    requestId: 'request-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    workspaceId: 'workspace-1',
    query: 'find context',
    budgetTokens: 100,
    sourceObligations: { required: ['code'] },
  });

  assert.deepEqual(response, { type: 'transform_result', requestId: 'request-1', ok: true, result });
});

test('bridge returns a typed error for malformed input without throwing', async () => {
  const response = await handleContextBridgeMessage(service(), '{not-json');

  assert.equal(response.ok, false);
  if (response.ok) return;
  assert.equal(response.type, 'transform_error');
  assert.equal(response.error.code, 'INVALID_INPUT');
});

test('bridge preserves blocked provider failures as blocked responses', async () => {
  const blocked: ContextBridgeService = {
    transform: () => Effect.succeed(err(domainError('NOT_READY', 'context', 'provider unavailable'))),
  };
  const response = await handleContextBridgeMessage(blocked, {
    type: 'transform',
    schemaVersion: 1,
    requestId: 'request-2',
    sessionId: 'session-1',
    turnId: 'turn-1',
    workspaceId: 'workspace-1',
    query: 'find context',
    budgetTokens: 100,
    sourceObligations: { required: ['code'] },
  });

  assert.equal(response.ok, false);
  if (response.ok) return;
  assert.equal(response.requestId, 'request-2');
  assert.equal(response.error.code, 'NOT_READY');
});

test('bridge rejects unknown message types and never echoes credential-like fields', async () => {
  const response = await handleContextBridgeMessage(service(), {
    type: 'unknown',
    requestId: 'request-3',
    access_token: 'must-not-appear',
  });

  assert.equal(response.ok, false);
  assert.doesNotMatch(JSON.stringify(response), /must-not-appear/u);
});

test('stdio bridge emits a pinned ready record and preserves the versioned transform request', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: string[] = [];
  output.on('data', (chunk: Buffer) => lines.push(...chunk.toString('utf8').trim().split('\n')));
  let observedRequest: unknown;
  const capturingService: ContextBridgeService = {
    transform: (request) => {
      observedRequest = request;
      return Effect.succeed(ok(result));
    },
  };
  const running = runContextBridgeStdio(capturingService, input, output);
  const request = {
    type: 'transform',
    schemaVersion: 1,
    requestId: 'request-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    workspaceId: 'workspace-1',
    query: 'find context',
    budgetTokens: 100,
    sourceObligations: { required: ['code'] },
    intent: 'locate',
    workingContext: {
      focusedPath: 'src/example.ts',
      openPaths: ['src/example.ts'],
      focusedRange: { startLine: 1, endLine: 1 },
    },
    knownBundleId: 'bundle-1',
    knownEvidenceIds: ['evidence-1'],
  };
  for (const field of publicContract.hermes.transformRequestProperties) assert.ok(field in request, `bridge request schema lost ${field}`);
  assert.deepEqual(request.sourceObligations.required, ['code']);
  for (const field of publicContract.hermes.transformRequestRequired) assert.ok(field in request, `bridge request is missing ${field}`);
  input.end(`${JSON.stringify(request)}\n`);
  await running;
  const ready = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  for (const field of publicContract.hermes.bridgeReadyRequired) assert.ok(field in ready, `bridge ready record is missing ${field}`);
  assert.deepEqual({ type: ready.type, schemaVersion: ready.schemaVersion, runtimeId: ready.runtimeId }, publicContract.hermes.bridgeHandshake);
  const response = JSON.parse(lines[1] ?? '{}') as Record<string, unknown>;
  assert.ok(publicContract.hermes.responseTypes.includes(String(response.type)));
  assert.equal(response.type, 'transform_result');
  assert.deepEqual(observedRequest, {
    schemaVersion: 1,
    requestId: request.requestId,
    sessionId: request.sessionId,
    turnId: request.turnId,
    workspaceId: request.workspaceId,
    query: request.query,
    budgetTokens: request.budgetTokens,
    sourceObligations: request.sourceObligations,
    intent: request.intent,
    workingContext: request.workingContext,
    knownBundleId: request.knownBundleId,
    knownEvidenceIds: request.knownEvidenceIds,
  });
});
