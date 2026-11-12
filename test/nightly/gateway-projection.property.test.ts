import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sha256Base64, validateGatewayProjectionRequest } from '../../src/domain/gateway-projection.js';

const readRequestSchema = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile('contracts/ace-gateway/v1/projection-request.schema.json', 'utf8')) as Record<string, unknown>;

const attestation = (): Record<string, unknown> => ({
  hostBuildDigest: 'a'.repeat(64),
  sessionId: 'nightly-session',
  activeEngineId: 'ace_context_engine',
  effectiveCompressionControlsDigest: 'b'.repeat(64),
  durableActiveTranscriptRevision: 'row-1',
  durableActiveTranscriptDigest: 'c'.repeat(64),
  hostCompactionEpoch: 0,
  attestorId: 'nightly-attestor',
  providerManagedHistoryCapability: 'visible',
  hostTranscriptAttested: true,
  compactionEnabled: false,
});

const validRequest = (): Record<string, unknown> => {
  const bodyBase64 = Buffer.from('{}', 'utf8').toString('base64');
  return {
    schemaVersion: 'ace.gateway.v1',
    requestId: 'nightly-request',
    attemptGroupId: 'nightly-attempt',
    agentSessionId: 'nightly-session',
    workspaceId: 'nightly-workspace',
    dataClass: 'private',
    protocol: 'openai.chat.completions',
    provider: 'fixture-provider',
    model: 'fixture-model',
    bodyBase64,
    bodySha256: sha256Base64(bodyBase64),
    query: 'fixture query',
    projectionMode: 'gateway',
    deadlineEpochMs: Date.now() + 60_000,
    attestation: attestation(),
  };
};

test('bounded gateway request properties accept each declared enum string and reject coercions', async () => {
  const schema = await readRequestSchema();
  const properties = schema.properties as Record<string, { enum?: readonly string[] }>;
  const cases: readonly [string, (request: Record<string, unknown>, value: unknown) => void][] = [
    ['dataClass', (request, value) => { request.dataClass = value; }],
    ['projectionMode', (request, value) => { request.projectionMode = value; }],
  ];
  for (const [field, setValue] of cases) {
    const allowed = properties[field]?.enum;
    assert.ok(allowed?.length, `schema enum missing for ${field}`);
    for (const value of allowed) {
      const request = validRequest();
      setValue(request, value);
      assert.equal(validateGatewayProjectionRequest(request)._tag, 'Ok', `${field}=${value}`);
    }
    for (const value of [[allowed[0]], { value: allowed[0] }, null, 0, `unknown-${field}`]) {
      const request = validRequest();
      setValue(request, value);
      assert.equal(validateGatewayProjectionRequest(request)._tag, 'Err', `${field} rejects ${JSON.stringify(value)}`);
    }
  }

  const definitions = schema.$defs as Record<string, Record<string, unknown>>;
  const attestationProperties = definitions.attestation.properties as Record<string, { enum?: readonly string[] }>;
  const historyValues = attestationProperties.providerManagedHistoryCapability?.enum;
  assert.ok(historyValues?.length);
  for (const value of historyValues) {
    const request = validRequest();
    request.attestation = { ...attestation(), providerManagedHistoryCapability: value };
    assert.equal(validateGatewayProjectionRequest(request)._tag, 'Ok', `providerManagedHistoryCapability=${value}`);
  }
  for (const value of [[historyValues[0]], { value: historyValues[0] }, null, 0, 'unknown-capability']) {
    const request = validRequest();
    request.attestation = { ...attestation(), providerManagedHistoryCapability: value };
    assert.equal(validateGatewayProjectionRequest(request)._tag, 'Err');
  }
});

test('every required request and attestation field is rejected when absent', async () => {
  const schema = await readRequestSchema();
  const requestRequired = schema.required as string[];
  for (const field of requestRequired) {
    const request = validRequest();
    delete request[field];
    assert.equal(validateGatewayProjectionRequest(request)._tag, 'Err', `missing request.${field}`);
  }

  const definitions = schema.$defs as Record<string, Record<string, unknown>>;
  const attestationRequired = definitions.attestation.required as string[];
  for (const field of attestationRequired) {
    const request = validRequest();
    const value = { ...attestation() };
    delete value[field];
    request.attestation = value;
    assert.equal(validateGatewayProjectionRequest(request)._tag, 'Err', `missing attestation.${field}`);
  }
});

test('bounded unknown-field generation is rejected at both strict object boundaries', () => {
  for (let index = 0; index < 16; index += 1) {
    const field = `unexpected_${index}`;
    const request = { ...validRequest(), [field]: index };
    assert.equal(validateGatewayProjectionRequest(request)._tag, 'Err', `request.${field}`);
    const nested = validRequest();
    nested.attestation = { ...attestation(), [field]: index };
    assert.equal(validateGatewayProjectionRequest(nested)._tag, 'Err', `attestation.${field}`);
  }
});
