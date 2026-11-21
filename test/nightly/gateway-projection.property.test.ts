import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validateResponsesProjectionRequest } from '../../src/domain/responses-projection.js';

const readSchema = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile('typespec/generated/schema/ProjectionRequest.json', 'utf8')) as Record<string, unknown>;
const attestation = (): Record<string, unknown> => ({
  hostBuildDigest: 'a'.repeat(64), sessionId: 'nightly-session', activeEngineId: 'bifrost-visible-request-only',
  effectiveCompressionControlsDigest: 'b'.repeat(64), durableActiveTranscriptRevision: 'unattested',
  durableActiveTranscriptDigest: 'c'.repeat(64), hostCompactionEpoch: 'unknown', attestorId: 'nightly-attestor',
  providerManagedHistoryCapability: 'visible', hostTranscriptAttested: false, compactionEnabled: false,
});
const validRequest = (): Record<string, unknown> => {
  const bodyBase64 = Buffer.from(JSON.stringify({ model: 'fixture-model', store: false, input: 'fixture query' }), 'utf8').toString('base64');
  return {
    schemaVersion: 'ace.context.v3', protocol: 'openai.responses', requestId: 'nightly-request',
    attemptGroupId: 'nightly-attempt', agentSessionId: 'nightly-session', workspaceId: 'nightly-workspace',
    dataClass: 'private', provider: 'fixture-provider', model: 'fixture-model', bodyBase64,
    bodySha256: createHash('sha256').update(Buffer.from(bodyBase64, 'base64')).digest('hex'),
    query: 'fixture query', projectionMode: 'bifrost_hook', deadlineEpochMs: Date.now() + 60_000,
    attestation: attestation(),
  };
};

test('native contract properties accept declared enum strings and reject coercions', async () => {
  const schema = await readSchema();
  const openapi = JSON.parse(await readFile('typespec/generated/openapi.json', 'utf8')) as {
    components: { schemas: Record<string, { properties: Record<string, { enum?: readonly string[] }> }> };
  };
  const properties = openapi.components.schemas.ProjectionRequest.properties;
  for (const [field, allowed] of Object.entries({
    dataClass: properties.dataClass?.enum,
    projectionMode: properties.projectionMode?.enum,
  })) {
    assert.ok(allowed?.length, `schema enum missing for ${field}`);
    for (const value of allowed) {
      assert.equal(validateResponsesProjectionRequest({ ...validRequest(), [field]: value })._tag, 'Ok');
    }
    for (const value of [[allowed[0]], { value: allowed[0] }, null, 0, `unknown-${field}`]) {
      assert.equal(validateResponsesProjectionRequest({ ...validRequest(), [field]: value })._tag, 'Err');
    }
  }
  const definitions = schema.$defs as Record<string, Record<string, unknown>>;
  const attestationProperties = definitions.HostCompactionAttestation.properties as Record<string, { anyOf?: readonly unknown[] }>;
  const history = attestationProperties.providerManagedHistoryCapability?.anyOf;
  assert.ok(history?.length);
  for (const value of ['visible', 'hidden', 'unknown']) {
    const request = { ...validRequest(), attestation: { ...attestation(), providerManagedHistoryCapability: value } };
    assert.equal(validateResponsesProjectionRequest(request)._tag, 'Ok');
  }
  for (const value of [['visible'], { value: 'visible' }, null, 0, 'unknown-capability']) {
    const request = { ...validRequest(), attestation: { ...attestation(), providerManagedHistoryCapability: value } };
    assert.equal(validateResponsesProjectionRequest(request)._tag, 'Err');
  }
});

test('every required native request and attestation field is rejected when absent', async () => {
  const schema = await readSchema();
  const requestRequired = schema.required as string[];
  for (const field of requestRequired) {
    const request = validRequest();
    delete request[field];
    assert.equal(validateResponsesProjectionRequest(request)._tag, 'Err', `missing request.${field}`);
  }
  const definitions = schema.$defs as Record<string, Record<string, unknown>>;
  const attestationRequired = definitions.HostCompactionAttestation.required as string[];
  for (const field of attestationRequired) {
    const request = validRequest();
    const value = { ...attestation() };
    delete value[field];
    request.attestation = value;
    assert.equal(validateResponsesProjectionRequest(request)._tag, 'Err', `missing attestation.${field}`);
  }
});

test('bounded unknown-field generation is rejected at both strict object boundaries', () => {
  for (let index = 0; index < 16; index += 1) {
    const field = `unexpected_${index}`;
    assert.equal(validateResponsesProjectionRequest({ ...validRequest(), [field]: index })._tag, 'Err');
    const request = validRequest();
    request.attestation = { ...attestation(), [field]: index };
    assert.equal(validateResponsesProjectionRequest(request)._tag, 'Err');
  }
});
