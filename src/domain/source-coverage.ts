import type { RouteSource } from './routing.js';

export type ContextSource = 'code' | 'structural' | 'documentation' | 'memory';
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

export type SourceRequirements = Readonly<Record<ContextSource, SourceRequest>>;

export interface SourceRequestOverrides {
  readonly includeCode?: boolean;
  readonly includeDocs?: boolean;
  readonly includeMemory?: boolean;
}

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
  return {
    code,
    structural,
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
  documentation: { requirement: input.includeDocs ? 'required' : 'not_requested', allowed: true },
  memory: { requirement: input.includeMemory ? 'required' : 'not_requested', allowed: true },
});
