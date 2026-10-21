import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  codeOnlyRequiredDbcs,
  evaluateCodeReleasePreflight,
  type CodeReleaseExternalEvidence,
} from '../src/domain/code-release-preflight.js';
import {
  ownerApprovalPayload,
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
  approvedProviderIdentities: readonly string[] = ['embedding-fixture-identity', 'semantic-fixture-identity'],
): ReleaseOwnerApproval => {
  const unsigned: ReleaseOwnerApproval = {
    schemaVersion: 1,
    status: 'approved',
    releaseCommit: commit,
    reference: 'owner-code-only-signoff',
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
      baseImageDigest: `sha256:${'e'.repeat(64)}`,
      baseImageReference: `node:22-bookworm-slim@sha256:${'e'.repeat(64)}`,
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

const runtimeConfig = (deployment: 'host' | 'k3s' = 'host') => ({
  schemaVersion: 1,
  generatedAt: '2026-10-20T00:00:00.000Z',
  evidence: 'runtime-config-accepted',
  scope: 'code-only',
  deployment,
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
  documentation: { enabled: false, cloudDocsOptIn: false },
  memory: { enabled: false, localOnly: true },
  worktree: {
    hostHelperEnabled: deployment === 'k3s',
    mtlsRequired: deployment === 'k3s',
  },
  cloudPermissions: [],
  verdict: {
    evidence: 'runtime-config-accepted',
    scope: 'code-only',
    deployment,
    sourceCommit: commit,
    embeddingProvider: 'fastembed/onnx',
    semanticProvider: 'typescript-language-service',
    failures: [],
  },
});

const baseInput = () => ({
  currentCommit: commit,
  deployment: 'host' as const,
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
      selectedProviderIdentity: 'embedding-fixture-identity',
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
      selectedProviderIdentity: 'semantic-fixture-identity',
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
  runtimeConfig: runtimeConfig(),
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
  externalEvidence: [supplyChain],
  ownerApproval: signedApproval(['code']),
  ownerApprovalTrustRoot: ownerTrustRoot,
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

test('code-only owner approval binds the selected provider identities', () => {
  const input = baseInput();
  const result = evaluateCodeReleasePreflight({
    ...input,
    ownerApproval: signedApproval(['code'], ['embedding-fixture-identity', 'serena-identity']),
  });
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.equal(result.value.status, 'BLOCKED');
    assert.ok(result.value.failures.includes('owner_approval_provider_scope_mismatch'));
  }
});

test('k3s code-only deployment requires real k3s worktree evidence while host deployment does not', () => {
  const input = baseInput();
  const missingK3s = evaluateCodeReleasePreflight({
    ...input,
    deployment: 'k3s',
    runtimeConfig: runtimeConfig('k3s'),
  });
  assert.equal(missingK3s._tag, 'Ok');
  if (missingK3s._tag === 'Ok') {
    assert.equal(missingK3s.value.status, 'BLOCKED');
    assert.ok(missingK3s.value.failures.includes('external_evidence_missing:k3s-worktree'));
  }

  const withK3s = evaluateCodeReleasePreflight({
    ...input,
    deployment: 'k3s',
    runtimeConfig: runtimeConfig('k3s'),
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


test('code-only release blocks docs/memory/cloud scope or provider drift in runtime config', () => {
  const input = baseInput();
  const leakedScope = evaluateCodeReleasePreflight({
    ...input,
    runtimeConfig: {
      ...runtimeConfig(),
      documentation: { enabled: true, cloudDocsOptIn: true },
      cloudPermissions: [{ provider: 'vertex', dataClasses: ['project_document'] }],
    },
  });
  assert.equal(leakedScope._tag, 'Ok');
  if (leakedScope._tag === 'Ok') {
    assert.equal(leakedScope.value.status, 'BLOCKED');
    assert.ok(leakedScope.value.failures.includes('runtime_config_not_accepted'));
  }

  const providerMismatch = evaluateCodeReleasePreflight({
    ...input,
    runtimeConfig: {
      ...runtimeConfig(),
      codeRetrieval: { ...runtimeConfig().codeRetrieval, embeddingProvider: 'sentence-transformers/pytorch' },
      verdict: { ...runtimeConfig().verdict, embeddingProvider: 'sentence-transformers/pytorch' },
    },
  });
  assert.equal(providerMismatch._tag, 'Ok');
  if (providerMismatch._tag === 'Ok') {
    assert.equal(providerMismatch.value.status, 'BLOCKED');
    assert.ok(providerMismatch.value.failures.includes('runtime_embedding_provider_mismatch'));
  }
});

test('code-only release also hashes binary DBC artifacts without JSON parsing', async () => {
  const root = await mkdtemp(join(process.cwd(), '.tmp-code-release-preflight-'));
  try {
    const binaryPath = join(root, 'dbc-evidence.bin');
    const binary = Buffer.from([9, 8, 7, 0, 255]);
    await writeFile(binaryPath, binary);
    const emptyPath = join(root, 'empty.json');
    await writeFile(emptyPath, '{}\n', 'utf8');
    const current = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const policyPath = join(root, 'policy.json');
    const outputPath = join(root, 'output.json');
    await writeFile(policyPath, JSON.stringify({
      schemaVersion: 1,
      scope: 'code-only',
      deployment: 'host',
      ownerApproval: { status: 'pending', releaseCommit: current, reference: 'test-only', approvedCapabilities: [] },
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
        artifacts: [{ path: binaryPath, sha256: createHash('sha256').update(binary).digest('hex'), kind: 'binary' }],
        observed: ['binary retained'],
      }],
    }, null, 2), 'utf8');
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/code-release-preflight.ts', policyPath, outputPath], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
    const output = JSON.parse(await (await import('node:fs/promises')).readFile(outputPath, 'utf8')) as { verdict?: { status?: string } };
    assert.equal(output.verdict?.status, 'BLOCKED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
