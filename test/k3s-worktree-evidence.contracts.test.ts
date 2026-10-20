import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateK3sWorktreeEvidence,
  requiredK3sWorktreeChecks,
  type K3sWorktreeEvidenceInput,
} from '../src/domain/k3s-worktree-evidence.js';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);

const completeInput = (): K3sWorktreeEvidenceInput => ({
  schemaVersion: 1,
  sourceCommit: commit,
  generatedAt: '2026-10-20T00:00:00.000Z',
  environment: {
    k3sVersion: 'k3s/v1.31.0',
    nodeVersion: 'node/22.23.3',
    helperVersion: 'ace-worktree-helper/0.1.0',
    workspaceIdHash: 'c'.repeat(64),
  },
  checks: requiredK3sWorktreeChecks.map((id) => ({
    id,
    verdict: 'PASS' as const,
    command: `npm run acceptance:k3s-worktree -- ${id}`,
    observed: [`${id} passed on disposable workspace`],
    artifacts: [{
      path: `artifacts/k3s/${id.toLowerCase()}.json`,
      sha256: digest,
      kind: 'safe-k3s-observation',
    }],
  })),
});

test('k3s evidence label is emitted only when all ten required checks pass on the exact commit', () => {
  const result = evaluateK3sWorktreeEvidence(completeInput(), commit);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.evidence, 'real-k3s-live-worktree');
  assert.equal(result.value.allPassed, true);
  assert.deepEqual(result.value.failures, []);
});

test('NOT_RUN, BLOCKED, FAIL and commit mismatch keep evidence explicitly incomplete', () => {
  const input = completeInput();
  const checks = [...input.checks];
  checks[0] = {
    id: 'K3S-01',
    verdict: 'NOT_RUN',
    observed: [],
    artifacts: [],
    limitation: 'Cluster fixture was not available.',
  };
  checks[1] = {
    id: 'K3S-02',
    verdict: 'FAIL',
    command: 'npm run acceptance:k3s-worktree -- K3S-02',
    observed: ['Unknown workspace request unexpectedly succeeded.'],
    artifacts: [{
      path: 'artifacts/k3s/k3s-02.json',
      sha256: digest,
      kind: 'safe-k3s-observation',
    }],
  };
  const result = evaluateK3sWorktreeEvidence({ ...input, checks }, 'd'.repeat(40));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.evidence, 'k3s-live-worktree-incomplete');
  assert.equal(result.value.allPassed, false);
  assert.ok(result.value.failures.includes('not_run:K3S-01'));
  assert.ok(result.value.failures.includes('fail:K3S-02'));
  assert.ok(result.value.failures.includes('source_commit_mismatch'));
});

test('PASS cannot exist without command, observation and retained artifact digest', () => {
  const input = completeInput();
  const checks = [...input.checks];
  checks[0] = {
    id: 'K3S-01',
    verdict: 'PASS',
    observed: [],
    artifacts: [],
  };
  const result = evaluateK3sWorktreeEvidence({ ...input, checks }, commit);
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_BENCHMARK');
});

test('missing/duplicate check IDs and unsafe credential-like metadata are rejected', () => {
  const input = completeInput();
  const missing = evaluateK3sWorktreeEvidence({
    ...input,
    checks: input.checks.slice(0, -1),
  }, commit);
  assert.equal(missing._tag, 'Err');

  const duplicate = evaluateK3sWorktreeEvidence({
    ...input,
    checks: input.checks.map((item, index) => index === 9 ? { ...item, id: 'K3S-01' } : item),
  }, commit);
  assert.equal(duplicate._tag, 'Err');

  const unsafe = evaluateK3sWorktreeEvidence({
    ...input,
    environment: {
      ...input.environment,
      helperVersion: 'authorization=Bearer-secret',
    },
  }, commit);
  assert.equal(unsafe._tag, 'Err');
});
