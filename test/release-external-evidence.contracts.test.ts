import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReleaseExternalEvidenceDocument } from '../src/domain/release-external-evidence.js';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);

const graphiti = {
  evidence: 'real-graphiti-lifecycle',
  sourceCommit: commit,
  fixture: 'benchmarks/fixtures/graphiti-memory-lifecycle-v1.json',
  fixtureSha256: digest,
  providerTrace: 'artifacts/graphiti/provider-trace.jsonl',
  graphitiVersion: 'graphiti/1.0',
  inference: { llm: 'local-llm/1', embedder: 'local-embedder/1', reranker: 'local-reranker/1' },
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

const vertex = {
  evidence: 'real-vertex-synthetic-code-doc-conflict',
  sourceCommit: commit,
  requestId: 'vertex-request-1',
  project: 'project',
  location: 'europe-west4',
  corpusId: 'corpus',
  providerTrace: 'artifacts/vertex/provider-trace.jsonl',
  documentation: {
    fixtureSha256: digest,
    fixtureVersion: 'vertex-conflict-v1',
    citations: ['gs://fixture/adr.md'],
    retrievedEvidenceIds: ['evidence-1'],
    claim: 'wait-for-operator-confirmation',
  },
  currentCode: {
    fixtureSha256: digest,
    symbol: 'aceVertexConflictPolicy',
    claim: 'retry-immediately',
  },
  conflict: { detectedByGate: true, priorityForCurrentBehavior: 'current-code' },
};

const aggregate = (
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
    artifacts: [{ path: `artifacts/${prefix.toLowerCase()}/${index}.json`, sha256: digest, kind: 'fixture' }],
  })),
  verdict: { evidence, sourceCommit: commit, allPassed: true, failures: [] },
});

const supplyChain = {
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

test('release external validator accepts internally consistent exact-commit evidence families', () => {
  for (const [name, document] of [
    ['graphiti', graphiti],
    ['vertex', vertex],
    ['k3s-worktree', aggregate('real-k3s-live-worktree', 'K3S', 10)],
    ['backup-restore', aggregate('operations-backup-restore', 'OPS', 6)],
    ['supply-chain', supplyChain],
  ] as const) {
    const result = validateReleaseExternalEvidenceDocument(name, document, commit);
    assert.equal(result._tag, 'Ok', name);
  }
});

test('a forged label without the underlying provider proof is rejected', () => {
  for (const [name, evidence] of [
    ['graphiti', 'real-graphiti-lifecycle'],
    ['vertex', 'real-vertex-synthetic-code-doc-conflict'],
    ['k3s-worktree', 'real-k3s-live-worktree'],
    ['backup-restore', 'operations-backup-restore'],
    ['supply-chain', 'supply-chain-provenance'],
  ] as const) {
    const result = validateReleaseExternalEvidenceDocument(name, { evidence, sourceCommit: commit }, commit);
    assert.equal(result._tag, 'Err', name);
  }
});

test('external evidence from another commit cannot be promoted into the current release', () => {
  for (const [name, document] of [
    ['graphiti', graphiti],
    ['vertex', vertex],
    ['k3s-worktree', aggregate('real-k3s-live-worktree', 'K3S', 10)],
    ['backup-restore', aggregate('operations-backup-restore', 'OPS', 6)],
    ['supply-chain', supplyChain],
  ] as const) {
    const result = validateReleaseExternalEvidenceDocument(name, document, 'c'.repeat(40));
    assert.equal(result._tag, 'Err', name);
  }
});

test('Graphiti unknown inference/version and Vertex missing conflict/citations fail closed', () => {
  const unknownGraphiti = validateReleaseExternalEvidenceDocument('graphiti', {
    ...graphiti,
    graphitiVersion: 'unknown',
  }, commit);
  assert.equal(unknownGraphiti._tag, 'Err');

  const missingInference = validateReleaseExternalEvidenceDocument('graphiti', {
    ...graphiti,
    inference: { ...graphiti.inference, llm: 'unknown' },
  }, commit);
  assert.equal(missingInference._tag, 'Err');

  const noCitations = validateReleaseExternalEvidenceDocument('vertex', {
    ...vertex,
    documentation: { ...vertex.documentation, citations: [] },
  }, commit);
  assert.equal(noCitations._tag, 'Err');

  const wrongPriority = validateReleaseExternalEvidenceDocument('vertex', {
    ...vertex,
    conflict: { detectedByGate: true, priorityForCurrentBehavior: 'documentation' },
  }, commit);
  assert.equal(wrongPriority._tag, 'Err');
});

test('aggregate and supply-chain evidence must contain an internal PASS, not only the outer label', () => {
  const k3s = aggregate('real-k3s-live-worktree', 'K3S', 10);
  const failedK3s = validateReleaseExternalEvidenceDocument('k3s-worktree', {
    ...k3s,
    checks: k3s.checks.map((item, index) => index === 0 ? { ...item, verdict: 'FAIL' } : item),
  }, commit);
  assert.equal(failedK3s._tag, 'Err');

  const failedSupply = validateReleaseExternalEvidenceDocument('supply-chain', {
    ...supplyChain,
    verdict: { ...supplyChain.verdict, status: 'FAIL', failures: ['audit'] },
  }, commit);
  assert.equal(failedSupply._tag, 'Err');
});
