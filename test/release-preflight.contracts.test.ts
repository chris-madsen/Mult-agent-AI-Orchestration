import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  evaluateReleasePreflight,
  ownerApprovalPayload,
  type ReleaseExternalEvidence,
  type ReleaseOwnerApproval,
  type ReleaseOwnerApprovalTrustRoot,
} from '../src/domain/release-preflight.js';
import type { DbcEvidenceRecord, DbcId } from '../src/domain/dbc-evidence.js';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const ownerKeys = generateKeyPairSync('ed25519');
const ownerPublicKeyPem = ownerKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ownerTrustRoot: ReleaseOwnerApprovalTrustRoot = {
  signingKeyId: 'test-owner-key',
  publicKeyPem: ownerPublicKeyPem,
  publicKeySha256: createHash('sha256').update(ownerPublicKeyPem, 'utf8').digest('hex'),
  publicKeyIdentityVerified: true,
  signatureVerified: true,
};
const signedApproval = (
  approvedCapabilities: readonly ('code' | 'documentation' | 'memory')[],
  reference: string,
  approvedProviderIdentities: readonly string[] = ['fastembed/onnx', 'typescript-language-service'],
): ReleaseOwnerApproval => {
  const unsigned: ReleaseOwnerApproval = {
    schemaVersion: 1,
    status: 'approved',
    releaseCommit: commit,
    reference,
    approvedCapabilities,
    approvedProviderIdentities,
    signingKeyId: ownerTrustRoot.signingKeyId,
  };
  const payload = ownerApprovalPayload(unsigned);
  return {
    ...unsigned,
    publicKeyPem: ownerPublicKeyPem,
    signedPayloadSha256: createHash('sha256').update(payload, 'utf8').digest('hex'),
    signatureBase64: sign(null, Buffer.from(payload, 'utf8'), ownerKeys.privateKey).toString('base64'),
  };
};
const boundMeasurementArtifacts = [
  'dbc', 'embeddingSelection', 'semanticSelection', 'retrievalQuality',
  'harborThreeArm', 'resourceBudget', 'runtimeConfig',
].map((name) => ({ name, path: `artifacts/${name}.json`, sha256: digest }))
  .sort((left, right) => left.name.localeCompare(right.name));
