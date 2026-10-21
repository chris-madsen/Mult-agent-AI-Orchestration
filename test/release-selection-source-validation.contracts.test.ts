import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  evaluateEmbeddingSelection,
  type EmbeddingComparisonReport,
  type EmbeddingSelectionPolicy,
} from '../src/domain/embedding-selection.js';
import {
  evaluateSemanticProviderSelection,
  type SemanticProviderReport,
  type SemanticSelectionPolicy,
} from '../src/domain/semantic-provider-selection.js';
import { validateReleaseSelectionSources, type RetainedJsonEvidence } from '../scripts/release-selection-source-validation.js';

const digest = 'a'.repeat(64);
const revision = 'b'.repeat(40);

const retained = (path: string, value: unknown): RetainedJsonEvidence => {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  return {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    value,
  };
};

const embeddingReport: EmbeddingComparisonReport = {
  status: 'comparison-complete',
  evidence_stage: 'frozen_holdout',
  production_approved: false,
  dataset: 'holdout-v1',
  dataset_sha256: digest,
  candidates: ['fastembed/onnx', 'alternate/provider'].map((provider) => ({
    provider,
    model: 'model-v1',
    revision,
    status: 'success' as const,
    dimensions: 3,
    dataset_sha256: digest,
    preprocessing: 'lowercase-utf8',
    recall_at_1: 1,
    recall_at_3: 1,
    recall_at_5: 1,
    mrr: 1,
    ndcg_at_5: 1,
    query_ms_p95: 1,
    model_load_ms: 1,
    max_rss_bytes: 1,
    artifact: { revision, tree_sha256: digest },
    runtime: { node: 'test' },
  })),
};

const embeddingPolicy: EmbeddingSelectionPolicy = {
  selectedProvider: 'fastembed/onnx',
  requiredDatasetSha256: digest,
  thresholds: {
    minRecallAt1: 0,
    minRecallAt3: 0,
    minRecallAt5: 0,
    minMrr: 0,
    minNdcgAt5: 0,
  },
  licenses: {
    'fastembed/onnx': { spdxId: 'Apache-2.0', evidence: 'test', verified: true },
  },
  ownerApproval: { status: 'approved', provider: 'fastembed/onnx' },
};

const semanticReports: readonly SemanticProviderReport[] = [
  'typescript-language-service',
  'serena',
].map((provider) => ({
  provider,
  providerVersion: 'test-v1',
  fixtureSha256: digest,
  oracleSha256: digest,
  caseResults: [{ caseId: 'same-name', status: 'pass' }],
  coldStartMs: 1,
  warmQueryP95Ms: 1,
  maxRssBytes: 1,
  runtime: { node: 'test' },
}));

const semanticPolicy: SemanticSelectionPolicy = {
  selectedProvider: 'typescript-language-service',
  requiredFixtureSha256: digest,
  requiredOracleSha256: digest,
  requiredCaseIds: ['same-name'],
  licenses: {
    'typescript-language-service': { spdxId: 'Apache-2.0', evidence: 'test', verified: true },
  },
  ownerApproval: { status: 'approved', provider: 'typescript-language-service' },
};

test('release source validation re-evaluates selection verdicts against retained bytes', async () => {
  const embeddingVerdict = evaluateEmbeddingSelection(embeddingReport, embeddingPolicy);
  const semanticVerdict = evaluateSemanticProviderSelection(semanticReports, semanticPolicy);
  assert.equal(embeddingVerdict._tag, 'Ok');
  assert.equal(semanticVerdict._tag, 'Ok');
  if (embeddingVerdict._tag === 'Err' || semanticVerdict._tag === 'Err') return;

  const files = new Map<string, RetainedJsonEvidence>([
    ['embedding-report.json', retained('embedding-report.json', embeddingReport)],
    ['embedding-policy.json', retained('embedding-policy.json', embeddingPolicy)],
    ['semantic-policy.json', retained('semantic-policy.json', semanticPolicy)],
    ...semanticReports.map((report, index) => {
      const path = `semantic-report-${index}.json`;
      return [path, retained(path, report)] as const;
    }),
  ]);
  const embeddingSelection = {
    reportPath: 'embedding-report.json',
    policyPath: 'embedding-policy.json',
    reportSha256: files.get('embedding-report.json')!.sha256,
    policySha256: files.get('embedding-policy.json')!.sha256,
    verdict: embeddingVerdict.value,
  };
  const semanticSelection = {
    policyPath: 'semantic-policy.json',
    policySha256: files.get('semantic-policy.json')!.sha256,
    reports: semanticReports.map((_, index) => {
      const path = `semantic-report-${index}.json`;
      return { path, sha256: files.get(path)!.sha256 };
    }),
    verdict: semanticVerdict.value,
  };
  const readJson = async (path: string): Promise<RetainedJsonEvidence> => {
    const evidence = files.get(path);
    if (evidence === undefined) throw new Error(`missing test evidence: ${path}`);
    return evidence;
  };

  const validated = await validateReleaseSelectionSources(embeddingSelection, semanticSelection, readJson);
  assert.equal(validated.embedding?.report.sha256, embeddingSelection.reportSha256);
  assert.equal(validated.semantic?.reports.length, 2);

  await assert.rejects(
    validateReleaseSelectionSources(
      embeddingSelection,
      { ...semanticSelection, verdict: { ...semanticSelection.verdict, selectedProvider: 'forged/provider' } },
      readJson,
    ),
    /does not match retained source reports/u,
  );
});
