import { performance } from 'node:perf_hooks';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { SemanticAnalysisPort } from '../application/ports.js';
import type { SemanticLocation } from '../domain/semantic.js';
import type { SemanticProviderCaseResult } from '../domain/semantic-provider-selection.js';

interface MarkerLocation {
  readonly file: string;
  readonly marker: string;
  readonly token: string;
  readonly markerOccurrence?: number;
  readonly tokenOccurrence?: number;
}

interface DefinitionOracleCase {
  readonly id: string;
  readonly operation: 'definition';
  readonly query: MarkerLocation;
  readonly expected: MarkerLocation;
}

interface ReferencesOracleCase {
  readonly id: string;
  readonly operation: 'references';
  readonly query: MarkerLocation;
  readonly expectedReferenceMarkers: readonly MarkerLocation[];
}

interface DiagnosticsOracleCase {
  readonly id: string;
  readonly operation: 'diagnostics';
  readonly query: { readonly file: string };
  readonly expected: { readonly minErrors: number };
}

export type SemanticOracleCase = DefinitionOracleCase | ReferencesOracleCase | DiagnosticsOracleCase;

export interface SemanticProviderOracle {
  readonly schemaVersion: 1;
  readonly status: string;
  readonly cases: readonly SemanticOracleCase[];
}

export interface SemanticEvaluationRun {
  readonly caseResults: readonly SemanticProviderCaseResult[];
  readonly queryDurationsMs: readonly number[];
}

const occurrenceOffset = (source: string, needle: string, occurrence: number): number => {
  let offset = -1;
  for (let index = 0; index < occurrence; index += 1) {
    offset = source.indexOf(needle, offset + 1);
    if (offset < 0) return -1;
  }
  return offset;
};

const markerPosition = (
  files: Readonly<Record<string, string>>,
  marker: MarkerLocation,
): Result<{ readonly line: number; readonly column: number }, DomainError> => {
  const source = files[marker.file];
  if (source === undefined) return err(domainError('INVALID_BENCHMARK', 'semantic_oracle', `missing fixture file ${marker.file}`));
  const markerOffset = occurrenceOffset(source, marker.marker, marker.markerOccurrence ?? 1);
  if (markerOffset < 0) return err(domainError('INVALID_BENCHMARK', 'semantic_oracle', `marker not found for ${marker.file}`));
  const within = marker.marker;
  const tokenOffset = occurrenceOffset(within, marker.token, marker.tokenOccurrence ?? 1);
  if (tokenOffset < 0) return err(domainError('INVALID_BENCHMARK', 'semantic_oracle', `token not found inside marker for ${marker.file}`));
  const absolute = markerOffset + tokenOffset;
  const before = source.slice(0, absolute);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  return ok({ line, column: absolute - lastNewline });
};

const sameStart = (
  location: SemanticLocation,
  expectedFile: string,
  expected: { readonly line: number; readonly column: number },
): boolean =>
  location.repoPath === expectedFile
  && location.startLine === expected.line
  && location.startColumn === expected.column;

export const evaluateSemanticProviderOracle = async (
  provider: SemanticAnalysisPort,
  files: Readonly<Record<string, string>>,
  oracle: SemanticProviderOracle,
): Promise<Result<SemanticEvaluationRun, DomainError>> => {
  if (oracle.schemaVersion !== 1 || oracle.cases.length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'semantic_oracle', 'semantic provider oracle schema/cases are invalid'));
  }
  const ids = oracle.cases.map((item) => item.id);
  if (ids.some((id) => id.trim().length === 0) || new Set(ids).size !== ids.length) {
    return err(domainError('INVALID_BENCHMARK', 'semantic_oracle', 'semantic provider oracle case IDs must be unique'));
  }

  const caseResults: SemanticProviderCaseResult[] = [];
  const queryDurationsMs: number[] = [];
  for (const item of oracle.cases) {
    const started = performance.now();
    if (item.operation === 'diagnostics') {
      const diagnostics = await Effect.runPromise(provider.diagnostics({ repoPath: item.query.file }));
      queryDurationsMs.push(Math.max(0, performance.now() - started));
      if (diagnostics._tag === 'Err') {
        caseResults.push({ caseId: item.id, status: 'error', observation: diagnostics.error.code });
        continue;
      }
      const errors = diagnostics.value.filter((diagnostic) => diagnostic.category === 'error').length;
      caseResults.push({
        caseId: item.id,
        status: errors >= item.expected.minErrors ? 'pass' : 'fail',
        observation: `errors=${errors}`,
      });
      continue;
    }

    const query = markerPosition(files, item.query);
    if (query._tag === 'Err') return query;
    if (item.operation === 'definition') {
      const expected = markerPosition(files, item.expected);
      if (expected._tag === 'Err') return expected;
      const definitions = await Effect.runPromise(provider.definition({
        repoPath: item.query.file,
        line: query.value.line,
        column: query.value.column,
      }));
      queryDurationsMs.push(Math.max(0, performance.now() - started));
      if (definitions._tag === 'Err') {
        caseResults.push({ caseId: item.id, status: 'error', observation: definitions.error.code });
        continue;
      }
      const matched = definitions.value.some((definition) =>
        sameStart(definition.location, item.expected.file, expected.value));
      caseResults.push({
        caseId: item.id,
        status: matched ? 'pass' : 'fail',
        observation: definitions.value
          .map((definition) => `${definition.location.repoPath}:${definition.location.startLine}:${definition.location.startColumn}`)
          .join(',') || 'no_definition',
      });
      continue;
    }

    const references = await Effect.runPromise(provider.references({
      repoPath: item.query.file,
      line: query.value.line,
      column: query.value.column,
    }));
    queryDurationsMs.push(Math.max(0, performance.now() - started));
    if (references._tag === 'Err') {
      caseResults.push({ caseId: item.id, status: 'error', observation: references.error.code });
      continue;
    }
    const expectedLocations: Array<{ readonly file: string; readonly line: number; readonly column: number }> = [];
    for (const marker of item.expectedReferenceMarkers) {
      const location = markerPosition(files, marker);
      if (location._tag === 'Err') return location;
      expectedLocations.push({ file: marker.file, ...location.value });
    }
    const missing = expectedLocations.filter((expected) =>
      !references.value.some((reference) => sameStart(reference.location, expected.file, expected)));
    caseResults.push({
      caseId: item.id,
      status: missing.length === 0 ? 'pass' : 'fail',
      observation: missing.length === 0
        ? `references=${references.value.length}`
        : `missing=${missing.map((value) => `${value.file}:${value.line}:${value.column}`).join(',')}`,
    });
  }
  return ok({ caseResults, queryDurationsMs });
};
