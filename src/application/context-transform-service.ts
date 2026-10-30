import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, isErr, ok, type Result } from '../domain/result.js';
import type { ContextProvider } from '../gateway/mcp-gateway.js';
import type { WorkspaceStore, IdPort } from './ports.js';
import { makeContextAssembler, type ContextAssembler } from './context-assembler.js';
import { projectContextForDelivery, resolveDeliveryIntent } from '../domain/context-delivery.js';
import { ingestRepoPath, makeWorkspaceId, type WorkingContextHints, type WorkspaceId } from '../domain/workspace.js';
import type { RetrievalEvidence } from '../domain/retrieval.js';

export interface AceTransformRequest {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly workspaceId: string;
  readonly query: string;
  readonly budgetTokens: number;
  readonly sourceObligations: {
    readonly required: readonly ['code'];
  };
  readonly intent?: string;
  readonly workingContext?: {
    readonly focusedPath?: string;
    readonly openPaths?: readonly string[];
    readonly focusedRange?: { readonly startLine: number; readonly endLine: number };
  };
  readonly knownBundleId?: string;
  readonly knownEvidenceIds?: readonly string[];
}

export interface AceTransformResult {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly workspaceId: WorkspaceId;
  readonly status: 'ready' | 'partial' | 'not_ready' | 'blocked';
  readonly contextText: string;
  readonly evidence: readonly RetrievalEvidence[];
  readonly selectedEvidenceIds: readonly string[];
  readonly omittedEvidenceIds: readonly string[];
  readonly estimatedTokens: number;
  /** Explicitly distinguishes a model-matched count from the fallback estimate. */
  readonly tokenCountMode: 'host_counter' | 'character_estimate';
  readonly sourceCommit?: string;
  readonly sourceManifestSha256?: string;
  readonly providerIdentities: Readonly<Record<string, string>>;
  readonly receiptId: string;
  /** Original provider trace request identity, distinct from the caller's transform request ID. */
  readonly providerRequestId: string;
  readonly limitations: readonly string[];
}

export interface ContextTransformPorts {
  readonly ids: IdPort;
  readonly store: WorkspaceStore;
  readonly context: ContextProvider;
  readonly providerIdentities?: Readonly<Record<string, string>>;
  readonly assembler?: ContextAssembler;
  /** Optional exact host/provider token counter for the active model. */
  readonly countTokens?: (text: string) => number;
}

export interface ContextTransformService {
  readonly transform: (
    request: AceTransformRequest,
  ) => Effect.Effect<Result<AceTransformResult, DomainError>>;
}

const nonEmpty = (value: string, path: string): Result<string, DomainError> =>
  value.trim().length === 0
    ? err(domainError('INVALID_INPUT', path, `${path} must not be empty`))
    : ok(value.trim());

const sourceObligationsFor = (
  value: AceTransformRequest['sourceObligations'],
): Result<AceTransformRequest['sourceObligations'], DomainError> => {
  if (!Array.isArray(value.required) || value.required.length !== 1 || value.required[0] !== 'code') {
    return err(domainError('INVALID_INPUT', 'sourceObligations.required', 'the Harbor smoke currently requires exactly the code source class'));
  }
  return ok({ required: ['code'] });
};

const workingContextFor = (
  value: AceTransformRequest['workingContext'],
): Result<WorkingContextHints | undefined, DomainError> => {
  if (value === undefined) return ok(undefined);
  const focusedPath = value.focusedPath === undefined ? undefined : ingestRepoPath(value.focusedPath);
  if (focusedPath?._tag === 'Err') return focusedPath;
  const openPaths = [];
  for (const path of value.openPaths ?? []) {
    const parsed = ingestRepoPath(path);
    if (parsed._tag === 'Err') return parsed;
    openPaths.push(parsed.value);
  }
  if (openPaths.length > 100) {
    return err(domainError('INVALID_INPUT', 'working_context.open_paths', 'at most 100 open paths are allowed'));
  }
  const range = value.focusedRange;
  if (range !== undefined && (
    !Number.isSafeInteger(range.startLine)
    || !Number.isSafeInteger(range.endLine)
    || range.startLine < 1
    || range.endLine < range.startLine
  )) {
    return err(domainError('INVALID_INPUT', 'working_context.focused_range', 'focused range must be positive and ordered'));
  }
  return ok({
    ...(focusedPath?._tag === 'Ok' ? { focusedPath: focusedPath.value } : {}),
    ...(openPaths.length === 0 ? {} : { openPaths }),
    ...(range === undefined ? {} : { focusedRange: { startLine: range.startLine, endLine: range.endLine } }),
  });
};

