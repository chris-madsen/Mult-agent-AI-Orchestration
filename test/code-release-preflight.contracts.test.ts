import assert from 'node:assert/strict';
import test from 'node:test';
import {
  codeOnlyRequiredDbcs,
  evaluateCodeReleasePreflight,
  type CodeReleaseExternalEvidence,
} from '../src/domain/code-release-preflight.js';
import type { DbcEvidenceRecord, DbcId } from '../src/domain/dbc-evidence.js';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);

const dbcRecords = (): DbcEvidenceRecord[] => codeOnlyRequiredDbcs.map((dbcId) => ({
  dbcId,
  verdict: 'PASS',
  sourceCommit: commit,
  fixtureSha256: 'c'.repeat(64),
  command: `npm run acceptance -- ${dbcId}`,
  toolVersions: { node: '22.23.3', ace: '0.1.0' },
  credentialScope: 'synthetic-or-explicitly-authorized-evidence',
  requestIds: dbcId === 'DBC-12' ? ['harbor-code-request-1'] : [],
  artifacts: [{
    path: `artifacts/dbc/${dbcId.toLowerCase()}.json`,
    sha256: digest,
    kind: 'acceptance-evidence',
  }],
  observed: [`${dbcId} code-scope acceptance passed`],
}));

const supplyChain: CodeReleaseExternalEvidence = {
  name: 'supply-chain',
  evidence: 'supply-chain-provenance',
  sha256: digest,
  document: {
    schemaVersion: 1,
    evidence: 'supply-chain-provenance',
    currentCommit: commit,
    verdict: {
      status: 'PASS',
      evidence: 'supply-chain-provenance',
      failures: [],
      sourceCommit: commit,
      packageLockSha256: digest,
      sbomSha256: digest,
      imageDigest: `sha256:${digest}`,
    },
  },
};

const k3sDocument = {
  schemaVersion: 1,
  evidence: 'real-k3s-live-worktree',
  sourceCommit: commit,
  currentCommit: commit,
  checks: Array.from({ length: 10 }, (_, index) => ({
    id: `K3S-${String(index + 1).padStart(2, '0')}`,
    verdict: 'PASS',
    artifacts: [{ path: `artifacts/k3s/${index + 1}.json`, sha256: digest, kind: 'fixture' }],
  })),
  verdict: {
    evidence: 'real-k3s-live-worktree',
    sourceCommit: commit,
    allPassed: true,
    failures: [],
  },
};

const resourceBudget = {
  schemaVersion: 1,
  generatedAt: '2026-10-20T00:00:00.000Z',
  evidence: 'resource-budget-accepted',
  scope: 'code-only',
  sourceCommit: commit,
  currentCommit: commit,
  budgetPolicy: {
    reference: 'owner-code-resource-budget-v1',
    sha256: digest,
    metrics: [
      ['process_peak_rss_bytes', 'bytes'],
      ['startup_ready_ms', 'ms'],
      ['cold_index_ms', 'ms'],
      ['code_query_p95_ms', 'ms'],
    ].map(([metric, unit]) => ({
      metric,
      unit,
      maximum: unit === 'bytes' ? 2_000_000_000 : 5_000,
      minimumSamples: 3,
    })),
  },
  measurementEnvironment: {
    runtime: 'node/22|ace/0.1.0',
    deployment: 'host',
    hostClass: 'fixture-host',
  },
  observed: [
    ['process_peak_rss_bytes', 'bytes'],
    ['startup_ready_ms', 'ms'],
    ['cold_index_ms', 'ms'],
    ['code_query_p95_ms', 'ms'],
  ].map(([metric, unit]) => ({
    metric,
    unit,
    observed: unit === 'bytes' ? 900_000_000 : 1_000,
    sampleCount: 5,
    method: 'retained-release-measurement',
  })),
  verdict: {
    evidence: 'resource-budget-accepted',
    scope: 'code-only',
    sourceCommit: commit,
    allWithinBudget: true,
    failures: [],
  },
};

const baseInput = () => ({
  currentCommit: commit,
  deployment: 'host' as const,
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
  resourceBudget,
  harborThreeArm: {
    outcome: {
      productionAcceptance: 'measured-not-necessarily-5x',
      naturalUse: 'observed_complete',
      naturalQualityNonInferior: true,
      naturalProviderCorrelationVerified: true,
      costTelemetryComplete: true,
    },
  },
  externalEvidence: [supplyChain],
  ownerApproval: {
    status: 'approved' as const,
    releaseCommit: commit,
    reference: 'owner-code-only-signoff',
    approvedCapabilities: ['code'] as const,
  },
});

test('host code-only release is ready without pretending docs or memory are approved', () => {
  const result = evaluateCodeReleasePreflight(baseInput());
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'READY_CODE_ONLY');
  assert.equal(result.value.scope, 'code-only');
  assert.deepEqual(result.value.failures, []);
  assert.deepEqual(result.value.requiredDbcs, [
    'DBC-01', 'DBC-02', 'DBC-03', 'DBC-04', 'DBC-05', 'DBC-06',
    'DBC-07', 'DBC-08', 'DBC-09', 'DBC-12', 'DBC-13',
  ]);
});

