import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schema = async (name: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(`contracts/ace-gateway/v1/${name}`, 'utf8')) as Record<string, unknown>;

test('gateway v1 schemas are versioned and fail-closed at the object boundary', async () => {
  const request = await schema('projection-request.schema.json');
  const decision = await schema('projection-decision.schema.json');
  assert.equal(request.$id, 'https://ace.local/contracts/ace-gateway/v1/projection-request.schema.json');
  assert.equal(decision.$id, 'https://ace.local/contracts/ace-gateway/v1/projection-decision.schema.json');
  assert.equal(request.additionalProperties, false);
  assert.equal(decision.additionalProperties, false);
  assert.deepEqual(request.required, [
    'schemaVersion', 'requestId', 'attemptGroupId', 'agentSessionId', 'workspaceId', 'dataClass',
    'protocol', 'provider', 'model', 'bodyBase64', 'bodySha256', 'query', 'projectionMode', 'deadlineEpochMs', 'attestation',
  ]);
});

test('hidden provider history fixture is explicitly non-certifying', async () => {
  const fixture = await schema('fixtures/blocked-hidden-history.json');
  const attestation = fixture.attestation as Record<string, unknown>;
  assert.equal(attestation.providerManagedHistoryCapability, 'unknown');
  assert.equal(fixture.projectionMode, 'gateway');
});
