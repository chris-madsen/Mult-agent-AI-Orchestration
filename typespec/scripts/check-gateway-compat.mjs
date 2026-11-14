import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

// This is a PARITY gate, not another protocol implementation.
// Existing v1 JSON Schema remains active during the migration; the generated
// TypeSpec JSON Schema must accept/reject exactly the same controlled cases.
const root = resolve(import.meta.dirname, '../..');
const load = (name) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const generatedRequest = load('typespec/generated/schema/ProjectionRequest.json');
const generatedDecision = load('typespec/generated/schema/ProjectionDecision.json');
const legacyRequest = load('contracts/ace-gateway/v1/projection-request.schema.json');
const legacyDecision = load('contracts/ace-gateway/v1/projection-decision.schema.json');

function enumValues(schema) {
  if (Array.isArray(schema.enum)) return schema.enum;
  if (schema.const !== undefined) return [schema.const];
  const entries = schema.anyOf ?? schema.oneOf;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap(enumValues);
}

function failOnFieldDrift(existing, emitted, label) {
  const before = Object.keys(existing.properties ?? {}).sort();
  const after = Object.keys(emitted.properties ?? {}).sort();
  assert.deepEqual(after, before, `${label}: wire properties changed; map deliberately before migration`);
  assert.deepEqual([...(emitted.required ?? [])].sort(), [...(existing.required ?? [])].sort(),
    `${label}: required/optional field changed`);
  for (const [key, field] of Object.entries(existing.properties ?? {})) {
    const current = emitted.properties[key];
    assert.ok(current !== undefined, `${label}.${key}: missing generated field`);
    const variants = enumValues(field);
    if (variants.length) assert.deepEqual(enumValues(current).sort(), variants.sort(),
      `${label}.${key}: variant drift`);
  }
}

failOnFieldDrift(legacyRequest, generatedRequest, 'ProjectionRequest');
failOnFieldDrift(legacyRequest.$defs.attestation,
  generatedRequest.$defs.HostCompactionAttestation, 'HostCompactionAttestation');
failOnFieldDrift(legacyDecision, generatedDecision, 'ProjectionDecision');
failOnFieldDrift(legacyDecision.$defs.receipt,
  generatedDecision.$defs.ProjectionReceipt, 'ProjectionReceipt');

// TSP-04 RED fixture: adding a field to one side must not silently pass.
assert.throws(() => failOnFieldDrift(legacyRequest, {
  ...generatedRequest,
  properties: { ...generatedRequest.properties, unmappedFieldFixture: { type: 'string' } },
}, 'malicious-extra-field'));
assert.throws(() => failOnFieldDrift(legacyRequest, {
  ...generatedRequest,
  properties: { ...generatedRequest.properties, dataClass: { enum: ['private'] } },
}, 'missing-enum-variant'));

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const oldRequest = ajv.compile(legacyRequest);
const newRequest = ajv.compile(generatedRequest);
const oldDecision = ajv.compile(legacyDecision);
const newDecision = ajv.compile(generatedDecision);
let requestCount = 0, decisionCount = 0;