test('memory/documentation-only DBCs are outside code-only scope, but every code DBC is mandatory', () => {
  const input = baseInput();
  const withUnrelatedFailures: DbcEvidenceRecord[] = [
    ...dbcRecords(),
    ...(['DBC-10', 'DBC-11', 'DBC-14'] as DbcId[]).map((dbcId) => ({
      dbcId,
      verdict: 'NOT_RUN' as const,
      sourceCommit: commit,
      toolVersions: { node: '22.23.3', ace: '0.1.0' },
      credentialScope: 'not-in-code-only-scope',
      requestIds: [],
      artifacts: [],
      observed: [],
      limitation: 'Capability is outside the explicit code-only release scope.',
    })),
  ];
  const unrelated = evaluateCodeReleasePreflight({
    ...input,
    dbc: {
      schemaVersion: 1,
      generatedAt: '2026-10-20T00:00:00Z',
      records: withUnrelatedFailures,
    },
  });
  assert.equal(unrelated._tag, 'Ok');
  if (unrelated._tag === 'Ok') assert.equal(unrelated.value.status, 'READY_CODE_ONLY');

  const missing = dbcRecords().filter((item) => item.dbcId !== 'DBC-05');
  const requiredMissing = evaluateCodeReleasePreflight({
    ...input,
    dbc: {
      schemaVersion: 1,
      generatedAt: '2026-10-20T00:00:00Z',
      records: missing,
    },
  });
  assert.equal(requiredMissing._tag, 'Ok');
  if (requiredMissing._tag === 'Ok') {
    assert.equal(requiredMissing.value.status, 'BLOCKED');
    assert.ok(requiredMissing.value.failures.includes('dbc_missing:DBC-05'));
  }
});

test('code-only gate cannot be reused to claim broader capability approval', () => {
  const input = baseInput();
  const result = evaluateCodeReleasePreflight({
    ...input,
    ownerApproval: {
      ...input.ownerApproval,
      approvedCapabilities: ['code', 'documentation'],
    },
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'BLOCKED');
  assert.ok(result.value.failures.includes('owner_scope_must_be_code_only'));
});

test('k3s code-only deployment requires real k3s worktree evidence while host deployment does not', () => {
  const input = baseInput();
  const missingK3s = evaluateCodeReleasePreflight({
    ...input,
    deployment: 'k3s',
  });
  assert.equal(missingK3s._tag, 'Ok');
  if (missingK3s._tag === 'Ok') {
    assert.equal(missingK3s.value.status, 'BLOCKED');
    assert.ok(missingK3s.value.failures.includes('external_evidence_missing:k3s-worktree'));
  }

  const withK3s = evaluateCodeReleasePreflight({
    ...input,
    deployment: 'k3s',
    externalEvidence: [
      supplyChain,
      { name: 'k3s-worktree', evidence: 'real-k3s-live-worktree', sha256: digest, document: k3sDocument },
    ],
  });
  assert.equal(withK3s._tag, 'Ok');
  if (withK3s._tag === 'Ok') assert.equal(withK3s.value.status, 'READY_CODE_ONLY');
});

test('code-only release still requires provider approval, frozen quality and natural-use Harbor evidence', () => {
  const input = baseInput();
  const result = evaluateCodeReleasePreflight({
    ...input,
    embeddingSelection: {
      verdict: { status: 'MEASUREMENT_PASS_APPROVAL_PENDING', productionApproved: false },
    },
    retrievalQuality: {
      verdict: {
        measurementAccepted: true,
        metrics: { holdoutStatus: 'development_fixture_not_release_holdout' },
      },
    },
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
  for (const failure of [
    'embedding_not_production_approved',
    'retrieval_quality_not_accepted_on_frozen_holdout',
    'harbor_natural_use_acceptance_incomplete',
  ]) assert.ok(result.value.failures.includes(failure), failure);
});


test('code-only release blocks full-scope or over-budget resource evidence', () => {
  const input = baseInput();
  const wrongScope = evaluateCodeReleasePreflight({
    ...input,
    resourceBudget: { ...resourceBudget, scope: 'full-unified', verdict: { ...resourceBudget.verdict, scope: 'full-unified' } },
  });
  assert.equal(wrongScope._tag, 'Ok');
  if (wrongScope._tag === 'Ok') {
    assert.equal(wrongScope.value.status, 'BLOCKED');
    assert.ok(wrongScope.value.failures.includes('resource_budget_not_accepted'));
  }

  const exceeded = evaluateCodeReleasePreflight({
    ...input,
    resourceBudget: {
      ...resourceBudget,
      observed: resourceBudget.observed.map((item) => item.metric === 'code_query_p95_ms'
        ? { ...item, observed: 9_000 }
        : item),
    },
  });
  assert.equal(exceeded._tag, 'Ok');
  if (exceeded._tag === 'Ok') {
    assert.equal(exceeded.value.status, 'BLOCKED');
    assert.ok(exceeded.value.failures.includes('resource_budget_not_accepted'));
  }
});