const evidenceBinding = {
  schemaVersion: 1 as const,
  sourceCommit: commit,
  measurementArtifacts: boundMeasurementArtifacts,
  providerIdentities: ['fastembed/onnx', 'typescript-language-service'],
  reportIdentitySha256: createHash('sha256').update(JSON.stringify(boundMeasurementArtifacts), 'utf8').digest('hex'),
  reportIdentityVerified: true,
};

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
  if (name === 'graphiti-crash-recovery') return {
    schemaVersion: 1,
    evidence: 'real-graphiti-crash-recovery',
    sourceCommit: commit,
    fixture: 'benchmarks/fixtures/graphiti-memory-lifecycle-v1.json',
    fixtureSha256: digest,
    workspaceId: 'workspace-crash-1',
    groupId: 'group-crash-1',
    episodeId: 'episode-crash-1',
    graphitiVersion: 'graphiti/fixture-1',
    inference: { llm: 'local-llm/fixture', embedder: 'local-embedder/fixture', reranker: 'local-reranker/fixture' },
    crash: {
      signal: 'SIGKILL',
      failpoint: 'after_graphiti_enqueue_before_outbox_receipt',
      providerStatusBeforeCrash: 'pending',
      durableReceiptBeforeRecovery: { status: 'pending', attempts: 0 },
    },
    recovery: {
      reconcilePasses: 2,
      durableProjected: true,
      projectionAttempts: 1,
      provenanceHitCount: 1,
      purgeVerified: true,
      archiveTombstoneVerified: true,
      outboxTombstoned: true,
    },
    traces: { crashWorkerSha256: digest, recoverySha256: 'c'.repeat(64) },
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
  ['graphiti-crash-recovery', 'real-graphiti-crash-recovery'],
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

const runtimeConfig = {
  schemaVersion: 1,
  generatedAt: '2026-10-20T00:00:00.000Z',
  evidence: 'runtime-config-accepted',
  scope: 'full-unified',
  deployment: 'k3s',
  sourceCommit: commit,
  currentCommit: commit,
  captureReference: 'release-runtime-capture',
  workspaceIdHash: digest,
  codeRetrieval: {
    enabled: true,
    qdrantEnabled: true,
    pinnedEmbeddingRequired: true,
    localFallbackAllowed: false,
    embeddingProvider: 'fastembed/onnx',
    semanticProvider: 'typescript-language-service',
  },
  documentation: { enabled: true, cloudDocsOptIn: true },
  memory: { enabled: true, localOnly: true },
  worktree: { hostHelperEnabled: true, mtlsRequired: true },
  cloudPermissions: [{ provider: 'vertex', dataClasses: ['project_document'] }],
  verdict: {
    evidence: 'runtime-config-accepted',
    scope: 'full-unified',
    deployment: 'k3s',
    sourceCommit: commit,
    embeddingProvider: 'fastembed/onnx',
    semanticProvider: 'typescript-language-service',
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
    schemaVersion: 1,
    sourceCommit: commit,
    reportPath: 'artifacts/embedding-comparison.json',
    policyPath: 'benchmarks/policies/embedding-selection.json',
    reportSha256: digest,
    policySha256: digest,
    evidenceStage: 'frozen_holdout',
    dataset: 'release-fixture',
    datasetSha256: digest,
    verdict: {
      status: 'PRODUCTION_APPROVED',
      productionApproved: true,
      measurementAccepted: true,
      selectedProvider: 'fastembed/onnx',
      failures: [],
    },
  },
  semanticSelection: {
    schemaVersion: 1,
    sourceCommit: commit,
    policyPath: 'benchmarks/policies/semantic-provider-selection.json',
    policySha256: digest,
    fixtureSha256: digest,
    oracleSha256: digest,
    reports: [{ path: 'semantic-a.json', sha256: digest }, { path: 'semantic-b.json', sha256: digest }],
    providerIds: ['serena', 'typescript-language-service'],
    verdict: {
      status: 'PRODUCTION_APPROVED',
      productionApproved: true,
      measurementAccepted: true,
      matchedComparison: true,
      selectedProvider: 'typescript-language-service',
      failures: [],
    },
  },
  retrievalQuality: {
    schemaVersion: 1,
    sourceCommit: commit,
    holdoutSha256: digest,
    runSha256: digest,
    policySha256: digest,
    verdict: {
      measurementAccepted: true,
      selectedStrategy: 'hybrid',
      failures: [],
      metrics: {
        holdoutStatus: 'frozen_holdout',
        strategy: 'hybrid',
        cases: 3,
        recallAt1: 1,
        recallAt3: 1,
        recallAt5: 1,
        mrr: 1,
        ndcgAt5: 1,
      },
    },
  },
  resourceBudget,
  runtimeConfig,
  harborThreeArm: {
    schemaVersion: 1,
    sourceCommit: commit,
    outcome: {
      forcedArm: 'diagnostic-only',
      productionAcceptance: 'measured-not-necessarily-5x',
      naturalUse: 'observed_complete',
      naturalQualityNonInferior: true,
      naturalProviderCorrelationVerified: true,
      costTelemetryComplete: true,
      nativeTrials: 9,
      naturalTrials: 9,
      forcedTrials: 9,
      naturalRawTokenRatioAceOverNative: 0.8,
      forcedRawTokenRatioAceOverNative: 0.9,
    },
    execution_identity: {
      native_job_sha256: digest,
      natural_job_sha256: digest,
      forced_job_sha256: digest,
      design_fingerprint: digest,
      task_paths: ['task-a', 'task-b', 'task-c'],
    },
    source_reports: { natural_sha256: digest, forced_sha256: digest },
  },
  externalEvidence,
  evidenceBinding,
  ownerApproval: {
    ...signedApproval(['code', 'documentation', 'memory'], 'owner-signoff-2026-10-20'),
  },
  ownerApprovalTrustRoot: ownerTrustRoot,
});

test('full unified release is READY only when every mandatory evidence family is accepted', () => {
  const result = evaluateReleasePreflight(baseInput());
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'READY');
  assert.deepEqual(result.value.failures, []);
});

test('release preflight rejects an unbound verdict or a tampered owner approval', () => {
  const noBinding = evaluateReleasePreflight({ ...baseInput(), evidenceBinding: undefined });
  assert.equal(noBinding._tag, 'Ok');
  if (noBinding._tag === 'Ok') assert.ok(noBinding.value.failures.includes('evidence_binding_missing'));

  const tampered = evaluateReleasePreflight({
    ...baseInput(),
    ownerApproval: { ...baseInput().ownerApproval, reference: 'changed-after-signing' },
    ownerApprovalTrustRoot: { ...ownerTrustRoot, signatureVerified: false },
  });
  assert.equal(tampered._tag, 'Ok');
  if (tampered._tag === 'Ok') assert.ok(tampered.value.failures.includes('owner_approval_signature_invalid'));
});

