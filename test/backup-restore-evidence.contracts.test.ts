import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateBackupRestoreEvidence,
  requiredBackupRestoreChecks,
  type BackupRestoreEvidenceInput,
} from '../src/domain/backup-restore-evidence.js';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);

const input = (): BackupRestoreEvidenceInput => ({
  schemaVersion: 1,
  sourceCommit: commit,
  generatedAt: '2026-10-20T00:00:00.000Z',
  environment: {
    aceVersion: 'ace/0.1.0',
    qdrantVersion: 'qdrant/1.19.2',
    graphitiVersion: 'graphiti/fixture',
    falkorDbVersion: 'falkordb/fixture',
    deployment: 'local-k3s-single-node',
  },
  checks: requiredBackupRestoreChecks.map((id) => ({
    id,
    verdict: 'PASS' as const,
    command: `npm run acceptance:operations -- ${id}`,
    observed: [`${id} recovered exact retained state`],
    artifacts: [{
      path: `artifacts/operations/${id.toLowerCase()}.json`,
      sha256: digest,
      kind: 'operations-recovery-evidence',
    }],
  })),
});

test('operations label is emitted only when all backup/restore checks pass on the exact commit', () => {
  const result = evaluateBackupRestoreEvidence(input(), commit);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.allPassed, true);
  assert.equal(result.value.evidence, 'operations-backup-restore');
  assert.deepEqual(result.value.failures, []);
});

test('failed/not-run checks and commit mismatch remain explicitly incomplete', () => {
  const fixture = input();
  const checks = [...fixture.checks];
  checks[0] = {
    id: 'OPS-01',
    verdict: 'NOT_RUN',
    observed: [],
    artifacts: [],
    limitation: 'Archive fixture was not run.',
  };
  checks[2] = {
    id: 'OPS-03',
    verdict: 'FAIL',
    command: 'npm run acceptance:operations -- OPS-03',
    observed: ['Qdrant recovery did not restore expected snapshot membership.'],
    artifacts: [{
      path: 'artifacts/operations/ops-03.json',
      sha256: digest,
      kind: 'operations-recovery-evidence',
    }],
  };
  const result = evaluateBackupRestoreEvidence({ ...fixture, checks }, 'c'.repeat(40));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.allPassed, false);
  assert.equal(result.value.evidence, 'operations-backup-restore-incomplete');
  assert.ok(result.value.failures.includes('not_run:OPS-01'));
  assert.ok(result.value.failures.includes('fail:OPS-03'));
  assert.ok(result.value.failures.includes('source_commit_mismatch'));
});

test('PASS cannot omit command, observation or retained artifact', () => {
  const fixture = input();
  const checks = [...fixture.checks];
  checks[0] = { id: 'OPS-01', verdict: 'PASS', observed: [], artifacts: [] };
  const result = evaluateBackupRestoreEvidence({ ...fixture, checks }, commit);
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_BENCHMARK');
});

test('duplicate/missing checks and credential-like environment metadata fail closed', () => {
  const fixture = input();
  const missing = evaluateBackupRestoreEvidence({ ...fixture, checks: fixture.checks.slice(0, -1) }, commit);
  assert.equal(missing._tag, 'Err');

  const duplicate = evaluateBackupRestoreEvidence({
    ...fixture,
    checks: fixture.checks.map((item, index) => index === 5 ? { ...item, id: 'OPS-01' } : item),
  }, commit);
  assert.equal(duplicate._tag, 'Err');

  const unsafe = evaluateBackupRestoreEvidence({
    ...fixture,
    environment: { ...fixture.environment, deployment: 'password=secret' },
  }, commit);
  assert.equal(unsafe._tag, 'Err');
});
