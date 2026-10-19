import type { RouteSource } from './routing.js';

export type ContextSource = 'code' | 'structural' | 'documentation' | 'memory';
export type SourceRequirement = 'required' | 'optional' | 'not_requested' | 'denied';
export type SourceCoverageStatus = 'satisfied' | 'partial' | 'empty' | 'unavailable' | 'denied' | 'not_requested';

export interface SourceCoverage {
  readonly source: ContextSource;
  readonly requirement: SourceRequirement;
  readonly status: SourceCoverageStatus;
  readonly reason?: string;
}

export type SourceRequirements = Readonly<Record<ContextSource, SourceRequirement>>;

export interface SourceRequestOverrides {
  readonly includeCode?: boolean;
  readonly includeDocs?: boolean;
  readonly includeMemory?: boolean;
}

const requirementFor = (selected: boolean, explicit: boolean | undefined): SourceRequirement => {
  if (explicit === false) return 'denied';
  if (explicit === true) return selected ? 'required' : 'optional';
  return selected ? 'required' : 'not_requested';
};

export const resolveSourceRequirements = (
  routeSources: readonly RouteSource[],
  overrides: SourceRequestOverrides = {},
): SourceRequirements => {
  const routeCode = routeSources.includes('code');
  const routeStructural = routeSources.includes('structural');
  const code = requirementFor(routeCode || routeStructural, overrides.includeCode);
  const structural: SourceRequirement = overrides.includeCode === false
    ? 'denied'
    : routeStructural
      ? 'required'
      : code === 'required' || code === 'optional'
        ? 'optional'
        : 'not_requested';
  return {
    code,
    structural,
    documentation: requirementFor(routeSources.includes('documentation'), overrides.includeDocs),
    memory: requirementFor(routeSources.includes('memory'), overrides.includeMemory),
  };
};

export const sourceIsRequested = (requirement: SourceRequirement): boolean =>
  requirement === 'required' || requirement === 'optional';

export const initialSourceCoverage = (requirements: SourceRequirements): readonly SourceCoverage[] =>
  (Object.entries(requirements) as Array<[ContextSource, SourceRequirement]>).map(([source, requirement]) => ({
    source,
    requirement,
    status: requirement === 'not_requested'
      ? 'not_requested'
      : requirement === 'denied'
        ? 'denied'
        : 'unavailable',
    ...(requirement === 'denied' ? { reason: 'caller_disabled' } : {}),
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
  code: input.includeCode ? 'required' : 'not_requested',
  structural: input.includeCode ? 'optional' : 'not_requested',
  documentation: input.includeDocs ? 'required' : 'not_requested',
  memory: input.includeMemory ? 'required' : 'not_requested',
});
