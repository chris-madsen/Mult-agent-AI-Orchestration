import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { handleGatewayProjectionHttp } from '../src/transport/gateway-projection-http.js';
import { ok } from '../src/domain/result.js';

const service = {
  project: () => Effect.succeed(ok({
    kind: 'BLOCK' as const,
    receipt: {
      schemaVersion: 'ace.gateway.v1' as const,
      requestId: 'req-1',
      attemptGroupId: 'group-1',
      attemptIndex: 0,
      receiptId: 'receipt-1',
      decision: 'BLOCK' as const,
      reasonCode: 'HOST_COMPACTION_ACTIVE',
      baseBodySha256: 'a'.repeat(64),
      hostCompactionEpoch: 3,
      activeEngineId: 'ace_context_engine',
      permittedWireRewrites: [],
    },
  })),
};

test('gateway HTTP exposes health and capability contracts', async () => {
  const health = await handleGatewayProjectionHttp(service, 'GET', '/internal/ace-gateway/v1/health', '');
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.providerWire, 'not_certified');
  const capabilities = await handleGatewayProjectionHttp(service, 'GET', '/internal/ace-gateway/v1/capabilities', '');
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.body.schemaVersion, 'ace.gateway.v1');
});

test('gateway HTTP returns a typed projection decision and rejects unknown paths', async () => {
  const projected = await handleGatewayProjectionHttp(service, 'POST', '/internal/ace-gateway/v1/project', '{}');
  assert.equal(projected.statusCode, 200);
  assert.equal((projected.body as { kind: string }).kind, 'BLOCK');
  const missing = await handleGatewayProjectionHttp(service, 'POST', '/unknown', '{}');
  assert.equal(missing.statusCode, 404);
});

test('gateway HTTP does not accept unverified final-delivery claims', async () => {
  const result = await handleGatewayProjectionHttp(service, 'POST', '/internal/ace-gateway/v1/record-delivery', '{}');
  assert.equal(result.statusCode, 501);
});
