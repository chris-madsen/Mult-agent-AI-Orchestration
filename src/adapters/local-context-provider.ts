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
    readonly includeDocs: boolean;
    readonly includeMemory: boolean;
  }): Effect.Effect<Result<ContextBundle, DomainError>> => Effect.gen(function* () {
    if (input.workspaceId !== options.workspaceId) {
      return err(domainError('POLICY_DENIED', 'workspace_id', 'local context provider belongs to another workspace'));
    }
    const requestId = makeRequestId(options.newRequestId());
    if (requestId._tag === 'Err') return requestId;
    // Rank from indexed, limited candidates first; never re-read and hash the
    // entire repository for each MCP request. Verify selected paths with exact reads.
    const ranked = searchCode(options.index, options.workspaceId, input.query, {
      digestFor: () => undefined,
    }).slice(0, 20);
    const checked = new Map<string, { readonly digest?: string; readonly error?: string }>();
    for (const item of ranked) {
      if (checked.has(item.candidate.repoPath)) continue;
      const current = yield* options.files.readExact(options.rootPath, item.candidate.repoPath);
      checked.set(item.candidate.repoPath, current._tag === 'Ok'
        ? { digest: current.value.digest }
        : { error: current.error.code });
    }
    const evidence = ranked.flatMap((item, index) => {
      const evidenceId = makeEvidenceId(`code-${index + 1}`);
      if (evidenceId._tag === 'Err') return [];
      const checkedSource = checked.get(item.candidate.repoPath);
      const freshness = checkedSource?.digest === undefined
        ? (checkedSource?.error === 'WORKTREE_RACED' ? 'changed_during_request' : 'unknown')
        : checkedSource.digest === item.candidate.sourceDigest ? 'current' : 'stale';
      return [evidenceFromCandidate({ ...item, freshness }, evidenceId.value)];
    });
    const warnings = [
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
    return ok(mergeEvidence(requestId.value, input.query, evidence, warnings, ['code', ...failedRequiredSources]));
  }),
});
