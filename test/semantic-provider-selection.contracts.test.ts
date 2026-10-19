import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  evaluateSemanticProviderSelection,
  type SemanticProviderReport,
  type SemanticSelectionPolicy,
} from '../src/domain/semantic-provider-selection.js';
import {
  evaluateSemanticProviderOracle,
  type SemanticProviderOracle,
} from '../src/adapters/semantic-provider-evaluator.js';
import { makeTypeScriptLanguageServicePort } from '../src/adapters/typescript-language-service.js';

const fixtureSha = 'a'.repeat(64);
const oracleSha = 'b'.repeat(64);
const caseIds = ['same-name', 'unicode', 'alias', 'broken'];

const report = (provider: string): SemanticProviderReport => ({
  provider,
  providerVersion: provider + '/1.0',
  fixtureSha256: fixtureSha,
  oracleSha256: oracleSha,
  caseResults: caseIds.map((caseId) => ({ caseId, status: 'pass' })),
  coldStartMs: 100,
  warmQueryP95Ms: 10,
  maxRssBytes: 100_000_000,
  runtime: { runtime: provider + '-runtime/1' },
});

const policy: SemanticSelectionPolicy = {
  selectedProvider: 'typescript-language-service',
  requiredFixtureSha256: fixtureSha,
  requiredOracleSha256: oracleSha,
  requiredCaseIds: caseIds,
  maxColdStartMs: 1000,
  maxWarmQueryP95Ms: 100,
  maxRssBytes: 500_000_000,
  licenses: {
    'typescript-language-service': {
      spdxId: 'Apache-2.0',
      evidence: 'fixture license evidence',
      verified: true,
    },
  },
  ownerApproval: { status: 'pending' },
};

test('semantic provider selection requires a matched comparison before approval', () => {
  const result = evaluateSemanticProviderSelection([
    report('typescript-language-service'),
    report('serena'),
  ], policy);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.matchedComparison, true);
  assert.equal(result.value.measurementAccepted, true);
  assert.equal(result.value.productionApproved, false);
  assert.equal(result.value.status, 'MEASUREMENT_PASS_APPROVAL_PENDING');
  assert.ok(result.value.failures.includes('owner_approval_missing'));
});

test('owner approval promotes only the exact measured semantic provider', () => {
  const approved = evaluateSemanticProviderSelection([
    report('typescript-language-service'),
    report('serena'),
  ], {
    ...policy,
    ownerApproval: { status: 'approved', provider: 'typescript-language-service' },
  });
  assert.equal(approved._tag, 'Ok');
  if (approved._tag === 'Ok') {
    assert.equal(approved.value.status, 'PRODUCTION_APPROVED');
    assert.equal(approved.value.productionApproved, true);
  }

  const wrong = evaluateSemanticProviderSelection([
    report('typescript-language-service'),
    report('serena'),
  ], {
    ...policy,
    ownerApproval: { status: 'approved', provider: 'serena' },
  });
  assert.equal(wrong._tag, 'Ok');
  if (wrong._tag === 'Ok') assert.equal(wrong.value.productionApproved, false);
});

test('different fixture, missing oracle case, failed case, or missing license blocks semantic selection', () => {
  const mismatched = evaluateSemanticProviderSelection([
    report('typescript-language-service'),
    { ...report('serena'), fixtureSha256: 'c'.repeat(64) },
  ], policy);
  assert.equal(mismatched._tag, 'Ok');
  if (mismatched._tag === 'Ok') assert.equal(mismatched.value.status, 'COMPARISON_INVALID');

  const missingCase = evaluateSemanticProviderSelection([
    report('typescript-language-service'),
    { ...report('serena'), caseResults: report('serena').caseResults.slice(0, -1) },
  ], policy);
  assert.equal(missingCase._tag, 'Ok');
  if (missingCase._tag === 'Ok') assert.equal(missingCase.value.matchedComparison, false);

  const selectedFailed = report('typescript-language-service');
  const failedCase = evaluateSemanticProviderSelection([
    { ...selectedFailed, caseResults: selectedFailed.caseResults.map((item) =>
      item.caseId === 'alias' ? { ...item, status: 'fail' as const } : item) },
    report('serena'),
  ], policy);
  assert.equal(failedCase._tag, 'Ok');
  if (failedCase._tag === 'Ok') {
    assert.equal(failedCase.value.measurementAccepted, false);
    assert.ok(failedCase.value.failures.includes('case_failed:alias'));
  }

  const noLicense = evaluateSemanticProviderSelection([
    report('typescript-language-service'),
    report('serena'),
  ], { ...policy, licenses: {} });
  assert.equal(noLicense._tag, 'Ok');
  if (noLicense._tag === 'Ok') assert.ok(noLicense.value.failures.includes('license_not_verified'));
});

test('direct TypeScript LS satisfies the shared frozen semantic oracle', async () => {
  const root = resolve('benchmarks/semantic/provider-comparison-v1');
  const names = [
    'repositories.ts',
    'services.ts',
    'unicode.ts',
    'alias-source.ts',
    'alias-use.ts',
    'writes.ts',
    'broken.ts',
    'large.ts',
  ];
  const files: Record<string, string> = {};
  for (const name of names) files['src/' + name] = await readFile(join(root, 'src', name), 'utf8');
  const oracle = JSON.parse(await readFile(join(root, 'oracle.json'), 'utf8')) as SemanticProviderOracle;
  const provider = makeTypeScriptLanguageServicePort({ rootPath: root, files });
  const evaluated = await evaluateSemanticProviderOracle(provider, files, oracle);
  assert.equal(evaluated._tag, 'Ok');
  if (evaluated._tag === 'Err') throw new Error(evaluated.error.message);
  const failures = evaluated.value.caseResults.filter((item) => item.status !== 'pass');
  assert.deepEqual(failures, []);
  assert.equal(evaluated.value.caseResults.length, oracle.cases.length);
  assert.ok((files['src/large.ts']?.split('\n').length ?? 0) > 2_000);
});
