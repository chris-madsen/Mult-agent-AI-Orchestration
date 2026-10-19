import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export interface SemanticExpectedLocation {
  readonly repoPath: string;
  readonly line: number;
  readonly column: number;
}

export interface SemanticProviderCase {
  readonly id: string;
  readonly namePath: string;
  readonly declarationFile: string;
  readonly declarationNeedle: string;
  readonly declarationSymbol: string;
  readonly queryFile: string;
  readonly queryNeedle: string;
  readonly querySymbol: string;
  readonly expectedReferences: readonly {
    readonly repoPath: string;
    readonly needle: string;
    readonly symbol: string;
  }[];
}

export interface SemanticProviderOracle {
  readonly schemaVersion: 1;
  readonly fixtureVersion: string;
  readonly cases: readonly SemanticProviderCase[];
  readonly diagnosticFiles: readonly string[];
}

export interface SemanticCaseObservation {
  readonly id: string;
  readonly definition?: SemanticExpectedLocation;
  readonly references: readonly SemanticExpectedLocation[];
  readonly durationMs: number;
  readonly error?: string;
}

export interface SemanticProviderObservation {
  readonly provider: string;
  readonly providerVersion: string;
  readonly fixtureDigest: string;
  readonly coldStartMs: number;
  readonly cases: readonly SemanticCaseObservation[];
  readonly diagnostics: Readonly<Record<string, number>>;
  readonly warmDurationMs: number;
  readonly residentMemoryBytes?: number;
  readonly notes: readonly string[];
}

export interface SemanticProviderEvaluation {
  readonly provider: string;
  readonly providerVersion: string;
  readonly fixtureDigest: string;
  readonly caseCount: number;
  readonly definitionMatches: number;
  readonly referenceSetMatches: number;
  readonly diagnosticFileMatches: number;
  readonly passedCases: readonly string[];
  readonly failedCases: readonly string[];
  readonly coldStartMs: number;
  readonly warmDurationMs: number;
  readonly residentMemoryBytes?: number;
}

const validLocation = (value: SemanticExpectedLocation): boolean =>
  value.repoPath.trim().length > 0
  && Number.isSafeInteger(value.line) && value.line >= 1
  && Number.isSafeInteger(value.column) && value.column >= 1;

const locationKey = (location: SemanticExpectedLocation): string =>
  `${location.repoPath}:${location.line}:${location.column}`;

export const validateSemanticProviderOracle = (
  oracle: SemanticProviderOracle,
): Result<SemanticProviderOracle, DomainError> => {
  if (oracle.schemaVersion !== 1 || oracle.fixtureVersion.trim().length === 0 || oracle.cases.length < 4) {
    return err(domainError('INVALID_BENCHMARK', 'semantic_oracle', 'semantic oracle requires schema v1, fixture version and at least four cases'));
  }
  const ids = new Set<string>();
  for (const [index, item] of oracle.cases.entries()) {
    if (item.id.trim().length === 0 || ids.has(item.id)
      || item.namePath.trim().length === 0
      || item.declarationFile.trim().length === 0
      || item.declarationNeedle.trim().length === 0
      || item.declarationSymbol.trim().length === 0
      || item.queryFile.trim().length === 0
      || item.queryNeedle.trim().length === 0
      || item.querySymbol.trim().length === 0
      || item.expectedReferences.length === 0) {
      return err(domainError('INVALID_BENCHMARK', `semantic_oracle.cases[${index}]`, 'semantic case is incomplete or duplicated'));
    }
    ids.add(item.id);
  }
  if (oracle.diagnosticFiles.length === 0 || new Set(oracle.diagnosticFiles).size !== oracle.diagnosticFiles.length) {
    return err(domainError('INVALID_BENCHMARK', 'semantic_oracle.diagnostic_files', 'diagnostic files must be non-empty and unique'));
  }
  return ok(oracle);
};