test('owner approval binds the selected provider identities into the signed release scope', () => {
  const input = baseInput();
  const mismatched = evaluateReleasePreflight({
    ...input,
    ownerApproval: signedApproval(
      ['code', 'documentation', 'memory'],
      'owner-signoff-2026-10-20',
      ['fastembed/onnx', 'serena'],
    ),
  });
  assert.equal(mismatched._tag, 'Ok');
  if (mismatched._tag === 'Ok') {
    assert.equal(mismatched.value.status, 'BLOCKED');
    assert.ok(mismatched.value.failures.includes('owner_approval_provider_scope_mismatch'));
  }

  const missing = evaluateReleasePreflight({
    ...input,
    ownerApproval: { ...input.ownerApproval, approvedProviderIdentities: [] },
  });
  assert.equal(missing._tag, 'Ok');
  if (missing._tag === 'Ok') {
    assert.equal(missing.value.status, 'BLOCKED');
    assert.ok(missing.value.failures.includes('owner_approval_provider_scope_invalid'));
  }
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


test('full release blocks runtime scope/provider/config drift even when selection artifacts are approved', () => {
  const input = baseInput();
  const mismatchedProvider = evaluateReleasePreflight({
    ...input,
    runtimeConfig: {
      ...runtimeConfig,
      codeRetrieval: { ...runtimeConfig.codeRetrieval, semanticProvider: 'serena' },
      verdict: { ...runtimeConfig.verdict, semanticProvider: 'serena' },
    },
  });
  assert.equal(mismatchedProvider._tag, 'Ok');
  if (mismatchedProvider._tag === 'Ok') {
    assert.equal(mismatchedProvider.value.status, 'BLOCKED');
    assert.ok(mismatchedProvider.value.failures.includes('runtime_semantic_provider_mismatch'));
  }

  const cloudScopeDrift = evaluateReleasePreflight({
    ...input,
    runtimeConfig: {
      ...runtimeConfig,
      cloudPermissions: [{ provider: 'vertex', dataClasses: ['project_document', 'private_source'] }],
    },
  });
  assert.equal(cloudScopeDrift._tag, 'Ok');
  if (cloudScopeDrift._tag === 'Ok') {
    assert.equal(cloudScopeDrift.value.status, 'BLOCKED');
    assert.ok(cloudScopeDrift.value.failures.includes('runtime_config_not_accepted'));
  }
});


test('full release requires Graphiti crash-recovery evidence in addition to the happy-path lifecycle', () => {
  const input = baseInput();
  const result = evaluateReleasePreflight({
    ...input,
    externalEvidence: input.externalEvidence.filter((item) => item.name !== 'graphiti-crash-recovery'),
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'BLOCKED');
  assert.ok(result.value.failures.includes('external_evidence_missing:graphiti-crash-recovery'));
});

test('full release rejects forged acceptance flags and inconsistent artifact identities', () => {
  const input = baseInput();
  const result = evaluateReleasePreflight({
    ...input,
    embeddingSelection: {
      ...input.embeddingSelection,
      sourceCommit: 'f'.repeat(40),
      verdict: {
        ...input.embeddingSelection.verdict,
        status: 'MEASUREMENT_PASS_APPROVAL_PENDING',
        productionApproved: true,
      },
    },
    retrievalQuality: {
      ...input.retrievalQuality,
      verdict: {
        ...input.retrievalQuality.verdict,
        metrics: { ...input.retrievalQuality.verdict.metrics, cases: 0 },
      },
    },
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.status, 'BLOCKED');
  assert.ok(result.value.failures.includes('embedding_evidence_identity_invalid'));
  assert.ok(result.value.failures.includes('embedding_not_production_approved'));
  assert.ok(result.value.failures.includes('retrieval_evidence_identity_invalid'));
});

test('full release hashes binary DBC artifacts without parsing them as JSON', async () => {
  const root = await mkdtemp(join(process.cwd(), '.tmp-release-preflight-'));
  try {
    const binaryPath = join(root, 'dbc-evidence.bin');
    const binary = Buffer.from([0, 255, 1, 2, 3]);
    await writeFile(binaryPath, binary);
    const emptyPath = join(root, 'empty.json');
    await writeFile(emptyPath, '{}\n', 'utf8');
    const current = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const policyPath = join(root, 'policy.json');
    const outputPath = join(root, 'output.json');
    await writeFile(policyPath, JSON.stringify({
      schemaVersion: 1,
      ownerApproval: {
        status: 'pending',
        releaseCommit: current,
        reference: 'test-only',
        approvedCapabilities: [],
      },
      ownerApprovalTrustRoot: { signingKeyId: 'test', publicKeySha256: digest, publicKeyPem: 'test-key' },
      artifacts: {
        dbc: join(root, 'dbc.json'),
        embeddingSelection: emptyPath,
        semanticSelection: emptyPath,
        retrievalQuality: emptyPath,
        harborThreeArm: emptyPath,
        resourceBudget: emptyPath,
        runtimeConfig: emptyPath,
      },
      externalEvidence: [],
    }, null, 2), 'utf8');
    await writeFile(join(root, 'dbc.json'), JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-10-20T00:00:00.000Z',
      records: [{
        dbcId: 'DBC-01',
        verdict: 'PASS',
        sourceCommit: current,
        fixtureSha256: 'a'.repeat(64),
        command: 'test',
        toolVersions: { node: '22' },
        credentialScope: 'test-only',
        requestIds: [],
        artifacts: [{
          path: binaryPath,
          sha256: createHash('sha256').update(binary).digest('hex'),
          kind: 'binary',
        }],
        observed: ['binary retained'],
      }],
    }, null, 2), 'utf8');
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/release-preflight.ts', policyPath, outputPath], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
    const output = JSON.parse(await (await import('node:fs/promises')).readFile(outputPath, 'utf8')) as { verdict?: { status?: string } };
    assert.equal(output.verdict?.status, 'BLOCKED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
