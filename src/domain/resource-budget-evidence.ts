import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type ResourceBudgetScope = 'code-only' | 'full-unified';

export type ResourceMetricName =
  | 'process_peak_rss_bytes'
  | 'startup_ready_ms'
  | 'cold_index_ms'
  | 'code_query_p95_ms'
  | 'documentation_query_p95_ms'
  | 'memory_query_p95_ms';

export type ResourceMetricUnit = 'bytes' | 'ms';

export interface ResourceBudgetMetric {
  readonly metric: ResourceMetricName;
  readonly unit: ResourceMetricUnit;
  readonly maximum: number;
  readonly minimumSamples: number;
}

export interface ResourceObservedMetric {
  readonly metric: ResourceMetricName;
  readonly unit: ResourceMetricUnit;
  readonly observed: number;
  readonly sampleCount: number;
  readonly method: string;
}

export interface ResourceBudgetEvidenceInput {
  readonly schemaVersion: 1;
  readonly scope: ResourceBudgetScope;
  readonly sourceCommit: string;
  readonly generatedAt: string;
  readonly budgetPolicy: {
    readonly reference: string;
    readonly sha256: string;
    readonly metrics: readonly ResourceBudgetMetric[];
  };
  readonly measurementEnvironment: {
    readonly runtime: string;
    readonly deployment: string;
    readonly hostClass: string;
  };
  readonly observed: readonly ResourceObservedMetric[];
}

export interface ResourceBudgetEvidenceVerdict {
  readonly evidence: 'resource-budget-accepted' | 'resource-budget-exceeded';
  readonly scope: ResourceBudgetScope;
  readonly sourceCommit: string;
  readonly allWithinBudget: boolean;
  readonly failures: readonly string[];
}

const requiredByScope: Readonly<Record<ResourceBudgetScope, readonly ResourceMetricName[]>> = {
  'code-only': [
    'process_peak_rss_bytes',
    'startup_ready_ms',
    'cold_index_ms',
    'code_query_p95_ms',
  ],
  'full-unified': [
    'process_peak_rss_bytes',
    'startup_ready_ms',
    'cold_index_ms',
    'code_query_p95_ms',
    'documentation_query_p95_ms',
    'memory_query_p95_ms',
  ],
};

const expectedUnit: Readonly<Record<ResourceMetricName, ResourceMetricUnit>> = {
  process_peak_rss_bytes: 'bytes',
  startup_ready_ms: 'ms',
  cold_index_ms: 'ms',
  code_query_p95_ms: 'ms',
  documentation_query_p95_ms: 'ms',
  memory_query_p95_ms: 'ms',
};

const commitSha = (value: string): boolean => /^[a-f0-9]{40,64}$/u.test(value);
const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const nonEmpty = (value: string): boolean => value.trim().length > 0;
const safeText = (value: string): boolean =>
  nonEmpty(value)
  && !/(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|private[_-]?key)\s*[:=]\s*\S+/iu.test(value)
  && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value);

const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const positiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

export const evaluateResourceBudgetEvidence = (
  input: ResourceBudgetEvidenceInput,
  currentCommit: string,
): Result<ResourceBudgetEvidenceVerdict, DomainError> => {
  if (input.schemaVersion !== 1
    || !commitSha(input.sourceCommit)
    || !commitSha(currentCommit)
    || Number.isNaN(Date.parse(input.generatedAt))) {
    return err(domainError('INVALID_BENCHMARK', 'resource_budget', 'resource budget evidence identity/timestamp is invalid'));
  }
  if (input.sourceCommit !== currentCommit) {
    return ok({
      evidence: 'resource-budget-exceeded',
      scope: input.scope,
      sourceCommit: input.sourceCommit,
      allWithinBudget: false,
      failures: ['source_commit_mismatch'],
    });
  }
  if (input.scope !== 'code-only' && input.scope !== 'full-unified') {
    return err(domainError('INVALID_BENCHMARK', 'resource_budget.scope', 'resource budget scope is invalid'));
  }
  if (!safeText(input.budgetPolicy.reference) || !sha256(input.budgetPolicy.sha256)) {
    return err(domainError('INVALID_BENCHMARK', 'resource_budget.policy', 'budget policy reference/digest is invalid'));
  }
  if (![input.measurementEnvironment.runtime, input.measurementEnvironment.deployment, input.measurementEnvironment.hostClass]
    .every(safeText)) {
    return err(domainError('INVALID_BENCHMARK', 'resource_budget.environment', 'measurement environment metadata is incomplete or unsafe'));
  }

  const required = requiredByScope[input.scope];
  const budgetByMetric = new Map<ResourceMetricName, ResourceBudgetMetric>();
  for (const budget of input.budgetPolicy.metrics) {
    if (budgetByMetric.has(budget.metric)) {
      return err(domainError('INVALID_BENCHMARK', 'resource_budget.policy.metrics', `duplicate budget metric: ${budget.metric}`));
    }
    if (expectedUnit[budget.metric] === undefined
      || budget.unit !== expectedUnit[budget.metric]
      || !finitePositive(budget.maximum)
      || !positiveInteger(budget.minimumSamples)) {
      return err(domainError('INVALID_BENCHMARK', 'resource_budget.policy.metrics', `invalid budget metric: ${String(budget.metric)}`));
    }
    budgetByMetric.set(budget.metric, budget);
  }
  for (const metric of required) {
    if (!budgetByMetric.has(metric)) {
      return err(domainError('INVALID_BENCHMARK', 'resource_budget.policy.metrics', `required budget metric is missing: ${metric}`));
    }
  }

  const observedByMetric = new Map<ResourceMetricName, ResourceObservedMetric>();
  for (const item of input.observed) {
    if (observedByMetric.has(item.metric)) {
      return err(domainError('INVALID_BENCHMARK', 'resource_budget.observed', `duplicate observed metric: ${item.metric}`));
    }
    if (expectedUnit[item.metric] === undefined
      || item.unit !== expectedUnit[item.metric]
      || !Number.isFinite(item.observed)
      || item.observed < 0
      || !positiveInteger(item.sampleCount)
      || !safeText(item.method)) {
      return err(domainError('INVALID_BENCHMARK', 'resource_budget.observed', `invalid observed metric: ${String(item.metric)}`));
    }
    observedByMetric.set(item.metric, item);
  }

  const failures: string[] = [];
  for (const metric of required) {
    const budget = budgetByMetric.get(metric);
    const observed = observedByMetric.get(metric);
    if (budget === undefined) {
      failures.push(`budget_missing:${metric}`);
      continue;
    }
    if (observed === undefined) {
      failures.push(`measurement_missing:${metric}`);
      continue;
    }
    if (observed.sampleCount < budget.minimumSamples) {
      failures.push(`sample_count_below_policy:${metric}`);
    }
    if (observed.observed > budget.maximum) {
      failures.push(`budget_exceeded:${metric}`);
    }
  }

  return ok({
    evidence: failures.length === 0 ? 'resource-budget-accepted' : 'resource-budget-exceeded',
    scope: input.scope,
    sourceCommit: input.sourceCommit,
    allWithinBudget: failures.length === 0,
    failures,
  });
};
