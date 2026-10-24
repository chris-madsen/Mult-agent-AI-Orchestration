import assert from 'node:assert/strict';
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

test('stdio bridge emits a pinned ready record before processing transforms', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: string[] = [];
  output.on('data', (chunk: Buffer) => lines.push(...chunk.toString('utf8').trim().split('\n')));
  const running = runContextBridgeStdio(service(), input, output);
  input.end(`${JSON.stringify({
    type: 'transform',
    schemaVersion: 1,
    requestId: 'request-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    workspaceId: 'workspace-1',
    query: 'find context',
    budgetTokens: 100,
    sourceObligations: { required: ['code'] },
  })}\n`);
  await running;
  assert.equal(JSON.parse(lines[0] ?? '{}').type, 'bridge_ready');
  assert.equal(JSON.parse(lines[1] ?? '{}').type, 'transform_result');
});
