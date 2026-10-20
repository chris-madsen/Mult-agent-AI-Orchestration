import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { ContextSource, SourceCoverage } from './source-coverage.js';
import type { ProviderTraceEvent, ProviderTraceName } from './provider-trace.js';

export interface ProviderTraceBranchReceipt {
  readonly source: ContextSource;
  readonly coverageStatus: SourceCoverage['status'];
  readonly requiredProviders: readonly ProviderTraceName[];
  readonly observedProviders: readonly ProviderTraceName[];
  readonly missingProviders: readonly ProviderTraceName[];
  readonly failedProviders: readonly ProviderTraceName[];
  readonly complete: boolean;
}

export interface ProviderTraceReceipt {
  readonly receipt: 'provider-trace-complete' | 'provider-trace-incomplete';
  readonly requestId: string;
  readonly correlatedEventCount: number;
  readonly requiredSources: readonly ContextSource[];
  readonly branches: readonly ProviderTraceBranchReceipt[];
  readonly failures: readonly string[];
  readonly note: string;
}

const providerNames: readonly ProviderTraceName[] = [
  'embedding',
  'qdrant',
  'tree_sitter',
  'typescript_language_service',
  'vertex_rag',
  'graphiti',
  'source_verification',
];

const providerName = (value: unknown): value is ProviderTraceName =>
  typeof value === 'string' && providerNames.includes(value as ProviderTraceName);

const safeMetadata = (value: string): boolean =>
  value.trim().length > 0
  && !/(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|private[_-]?key)\s*[:=]\s*\S+/iu.test(value)
  && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value);

const allowedKeys = new Set([
  'timestampMs',
  'provider',
  'providerVersion',
  'operation',
  'status',
  'durationMs',
  'requestId',
  'collection',
  'generation',
  'vectorDimension',
  'errorCode',
]);

export const validateSafeProviderTraceEvent = (
  raw: unknown,
): Result<ProviderTraceEvent, DomainError> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err(domainError('INVALID_BENCHMARK', 'provider_trace', 'provider trace event must be an object'));
  }
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return err(domainError(
      'INVALID_BENCHMARK',
      'provider_trace',
      'provider trace contains an unexpected field; raw query/source/token metadata is forbidden',
    ));
  }
  if (!Number.isSafeInteger(value.timestampMs) || (value.timestampMs as number) < 0
    || !providerName(value.provider)
    || typeof value.providerVersion !== 'string' || !safeMetadata(value.providerVersion)
    || typeof value.operation !== 'string' || !safeMetadata(value.operation)
    || (value.status !== 'success' && value.status !== 'failure')
    || typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0
    || (value.requestId !== undefined && (typeof value.requestId !== 'string' || !safeMetadata(value.requestId)))
    || (value.collection !== undefined && (typeof value.collection !== 'string' || !safeMetadata(value.collection)))
    || (value.generation !== undefined && (!Number.isSafeInteger(value.generation) || (value.generation as number) < 0))
    || (value.vectorDimension !== undefined && (!Number.isSafeInteger(value.vectorDimension) || (value.vectorDimension as number) < 1))
    || (value.errorCode !== undefined && (typeof value.errorCode !== 'string' || !safeMetadata(value.errorCode)))) {
    return err(domainError('INVALID_BENCHMARK', 'provider_trace', 'provider trace safe metadata is invalid'));
  }
  return ok(value as unknown as ProviderTraceEvent);
};

const queryProvidersFor = (source: ContextSource): readonly ProviderTraceName[] => {
  switch (source) {
    case 'code':
      return ['embedding', 'qdrant', 'source_verification'];
    case 'structural':
      return ['typescript_language_service'];
    case 'documentation':
      return ['vertex_rag'];
    case 'memory':
      return ['graphiti'];
  }
};

export const evaluateProviderTraceReceipt = (
  requestId: string,
  sourceCoverage: readonly SourceCoverage[],
  rawEvents: readonly unknown[],
): Result<ProviderTraceReceipt, DomainError> => {
  if (!safeMetadata(requestId)) {
    return err(domainError('INVALID_BENCHMARK', 'request_id', 'provider trace receipt requires a safe request id'));
  }
  const sources = sourceCoverage.map((entry) => entry.source);
  if (sources.length !== new Set(sources).size) {
    return err(domainError('INVALID_BENCHMARK', 'source_coverage', 'source coverage contains duplicate sources'));
  }
  const required = sourceCoverage.filter((entry) => entry.requirement === 'required');
  if (required.length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'source_coverage', 'provider trace receipt requires at least one required source'));
  }

  const events: ProviderTraceEvent[] = [];
  for (const raw of rawEvents) {
    const checked = validateSafeProviderTraceEvent(raw);
    if (checked._tag === 'Err') return checked;
    if (checked.value.requestId === requestId) events.push(checked.value);
  }

  const branches: ProviderTraceBranchReceipt[] = required.map((coverage) => {
    const requiredProviders = queryProvidersFor(coverage.source);
    const matching = events.filter((event) => requiredProviders.includes(event.provider));
    const observedProviders = [...new Set(matching.map((event) => event.provider))]
      .sort() as ProviderTraceName[];
    const missingProviders = requiredProviders.filter((provider) =>
      !matching.some((event) => event.provider === provider));
    const failedProviders = requiredProviders.filter((provider) =>
      matching.some((event) => event.provider === provider && event.status === 'failure'));
    const complete = coverage.status === 'satisfied'
      && missingProviders.length === 0
      && failedProviders.length === 0;
    return {
      source: coverage.source,
      coverageStatus: coverage.status,
      requiredProviders,
      observedProviders,
      missingProviders,
      failedProviders,
      complete,
    };
  });

  const failures: string[] = [];
  for (const branch of branches) {
    if (branch.coverageStatus !== 'satisfied') failures.push(`coverage_not_satisfied:${branch.source}:${branch.coverageStatus}`);
    for (const provider of branch.missingProviders) failures.push(`missing_trace:${branch.source}:${provider}`);
    for (const provider of branch.failedProviders) failures.push(`failed_trace:${branch.source}:${provider}`);
  }

  return ok({
    receipt: failures.length === 0 ? 'provider-trace-complete' : 'provider-trace-incomplete',
    requestId,
    correlatedEventCount: events.length,
    requiredSources: required.map((entry) => entry.source),
    branches,
    failures: [...new Set(failures)],
    note: 'Tree-sitter is startup/index evidence, not query-time request-correlated evidence; DBC-01 must retain its startup provider proof separately.',
  });
};
