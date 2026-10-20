import type { RouteSource } from './routing.js';
import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type ContextSource = 'code' | 'structural' | 'lsp' | 'documentation' | 'memory';
export type SourceRequirement = 'required' | 'optional' | 'not_requested';
export type SourceCoverageStatus = 'satisfied' | 'partial' | 'empty' | 'unavailable' | 'denied' | 'not_requested';

export interface SourceRequest {
  readonly requirement: SourceRequirement;
  readonly allowed: boolean;
}

export interface SourceCoverage {
  readonly source: ContextSource;
  readonly requirement: SourceRequirement;
  readonly status: SourceCoverageStatus;
  readonly reason?: string;
}

export interface SourceRequirements {
  readonly code: SourceRequest;
  readonly structural: SourceRequest;
  /** Optional for backward compatibility with pre-LSP callers. */
  readonly lsp?: SourceRequest;
  readonly documentation: SourceRequest;
  readonly memory: SourceRequest;
}

/**
 * An explicit source plan supplied by the caller.  This is deliberately a
 * small ADT rather than a second routing language: routing may recommend a
 * plan, but a caller supplied plan is authoritative.
 */
export interface SourceObligations {
  readonly required?: readonly ContextSource[];
  readonly optional?: readonly ContextSource[];
}

export interface SourceRequestOverrides {
  readonly includeCode?: boolean;
  readonly includeDocs?: boolean;
  readonly includeMemory?: boolean;
}

const sourceNames: readonly ContextSource[] = ['code', 'structural', 'lsp', 'documentation', 'memory'];

const sourceOverride = (source: ContextSource, overrides: SourceRequestOverrides): boolean => {
  if (source === 'code' || source === 'structural' || source === 'lsp') return overrides.includeCode !== false;
  if (source === 'documentation') return overrides.includeDocs !== false;
  return overrides.includeMemory !== false;
};

const invalidObligations = (message: string): Result<never, DomainError> =>
  err(domainError('INVALID_INPUT', 'source_obligations', message));

/**
 * Resolve a caller-owned plan without consulting deterministic routing.
 * Unknown/duplicate/overlapping entries are rejected instead of silently
 * changing the requested completeness contract.
 */
export const resolveExplicitSourceRequirements = (
  obligations: SourceObligations,
  overrides: SourceRequestOverrides = {},
): Result<SourceRequirements, DomainError> => {
  const required = obligations.required ?? [];
  const optional = obligations.optional ?? [];
  const valid = new Set(sourceNames);
  const validateList = (values: readonly ContextSource[], label: string): Result<void, DomainError> => {
    if (new Set(values).size !== values.length) return invalidObligations(`${label} contains duplicate sources`);
    if (values.some((value) => !valid.has(value))) return invalidObligations(`${label} contains an unknown source`);
    return ok(undefined);
  };
  const requiredValid = validateList(required, 'required');
  if (requiredValid._tag === 'Err') return requiredValid;
  const optionalValid = validateList(optional, 'optional');
  if (optionalValid._tag === 'Err') return optionalValid;
  if (required.some((source) => optional.includes(source))) {
    return invalidObligations('required and optional source lists must not overlap');
  }
  const requiredSet = new Set(required);
  const optionalSet = new Set(optional);
  return ok(Object.fromEntries(sourceNames.map((source) => [source, {
    requirement: requiredSet.has(source)
      ? 'required'
      : optionalSet.has(source) ? 'optional' : 'not_requested',
    allowed: sourceOverride(source, overrides),
  }])) as unknown as SourceRequirements);
};

const requestFor = (selected: boolean, explicit: boolean | undefined): SourceRequest => ({
  requirement: selected ? 'required' : explicit === true ? 'optional' : 'not_requested',
  allowed: explicit !== false,
});

export const resolveSourceRequirements = (
  routeSources: readonly RouteSource[],
  overrides: SourceRequestOverrides = {},
): SourceRequirements => {
  const routeCode = routeSources.includes('code');
  const routeStructural = routeSources.includes('structural');
  const code = requestFor(routeCode || routeStructural, overrides.includeCode);
  const structuralSelected = routeStructural;
  const structuralRelevant = structuralSelected
    || code.requirement === 'required'
    || code.requirement === 'optional';
  const structural: SourceRequest = {
    requirement: structuralSelected ? 'required' : structuralRelevant ? 'optional' : 'not_requested',
    allowed: overrides.includeCode !== false,
  };
  const lsp: SourceRequest = {
    requirement: structuralRelevant ? 'optional' : 'not_requested',
    allowed: overrides.includeCode !== false,
  };
  return {
    code,
    structural,
    lsp,
    documentation: requestFor(routeSources.includes('documentation'), overrides.includeDocs),
    memory: requestFor(routeSources.includes('memory'), overrides.includeMemory),
  };
};

export const sourceIsRequested = (request: SourceRequest): boolean =>
  request.allowed && (request.requirement === 'required' || request.requirement === 'optional');

export const initialSourceCoverage = (requirements: SourceRequirements): readonly SourceCoverage[] =>
  (Object.entries(requirements) as Array<[ContextSource, SourceRequest]>).map(([source, request]) => ({
    source,
    requirement: request.requirement,
    status: !request.allowed
      ? 'denied'
      : request.requirement === 'not_requested'
        ? 'not_requested'
        : 'unavailable',
    ...(!request.allowed ? { reason: 'caller_disabled' } : {}),
  }));

export const setSourceCoverage = (
  coverage: readonly SourceCoverage[],
  source: ContextSource,
  status: SourceCoverageStatus,
  reason?: string,
): readonly SourceCoverage[] => coverage.map((entry) => entry.source === source
  ? {
    ...entry,
    status,
    ...(reason === undefined ? {} : { reason }),
  }
  : entry);

export const requiredIncompleteSources = (
  coverage: readonly SourceCoverage[],
): readonly ContextSource[] => coverage
  .filter((entry) => entry.requirement === 'required' && entry.status !== 'satisfied')
  .map((entry) => entry.source);

export const sourceCoverageComplete = (coverage: readonly SourceCoverage[]): boolean =>
  requiredIncompleteSources(coverage).length === 0;

export const legacySourceRequirements = (input: {
  readonly includeCode: boolean;
  readonly includeDocs: boolean;
  readonly includeMemory: boolean;
}): SourceRequirements => ({
  code: { requirement: input.includeCode ? 'required' : 'not_requested', allowed: true },
  structural: { requirement: input.includeCode ? 'optional' : 'not_requested', allowed: true },
  // Preserve the historical boolean contract: an include_code request was
  // complete only after semantic confirmation. Callers that want structural
  // without semantic confirmation must use explicit source obligations.
  lsp: { requirement: input.includeCode ? 'required' : 'not_requested', allowed: true },
  documentation: { requirement: input.includeDocs ? 'required' : 'not_requested', allowed: true },
  memory: { requirement: input.includeMemory ? 'required' : 'not_requested', allowed: true },
});
