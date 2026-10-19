import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  evidenceFromCandidate,
  makeEvidenceId,
  makeRequestId,
  mergeEvidence,
  searchCode,
  type CodeIndex,
  type ContextBundle,
} from '../domain/retrieval.js';
import type { WorkspaceFilePort } from '../application/ports.js';
import type { WorkspaceId } from '../domain/workspace.js';
import {
  initialSourceCoverage,
  legacySourceRequirements,
  requiredIncompleteSources,
  setSourceCoverage,
  sourceCoverageComplete,
  sourceIsRequested,
  type SourceRequirements,
} from '../domain/source-coverage.js';

export interface LocalContextProviderOptions {
  readonly workspaceId: WorkspaceId;
  readonly rootPath: string;
  readonly index: CodeIndex;
  readonly files: WorkspaceFilePort;
  readonly newRequestId: () => string;
  readonly failedSources?: readonly string[];
  readonly additionalWarnings?: readonly string[];
}

export const makeLocalContextProvider = (options: LocalContextProviderOptions) => ({
  search: (input: {
    readonly workspaceId: WorkspaceId;
    readonly query: string;
    readonly includeCode?: boolean;
    readonly includeDocs: boolean;
    readonly includeMemory: boolean;
    readonly sourceRequirements?: SourceRequirements;
  }): Effect.Effect<Result<ContextBundle, DomainError>> => Effect.gen(function* () {
    if (input.workspaceId !== options.workspaceId) {
      return err(domainError('POLICY_DENIED', 'workspace_id', 'local context provider belongs to another workspace'));
    }
    const requestId = makeRequestId(options.newRequestId());
    if (requestId._tag === 'Err') return requestId;
    // Rank from indexed, limited candidates first; never re-read and hash the
    // entire repository for each MCP request. Verify selected paths with exact reads.
    const includeCode = input.includeCode ?? true;
    const requirements = input.sourceRequirements ?? legacySourceRequirements({
      includeCode,
      includeDocs: input.includeDocs,
      includeMemory: input.includeMemory,
    });
    let sourceCoverage = initialSourceCoverage(requirements);
    const ranked = includeCode
      ? searchCode(options.index, options.workspaceId, input.query, {
        digestFor: () => undefined,
      }).slice(0, 20)
      : [];
    const checked = new Map<string, { readonly digest?: string; readonly error?: string }>();
    for (const item of ranked) {
      if (checked.has(item.candidate.repoPath)) continue;
      const current = yield* options.files.readExact(options.rootPath, item.candidate.repoPath);
      checked.set(item.candidate.repoPath, current._tag === 'Ok'
        ? { digest: current.value.digest }
        : { error: current.error.code });
    }
    let evidence = ranked.flatMap((item, index) => {
      const evidenceId = makeEvidenceId(`code-${index + 1}`);
      if (evidenceId._tag === 'Err') return [];
      const checkedSource = checked.get(item.candidate.repoPath);
      const freshness = checkedSource?.digest === undefined
        ? (checkedSource?.error === 'WORKTREE_RACED' ? 'changed_during_request' : 'unknown')
        : checkedSource.digest === item.candidate.sourceDigest ? 'current' : 'stale';
      return [evidenceFromCandidate({ ...item, freshness }, evidenceId.value)];
    });
    // Revalidate every selected path at the end of the entire retrieval
    // request. A digest changing after the first verification invalidates
    // current evidence; no uncertain result is promoted as verified source.
    const changedPaths = new Set<string>();
    for (const [path, earlier] of checked) {
      const finalRead = yield* options.files.readExact(options.rootPath, path as typeof ranked[number]['candidate']['repoPath']);
      if (finalRead._tag === 'Err' || earlier.digest === undefined || finalRead.value.digest !== earlier.digest) {
        changedPaths.add(path);
      }
    }
    if (changedPaths.size > 0) {
      evidence = evidence.map((item) => {
        const path = item.citation.slice(0, item.citation.lastIndexOf(':'));
        return changedPaths.has(path)
          ? { ...item, freshness: 'changed_during_request' as const, proofClass: 'uncertain' as const }
          : item;
      });
    }
    const warnings = [
      ...[...changedPaths].map((path) => path + ': source changed during context request'),
      ...(options.additionalWarnings ?? []),
      'Local lexical fallback is not a production Qdrant + semantic retrieval implementation',
      ...[...checked.entries()].filter(([, result]) => result.error !== undefined).map(([path, result]) => path + ': ' + result.error),
      ...(input.includeDocs ? ['documentation provider unavailable'] : []),
      ...(input.includeMemory ? ['memory provider unavailable'] : []),
    ];
    const failedRequiredSources = [
      ...(options.failedSources ?? []),
      ...(input.includeDocs ? ['documentation'] : []),
      ...(input.includeMemory ? ['memory'] : []),
    ];
    const merged = mergeEvidence(requestId.value, input.query, evidence, warnings, [
      ...(includeCode ? ['code'] : []),
      ...failedRequiredSources,
    ]);
    if (input.sourceRequirements === undefined) return ok(merged);

    if (sourceIsRequested(requirements.code)) {
      sourceCoverage = setSourceCoverage(sourceCoverage, 'code', 'partial', 'lexical_fallback_not_production_verified');
    }
    if (sourceIsRequested(requirements.structural)) {
      sourceCoverage = setSourceCoverage(sourceCoverage, 'structural', 'unavailable', 'semantic_provider_not_available_in_local_fallback');
    }
    if (sourceIsRequested(requirements.documentation)) {
      sourceCoverage = setSourceCoverage(sourceCoverage, 'documentation', 'unavailable', 'documentation_provider_not_available_in_local_fallback');
    }
    if (sourceIsRequested(requirements.memory)) {
      sourceCoverage = setSourceCoverage(sourceCoverage, 'memory', 'unavailable', 'memory_provider_not_available_in_local_fallback');
    }
    const incomplete = requiredIncompleteSources(sourceCoverage);
    return ok({
      ...merged,
      sourceCoverage,
      partialSources: incomplete,
      complete: sourceCoverageComplete(sourceCoverage),
    });
  }),
});