function compare(name, oldValidator, generatedValidator, body, shouldPass) {
  const legacy = oldValidator(body);
  const emitted = generatedValidator(body);
  assert.equal(legacy, shouldPass, `${name}: existing contract expectation wrong`);
  assert.equal(emitted, legacy, `${name}: TypeSpec emitted incompatible JSON schema`);
}
const valid = load('contracts/ace-gateway/v1/fixtures/blocked-hidden-history.json');
compare('base fixture', oldRequest, newRequest, valid, true);requestCount++;
for (const key of legacyRequest.required) {
  const input = structuredClone(valid); delete input[key];
  compare(`missing request.${key}`, oldRequest, newRequest, input, false);requestCount++;
}
for (const key of legacyRequest.$defs.attestation.required) {
  const input = structuredClone(valid);delete input.attestation[key];
  compare(`missing attestation.${key}`, oldRequest, newRequest, input, false);requestCount++;
}
for (const bad of [
  { ...valid, unexpected: 1 },
  { ...valid, dataClass: ['private'] },
  { ...valid, dataClass: 'confidential' },
  { ...valid, query: '' },
  { ...valid, protocol: 'openai.responses' },
  { ...valid, nativeProjectionActive: null },
  { ...valid, requestedEvidenceIds: ['same', 'same'] },
  { ...valid, requestedEvidenceIds: [''] },
  { ...valid, bodySha256: 'not-a-sha' },
  { ...valid, attestation: { ...valid.attestation, unsupported: true } },
  { ...valid, attestation: { ...valid.attestation, hostCompactionEpoch: -1 } },
  { ...valid, attestation: { ...valid.attestation, providerManagedHistoryCapability: ['visible'] } },
  { ...valid, attestation: { ...valid.attestation, attestorId: null } },
]) { compare('bad request variant', oldRequest, newRequest, bad, false);requestCount++; }
for (const mode of ['native', 'gateway', 'assist-only', 'observe-only', 'off']) {
  compare(`projectionMode=${mode}`, oldRequest, newRequest,
    { ...valid, projectionMode: mode }, true); requestCount++;
}
for (const dataClass of ['private', 'project_document', 'public']) {
  compare(`dataClass=${dataClass}`, oldRequest, newRequest,
    { ...valid, dataClass }, true);requestCount++;
}
const receipt = {
  schemaVersion: 'ace.gateway.v1', requestId: 'r1', attemptGroupId: 'a1',
  attemptIndex: 0, receiptId: 'rc1', decision: 'BLOCK',
  baseBodySha256: 'a'.repeat(64), hostCompactionEpoch: 3, activeEngineId: 'ace_context_engine',
  permittedWireRewrites: [],
};
const baseDecision = { kind: 'BLOCK', receipt };
compare('decision good', oldDecision, newDecision, baseDecision, true);decisionCount++;
// Gateway v1 intentionally has no 32-bit upper bound on the attempt index.
// A generator default of int32 would reject valid historical receipts.
for (const index of [2147483648, Number.MAX_SAFE_INTEGER]) {
  const value = { kind: 'BLOCK', receipt: { ...receipt, attemptIndex: index } };
  compare(`unbounded nonnegative attemptIndex=${index}`, oldDecision, newDecision, value, true);
  decisionCount++;
}
compare('negative attemptIndex', oldDecision, newDecision,
  { kind: 'BLOCK', receipt: { ...receipt, attemptIndex: -1 } }, false);
decisionCount++;
for (const key of legacyDecision.required) {
  const input = structuredClone(baseDecision);delete input[key];
  compare(`missing decision.${key}`, oldDecision, newDecision, input, false);decisionCount++;
}
for (const key of legacyDecision.$defs.receipt.required) {
  const input = structuredClone(baseDecision);delete input.receipt[key];
  compare(`missing receipt.${key}`, oldDecision, newDecision, input, false);decisionCount++;
}
for (const bad of [
  { ...baseDecision, unknownField: true },
  { ...baseDecision, kind: 'FAKE_SUCCESS' },
  { ...baseDecision, receipt: { ...receipt, hostCompactionEpoch: -1 } },
  { ...baseDecision, receipt: { ...receipt, permittedWireRewrites: ['a', 'a'] } },
  { ...baseDecision, receipt: { ...receipt, decision: ['BLOCK'] } },
  { ...baseDecision, receipt: { ...receipt, projectedBodySha256: 'wrong' } },
  { ...baseDecision, receipt: { ...receipt, extraField: 1 } },
]) { compare('bad decision variant', oldDecision, newDecision, bad, false);decisionCount++; }
for (const kind of ['APPLY','UNCHANGED_AUTHORIZED','DEGRADED_AUTHORIZED','BLOCK']) {
  const input = { kind, receipt: { ...receipt, decision: kind } };
  compare(`decision=${kind}`, oldDecision, newDecision, input, true);decisionCount++;
}
console.log(JSON.stringify({
  status: 'pass', requestCases: requestCount, decisionCases: decisionCount,
  meaning: 'schema compatibility only, not final-send authorization, provider E2E, or domain semantic equivalence',
}));
