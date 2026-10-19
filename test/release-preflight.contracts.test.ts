import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReleasePreflight, type ReleaseExternalEvidence } from '../src/domain/release-preflight.js';
import type { DbcEvidenceRecord, DbcId } from '../src/domain/dbc-evidence.js';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);

const dbcIds = Array.from({ length: 14 }, (_, index) =>
  `DBC-${String(index + 1).padStart(2, '0')}` as DbcId);

const dbcRecords = (): DbcEvidenceRecord[] => dbcIds.map((dbcId) => ({
  dbcId,
  verdict: 'PASS',
  sourceCommit: commit,
  fixtureSha256: 'c'.repeat(64),
  command: `npm run acceptance -- ${dbcId}`,
  toolVersions: { node: '22.23.3', ace: '0.1.0' },
  credentialScope: 'synthetic-or-explicitly-authorized-evidence',
  requestIds: dbcId === 'DBC-12' ? ['harbor-request-1'] : [],
  artifacts: [{
    path: `artifacts/dbc/${dbcId.toLowerCase()}.json`,
    sha256: digest,
    kind: 'acceptance-evidence',
  }],
  observed: [`${dbcId} acceptance contract passed`],
}));

const externalEvidence: ReleaseExternalEvidence[] = [
  { name: 'graphiti', evidence: 'real-graphiti-lifecycle', sha256: digest },
  { name: 'vertex', evidence: 'real-vertex-synthetic-code-doc-conflict', sha256: digest },
  { name: 'k3s-worktree', evidence: 'real-k3s-live-worktree', sha256: digest },
  { name: 'backup-restore', evidence: 'operations-backup-restore', sha256: digest },
  { name: 'supply-chain', evidence: 'supply-chain-provenance', sha256: digest },
];

const baseInput = () => ({
  currentCommit: commit,
  dbc: {
    schemaVersion: 1,
    generatedAt: '2026-10-20T00:00:00.000Z',
    records: dbcRecords(),
  },
  embeddingSelection: {
    verdict: { status: 'PRODUCTION_APPROVED', productionApproved: true },
  },
  semanticSelection: {
    verdict: { status: 'PRODUCTION_APPROVED', productionApproved: true },
  },
  retrievalQuality: {
    verdict: {
      measurementAccepted: true,
      metrics: { holdoutStatus: 'frozen_holdout' },
    },
  },
  harborThreeArm: {
    outcome: {
      productionAcceptance: 'measured-not-necessarily-5x',
      naturalUse: 'observed_complete',
      naturalQualityNonInferior: true,
      naturalProviderCorrelationVerified: true,
      costTelemetryComplete: true,
    },
  },
  externalEvidence,
  ownerApproval: {
    status: 'approved' as const,
    releaseCommit: commit,
    reference: 'owner-signoff-2026-10-20',
    approvedCapabilities: ['code', 'documentation', 'memory'] as const,
  },
});

test('full unified release is READY only when every mandatory evidence family is accepted', () => {
  const result = evaluateReleasePreflight(baseInput());
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'READY');
  assert.deepEqual(result.value.failures, []);
});

test('provider approval, current-commit DBC, external evidence and owner scope fail independently', () => {
  const input = baseInput();
  const records = dbcRecords();
  records[0] = { ...records[0]!, sourceCommit: 'd'.repeat(40) };
  const result = evaluateReleasePreflight({
    ...input,
    dbc: { schemaVersion: 1, generatedAt: '2026-10-20T00:00:00Z', records },
    embeddingSelection: {
      verdict: { status: 'MEASUREMENT_PASS_APPROVAL_PENDING', productionApproved: false },
    },
    externalEvidence: input.externalEvidence.filter((item) => item.name !== 'k3s-worktree'),
    ownerApproval: {
      ...input.ownerApproval,
      releaseCommit: 'e'.repeat(40),
      approvedCapabilities: ['code'],
    },
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'BLOCKED');
  for (const failure of [
    'dbc_wrong_commit:DBC-01',
    'embedding_not_production_approved',
    'external_evidence_missing:k3s-worktree',
    'owner_approval_wrong_commit',
    'owner_capability_not_approved:documentation',
    'owner_capability_not_approved:memory',
  ]) assert.ok(result.value.failures.includes(failure), failure);
});

test('release preflight revalidates DBC evidence instead of trusting a PASS string', () => {
  const input = baseInput();
  const malformed = dbcRecords();
  malformed[11] = {
    ...malformed[11]!,
    requestIds: [],
  };
  const result = evaluateReleasePreflight({
    ...input,
    dbc: {
      schemaVersion: 1,
      generatedAt: '2026-10-20T00:00:00Z',
      records: malformed,
    },
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'BLOCKED');
  assert.ok(result.value.failures.includes('dbc_manifest_invalid'));
});

test('Harbor diagnostic or incomplete-cost results can never produce unified release readiness', () => {
  const input = baseInput();
  const result = evaluateReleasePreflight({
    ...input,
    harborThreeArm: {
      outcome: {
        productionAcceptance: 'diagnostic-only',
        naturalUse: 'observed_partial_only',
        naturalQualityNonInferior: true,
        naturalProviderCorrelationVerified: false,
        costTelemetryComplete: false,
      },
    },
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'BLOCKED');
  assert.ok(result.value.failures.includes('harbor_natural_use_acceptance_incomplete'));
});