export const evaluateSemanticProvider = (
  oracle: SemanticProviderOracle,
  expected: ReadonlyMap<string, {
    readonly definition: SemanticExpectedLocation;
    readonly references: readonly SemanticExpectedLocation[];
  }>,
  observation: SemanticProviderObservation,
): Result<SemanticProviderEvaluation, DomainError> => {
  const valid = validateSemanticProviderOracle(oracle);
  if (valid._tag === 'Err') return valid;
  if (!/^[a-f0-9]{64}$/u.test(observation.fixtureDigest)
    || observation.provider.trim().length === 0
    || observation.providerVersion.trim().length === 0
    || observation.fixtureDigest.length !== 64
    || observation.cases.length !== oracle.cases.length
    || observation.coldStartMs < 0
    || observation.warmDurationMs < 0) {
    return err(domainError('INVALID_BENCHMARK', 'semantic_observation', 'semantic provider observation is incomplete'));
  }
  const byId = new Map(observation.cases.map((item) => [item.id, item]));
  if (byId.size !== oracle.cases.length) {
    return err(domainError('INVALID_BENCHMARK', 'semantic_observation.cases', 'semantic observations must contain each oracle case exactly once'));
  }

  let definitionMatches = 0;
  let referenceSetMatches = 0;
  const passedCases: string[] = [];
  const failedCases: string[] = [];
  for (const item of oracle.cases) {
    const wanted = expected.get(item.id);
    const observed = byId.get(item.id);
    if (wanted === undefined || observed === undefined || !validLocation(wanted.definition)
      || wanted.references.some((value) => !validLocation(value))) {
      return err(domainError('INVALID_BENCHMARK', item.id, 'semantic expected locations were not resolved from frozen fixture'));
    }
    const definitionMatch = observed.definition !== undefined
      && locationKey(observed.definition) === locationKey(wanted.definition);
    const expectedRefs = [...new Set(wanted.references.map(locationKey))].sort();
    const actualRefs = [...new Set(observed.references.map(locationKey))].sort();
    const referencesMatch = JSON.stringify(expectedRefs) === JSON.stringify(actualRefs);
    if (definitionMatch) definitionMatches += 1;
    if (referencesMatch) referenceSetMatches += 1;
    if (definitionMatch && referencesMatch && observed.error === undefined) passedCases.push(item.id);
    else failedCases.push(item.id);
  }

  let diagnosticFileMatches = 0;
  for (const file of oracle.diagnosticFiles) {
    if ((observation.diagnostics[file] ?? 0) > 0) diagnosticFileMatches += 1;
  }

  return ok({
    provider: observation.provider,
    providerVersion: observation.providerVersion,
    fixtureDigest: observation.fixtureDigest,
    caseCount: oracle.cases.length,
    definitionMatches,
    referenceSetMatches,
    diagnosticFileMatches,
    passedCases,
    failedCases,
    coldStartMs: observation.coldStartMs,
    warmDurationMs: observation.warmDurationMs,
    ...(observation.residentMemoryBytes === undefined ? {} : { residentMemoryBytes: observation.residentMemoryBytes }),
  });
};

export interface SemanticProviderComparison {
  readonly fixtureDigest: string;
  readonly direct: SemanticProviderEvaluation;
  readonly serena?: SemanticProviderEvaluation;
  readonly decision: 'not-comparable' | 'direct-better' | 'serena-better' | 'quality-tie-needs-owner-decision';
}

export const compareSemanticProviders = (
  direct: SemanticProviderEvaluation,
  serena?: SemanticProviderEvaluation,
): Result<SemanticProviderComparison, DomainError> => {
  if (serena === undefined) {
    return ok({ fixtureDigest: direct.fixtureDigest, direct, decision: 'not-comparable' });
  }
  if (direct.fixtureDigest !== serena.fixtureDigest || direct.caseCount !== serena.caseCount) {
    return err(domainError('INVALID_BENCHMARK', 'semantic_comparison', 'providers must run the identical frozen fixture and case count'));
  }
  const directQuality = direct.definitionMatches + direct.referenceSetMatches + direct.diagnosticFileMatches;
  const serenaQuality = serena.definitionMatches + serena.referenceSetMatches + serena.diagnosticFileMatches;
  const decision = directQuality > serenaQuality
    ? 'direct-better'
    : serenaQuality > directQuality
      ? 'serena-better'
      : 'quality-tie-needs-owner-decision';
  return ok({ fixtureDigest: direct.fixtureDigest, direct, serena, decision });
};
