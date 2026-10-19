import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dbcAcceptanceSummary,
  makeDbcEvidenceManifest,
  validateDbcEvidenceRecord,
  type DbcEvidenceRecord,
} from '../src/domain/dbc-evidence.js';

const base: DbcEvidenceRecord = {
  dbcId: 'DBC-05',
  verdict: 'PASS',
  sourceCommit: 'a'.repeat(40),
  fixtureSha256: 'b'.repeat(64),
  command: 'npm run test:real-provider-race',
  toolVersions: { node: '22.23.3', qdrant: '1.19.2' },
  credentialScope: 'local-only; no cloud credentials used',
  requestIds: ['ace-request-1'],
  artifacts: [{ path: 'artifacts/dbc-05/provider-trace.jsonl', sha256: 'c'.repeat(64), kind: 'provider-trace' }],
  observed: ['Final source verification demoted a source changed during retrieval.'],
};

test('DBC PASS requires retained reproducible evidence, not a green label alone', () => {
  assert.equal(validateDbcEvidenceRecord(base)._tag, 'Ok');
  assert.equal(validateDbcEvidenceRecord({ ...base, artifacts: [] })._tag, 'Err');
  assert.equal(validateDbcEvidenceRecord({ ...base, fixtureSha256: undefined })._tag, 'Err');
  assert.equal(validateDbcEvidenceRecord({ ...base, command: undefined })._tag, 'Err');
  assert.equal(validateDbcEvidenceRecord({ ...base, observed: [] })._tag, 'Err');
});

test('DBC-12 PASS requires request-correlated evidence', () => {
  assert.equal(validateDbcEvidenceRecord({ ...base, dbcId: 'DBC-12', requestIds: [] })._tag, 'Err');
  assert.equal(validateDbcEvidenceRecord({ ...base, dbcId: 'DBC-12', requestIds: ['ace-harbor-request'] })._tag, 'Ok');
});

test('NOT_RUN and BLOCKED require an explicit limitation and cannot masquerade as PASS', () => {
  const blocked: DbcEvidenceRecord = {
    ...base,
    dbcId: 'DBC-14',
    verdict: 'BLOCKED',
    fixtureSha256: undefined,
    command: undefined,
    artifacts: [],
    observed: [],
    limitation: 'Vertex fixture corpus has not been ingested in this environment.',
  };
  assert.equal(validateDbcEvidenceRecord(blocked)._tag, 'Ok');
  assert.equal(validateDbcEvidenceRecord({ ...blocked, limitation: undefined })._tag, 'Err');
});

test('evidence metadata rejects embedded credentials', () => {
  assert.equal(validateDbcEvidenceRecord({
    ...base,
    credentialScope: 'authorization=Bearer super-secret-token',
  })._tag, 'Err');
  assert.equal(validateDbcEvidenceRecord({
    ...base,
    command: 'curl -H "Authorization: Bearer secret-value" https://example.invalid',
  })._tag, 'Err');
});

test('all-passed means exactly fourteen validated PASS records', () => {
  const records = Array.from({ length: 14 }, (_, index) => ({
    ...base,
    dbcId: `DBC-${String(index + 1).padStart(2, '0')}` as DbcEvidenceRecord['dbcId'],
    requestIds: index === 11 ? ['harbor-request'] : [],
  }));
  const manifest = makeDbcEvidenceManifest(records, '2026-10-20T00:00:00Z');
  assert.equal(manifest._tag, 'Ok');
  if (manifest._tag === 'Err') throw new Error(manifest.error.message);
  assert.deepEqual(dbcAcceptanceSummary(manifest.value), {
    pass: 14,
    fail: 0,
    notRun: 0,
    blocked: 0,
    allPassed: true,
  });
});
