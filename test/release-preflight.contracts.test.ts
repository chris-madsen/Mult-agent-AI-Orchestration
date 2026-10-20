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

const aggregateDocument = (
  evidence: 'real-k3s-live-worktree' | 'operations-backup-restore',
  prefix: 'K3S' | 'OPS',
  count: number,
) => ({
  schemaVersion: 1,
  evidence,
  sourceCommit: commit,
  currentCommit: commit,
  checks: Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    verdict: 'PASS',
    artifacts: [{ path: `artifacts/${prefix.toLowerCase()}/${index + 1}.json`, sha256: digest, kind: 'fixture' }],
  })),
  verdict: { evidence, sourceCommit: commit, allPassed: true, failures: [] },
});

const externalDocument = (name: ReleaseExternalEvidence['name']): unknown => {
  if (name === 'graphiti') return {
    evidence: 'real-graphiti-lifecycle',
    sourceCommit: commit,
    fixture: 'benchmarks/fixtures/graphiti-memory-lifecycle-v1.json',
    fixtureSha256: digest,
    providerTrace: 'artifacts/graphiti/provider-trace.jsonl',
    graphitiVersion: 'graphiti/fixture-1',
    inference: { llm: 'local-llm/fixture', embedder: 'local-embedder/fixture', reranker: 'local-reranker/fixture' },
    lifecycle: {
      episodeId: 'episode-1',
      sourcePointer: 'codex://fixture/1',
      sourceDigest: digest,
      projectionKey: 'episode-1:extractor-v1',
      projectionAttempts: 1,
      projectionObserved: true,
      provenanceHitCount: 1,
      requestId: 'graphiti-request-1',
      purgeVerified: true,
      archiveTombstoneVerified: true,
    },
  };
  if (name === 'vertex') return {
    evidence: 'real-vertex-synthetic-code-doc-conflict',
    sourceCommit: commit,
    requestId: 'vertex-request-1',
    project: 'fixture-project',
    location: 'europe-west4',
    corpusId: 'fixture-corpus',
    providerTrace: 'artifacts/vertex/provider-trace.jsonl',
    documentation: {
      fixtureSha256: digest,
      fixtureVersion: 'vertex-conflict-v1',
      citations: ['gs://fixture/adr.md'],
      retrievedEvidenceIds: ['vertex-evidence-1'],
      claim: 'wait-for-operator-confirmation',
    },
    currentCode: {
      fixtureSha256: digest,
      symbol: 'aceVertexConflictPolicy',
      claim: 'retry-immediately',
    },
    conflict: { detectedByGate: true, priorityForCurrentBehavior: 'current-code' },
  };
  if (name === 'k3s-worktree') return aggregateDocument('real-k3s-live-worktree', 'K3S', 10);
  if (name === 'backup-restore') return aggregateDocument('operations-backup-restore', 'OPS', 6);
  return {
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
      baseImageDigest: `sha256:${'e'.repeat(64)}`,
      baseImageReference: `node:22-bookworm-slim@sha256:${'e'.repeat(64)}`,
    },
  };
};

const externalEvidence: ReleaseExternalEvidence[] = [
  ['graphiti', 'real-graphiti-lifecycle'],
  ['vertex', 'real-vertex-synthetic-code-doc-conflict'],
  ['k3s-worktree', 'real-k3s-live-worktree'],
  ['backup-restore', 'operations-backup-restore'],
  ['supply-chain', 'supply-chain-provenance'],
].map(([name, evidence]) => ({
  name: name as ReleaseExternalEvidence['name'],
  evidence,
  sha256: digest,
  document: externalDocument(name as ReleaseExternalEvidence['name']),
}));

const resourceBudget = {
  schemaVersion: 1,
  generatedAt: '2026-10-20T00:00:00.000Z',
  evidence: 'resource-budget-accepted',
  scope: 'full-unified',
  sourceCommit: commit,
  currentCommit: commit,
  budgetPolicy: {
    reference: 'owner-resource-budget-v1',
    sha256: digest,
    metrics: [
      ['process_peak_rss_bytes', 'bytes'],
      ['startup_ready_ms', 'ms'],
      ['cold_index_ms', 'ms'],
      ['code_query_p95_ms', 'ms'],
      ['documentation_query_p95_ms', 'ms'],
      ['memory_query_p95_ms', 'ms'],
    ].map(([metric, unit]) => ({
      metric,
      unit,
      maximum: unit === 'bytes' ? 2_000_000_000 : 5_000,
      minimumSamples: 3,
    })),
  },
  measurementEnvironment: {
    runtime: 'node/22|ace/0.1.0',
    deployment: 'k3s',
    hostClass: 'fixture-host',
  },
  observed: [
    ['process_peak_rss_bytes', 'bytes'],
    ['startup_ready_ms', 'ms'],
    ['cold_index_ms', 'ms'],
    ['code_query_p95_ms', 'ms'],
    ['documentation_query_p95_ms', 'ms'],
    ['memory_query_p95_ms', 'ms'],
  ].map(([metric, unit]) => ({
    metric,
    unit,
    observed: unit === 'bytes' ? 900_000_000 : 1_000,
    sampleCount: 5,
    method: 'retained-release-measurement',
  })),
  verdict: {
    evidence: 'resource-budget-accepted',
    scope: 'full-unified',
    sourceCommit: commit,
    allWithinBudget: true,
    failures: [],
  },
};

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


test('full release blocks forged or over-budget resource evidence', () => {
  const input = baseInput();
  const result = evaluateReleasePreflight({
    ...input,
    resourceBudget: {
      ...resourceBudget,
      observed: resourceBudget.observed.map((item) => item.metric === 'memory_query_p95_ms'
        ? { ...item, observed: 10_000 }
        : item),
    },
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'BLOCKED');
  assert.ok(result.value.failures.includes('resource_budget_not_accepted'));
});
