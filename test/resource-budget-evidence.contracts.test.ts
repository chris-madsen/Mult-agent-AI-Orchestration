import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateResourceBudgetEvidence,
  type ResourceBudgetEvidenceInput,
} from '../src/domain/resource-budget-evidence.js';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);

const fixture = (scope: 'code-only' | 'full-unified'): ResourceBudgetEvidenceInput => {
  const metricNames = scope === 'code-only'
    ? [
      ['process_peak_rss_bytes', 'bytes'],
      ['startup_ready_ms', 'ms'],
      ['cold_index_ms', 'ms'],
      ['code_query_p95_ms', 'ms'],
    ] as const
    : [
      ['process_peak_rss_bytes', 'bytes'],
      ['startup_ready_ms', 'ms'],
      ['cold_index_ms', 'ms'],
      ['code_query_p95_ms', 'ms'],
      ['documentation_query_p95_ms', 'ms'],
      ['memory_query_p95_ms', 'ms'],
    ] as const;
  return {
    schemaVersion: 1,
    scope,
    sourceCommit: commit,
    generatedAt: '2026-10-20T00:00:00.000Z',
    budgetPolicy: {
      reference: 'owner-approved-resource-budget-v1',
      sha256: digest,
      metrics: metricNames.map(([metric, unit]) => ({
        metric,
        unit,
        maximum: unit === 'bytes' ? 2_000_000_000 : 5_000,
        minimumSamples: 3,
      })),
    },
    measurementEnvironment: {
      runtime: 'node/22|ace/0.1.0',
      deployment: scope === 'code-only' ? 'host' : 'k3s',
      hostClass: 'x86_64-8cpu-16gb',
    },
    observed: metricNames.map(([metric, unit]) => ({
      metric,
      unit,
      observed: unit === 'bytes' ? 900_000_000 : 1_000,
      sampleCount: 5,
      method: 'retained-release-measurement',
    })),
  };
};

test('code-only resource budget passes only the required code metric set on the exact commit', () => {
  const result = evaluateResourceBudgetEvidence(fixture('code-only'), commit);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.evidence, 'resource-budget-accepted');
  assert.equal(result.value.allWithinBudget, true);
  assert.deepEqual(result.value.failures, []);
});

test('full-unified resource budget additionally requires documentation and memory p95 measurements', () => {
  const input = fixture('full-unified');
  const result = evaluateResourceBudgetEvidence({
    ...input,
    observed: input.observed.filter((item) => item.metric !== 'memory_query_p95_ms'),
  }, commit);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.evidence, 'resource-budget-exceeded');
  assert.ok(result.value.failures.includes('measurement_missing:memory_query_p95_ms'));
});

test('owner-defined maximums and minimum sample counts are enforced without built-in arbitrary limits', () => {
  const input = fixture('code-only');
  const result = evaluateResourceBudgetEvidence({
    ...input,
    observed: input.observed.map((item) => item.metric === 'code_query_p95_ms'
      ? { ...item, observed: 5_001, sampleCount: 2 }
      : item),
  }, commit);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.allWithinBudget, false);
  assert.ok(result.value.failures.includes('budget_exceeded:code_query_p95_ms'));
  assert.ok(result.value.failures.includes('sample_count_below_policy:code_query_p95_ms'));
});

test('cross-commit resource evidence cannot be promoted into a release', () => {
  const result = evaluateResourceBudgetEvidence(fixture('code-only'), 'c'.repeat(40));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.allWithinBudget, false);
  assert.deepEqual(result.value.failures, ['source_commit_mismatch']);
});

test('duplicate metrics, wrong units and unsafe policy metadata fail closed', () => {
  const input = fixture('code-only');
  const duplicate = evaluateResourceBudgetEvidence({
    ...input,
    budgetPolicy: {
      ...input.budgetPolicy,
      metrics: [...input.budgetPolicy.metrics, input.budgetPolicy.metrics[0]!],
    },
  }, commit);
  assert.equal(duplicate._tag, 'Err');

  const wrongUnit = evaluateResourceBudgetEvidence({
    ...input,
    observed: input.observed.map((item) => item.metric === 'process_peak_rss_bytes'
      ? { ...item, unit: 'ms' as const }
      : item),
  }, commit);
  assert.equal(wrongUnit._tag, 'Err');

  const unsafe = evaluateResourceBudgetEvidence({
    ...input,
    budgetPolicy: { ...input.budgetPolicy, reference: 'password=secret' },
  }, commit);
  assert.equal(unsafe._tag, 'Err');
});