export const makeContextTransformService = (ports: ContextTransformPorts): ContextTransformService => ({
  transform: (request) => Effect.gen(function* () {
    const assembler = ports.assembler ?? makeContextAssembler(ports.countTokens);
    if (request.schemaVersion !== 1) return err(domainError('INVALID_INPUT', 'schemaVersion', 'unsupported transform schema version'));
    const requestId = nonEmpty(request.requestId, 'requestId');
    if (requestId._tag === 'Err') return requestId;
    const sessionId = nonEmpty(request.sessionId, 'sessionId');
    if (sessionId._tag === 'Err') return sessionId;
    const turnId = nonEmpty(request.turnId, 'turnId');
    if (turnId._tag === 'Err') return turnId;
    const query = nonEmpty(request.query, 'query');
    if (query._tag === 'Err') return query;
    if (!Number.isSafeInteger(request.budgetTokens) || request.budgetTokens <= 0) {
      return err(domainError('INVALID_INPUT', 'budgetTokens', 'budgetTokens must be a positive safe integer'));
    }
    const sourceObligations = sourceObligationsFor(request.sourceObligations);
    if (sourceObligations._tag === 'Err') return sourceObligations;
    const workspaceId = makeWorkspaceId(request.workspaceId);
    if (workspaceId._tag === 'Err') return workspaceId;
    const workspace = yield* ports.store.get(workspaceId.value);
    if (isErr(workspace)) return workspace;
    const workingContext = workingContextFor(request.workingContext);
    if (workingContext._tag === 'Err') return workingContext;
    const searched = yield* ports.context.search({
      workspaceId: workspaceId.value,
      query: query.value,
      ...(request.intent === undefined ? {} : { intent: request.intent }),
      includeCode: true,
      includeDocs: false,
      includeMemory: false,
      includeHistory: false,
      ...(workingContext.value === undefined ? {} : { workingContextHints: workingContext.value }),
    });
    if (isErr(searched)) return searched;
    const projected = projectContextForDelivery(
      searched.value,
      resolveDeliveryIntent(request.intent),
      {
        ...(request.knownBundleId === undefined ? {} : { knownBundleId: request.knownBundleId }),
        ...(request.knownEvidenceIds === undefined ? {} : { knownEvidenceIds: request.knownEvidenceIds }),
        receiptScope: String(workspaceId.value),
      },
    );
    if (projected.evidence.length === 0) {
      return err(domainError('NOT_READY', 'context', 'ACE returned no evidence for the transformation request'));
    }
    const assembled = yield* assembler.assemble({
      evidence: projected.evidence,
      budgetTokens: request.budgetTokens,
    });
    if (assembled._tag === 'Err') return assembled;
    if (assembled.value.selected.length === 0) {
      return err(domainError('NOT_READY', 'budgetTokens', 'ACE evidence cannot fit the requested context budget'));
    }
    const selectedIds = assembled.value.selected.map((item) => String(item.evidenceId));
    const omittedIds = projected.evidence
      .filter((item) => !selectedIds.includes(String(item.evidenceId)))
      .map((item) => String(item.evidenceId));
    const limitations = [
      ...projected.warnings,
      ...projected.partialSources.map((source) => `${source}: partial`),
      ...assembled.value.limitations,
      ...(assembled.value.tokenCountMode === 'host_counter'
        ? []
        : ['token budget is a character-based estimate; model-exact fit is unverified']),
    ];
    // A complete provider bundle can still become partial after budget packing.
    const status = projected.complete
      && !assembled.value.truncated
      && assembled.value.tokenCountMode === 'host_counter'
      ? 'ready' as const : 'partial' as const;
    const receiptId = `ace-transform-${projected.bundleId ?? requestId.value}`;
    return ok({
      schemaVersion: 1,
      requestId: requestId.value,
      sessionId: sessionId.value,
      turnId: turnId.value,
      workspaceId: workspaceId.value,
      status,
      contextText: assembled.value.text,
      evidence: assembled.value.selected,
      selectedEvidenceIds: selectedIds,
      omittedEvidenceIds: omittedIds,
      estimatedTokens: assembled.value.estimatedTokens,
      tokenCountMode: assembled.value.tokenCountMode,
      ...(workspace.value.lastObservation?.headRevision === undefined
        ? {}
        : { sourceCommit: workspace.value.lastObservation.headRevision }),
      ...(projected.indexCoverage?.sourceSnapshotDigest === undefined
        ? {}
        : { sourceManifestSha256: projected.indexCoverage.sourceSnapshotDigest }),
      providerIdentities: ports.providerIdentities ?? {},
      receiptId,
      providerRequestId: String(searched.value.requestId),
      limitations,
    });
  }),
});
