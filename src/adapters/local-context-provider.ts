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
    const snapshot = yield* options.files.snapshot(options.rootPath, Date.now());
    if (snapshot._tag === 'Err') return snapshot;
    const currentDigests = new Map(snapshot.value.files.map((file) => [file.repoPath, file.digest]));
    const ranked = searchCode(options.index, options.workspaceId, input.query, {
      digestFor: (_workspaceId, repoPath) => currentDigests.get(repoPath),
    });
    const evidence = ranked.flatMap((item, index) => {
      const evidenceId = makeEvidenceId(`code-${index + 1}`);
      return evidenceId._tag === 'Ok' ? [evidenceFromCandidate(item, evidenceId.value)] : [];
    });
    const warnings = [
      ...(input.includeDocs ? ['documentation provider unavailable'] : []),
      ...(input.includeMemory ? ['memory provider unavailable'] : []),
    ];
    return ok(mergeEvidence(requestId.value, input.query, evidence, warnings));
  }),
});
