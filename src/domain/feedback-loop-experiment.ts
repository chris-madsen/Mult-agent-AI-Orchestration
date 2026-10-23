import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { HermesContextEvidence } from './hermes-context-evidence.js';

export type FeedbackArm = 'native' | 'ace_optional';
export type FeedbackQuality = 'pass' | 'fail' | 'unknown';
export type FeedbackStatus = 'PASS' | 'UNKNOWN' | 'BLOCKED' | 'QUALITY_REGRESSION' | 'ACE_NOT_USED';
export type FeedbackMode = 'cold' | 'warm';
export type FeedbackSelection = 'smoke' | 'main' | 'holdout';

export interface FeedbackTaskIdentity {
  readonly id: string;
  readonly sourceRevision: string;
  readonly sourceDigest: string;
  readonly taskDigest: string;
  readonly taskPath?: string;
}

export interface FeedbackTaskManifest {
  readonly schemaVersion: 1;
  readonly selection: FeedbackSelection;
  readonly dataset: {
    readonly id: 'scale-ai/swe-atlas-qna';
    readonly revision: string;
    readonly rawSha256: string;
  };
  readonly tasks: readonly FeedbackTaskIdentity[];
  readonly holdout: readonly FeedbackTaskIdentity[];
}

export interface FeedbackExperimentManifest {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly sourceCommit: string;
  readonly taskManifestSha256: string;
  readonly agent: 'hermes';
  readonly agentVersion: string;
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
  readonly harborVersion: string;
  /** Present for a single-image smoke; main runs use taskImages. */
  readonly imageDigest?: string;
  readonly taskImages: readonly {
    readonly reference: string;
    readonly digest: string;
  }[];
  readonly agentAdapterSha256: string;
  readonly aceContextBridgeSha256: string;
  readonly contextPluginSha256: string;
  readonly seed: string | 'unknown';
  readonly mode: FeedbackMode;
  readonly nConcurrentTrials: 1;
  readonly nAttempts: 1;
  readonly authenticationRoute: string;
}

export interface FeedbackUsage {
  /** Provider-reported input tokens. Cached input is included once in this value. */
  readonly inputTokens?: number;
  /** Provider-reported cached input tokens, retained separately and never added again. */
  readonly cachedInputTokens?: number;
  /** Provider-reported output tokens. */
  readonly outputTokens?: number;
  readonly costUsd?: number;
}

export interface FeedbackArtifactHash {
  readonly path: string;
  readonly sha256: string;
}

export interface FeedbackTrialObservation {
  readonly arm: FeedbackArm;
  readonly taskId: string;
  readonly trialId: string;
  readonly sourceRevision: string;
  readonly sourceDigest: string;
  readonly taskDigest: string;
  readonly quality: FeedbackQuality;
  readonly usage: FeedbackUsage;
  readonly durationMs?: number;
  readonly nativeFileReads?: number;
  /** Total user-facing ACE calls, including exact ace_expand reads. */
  readonly observedAceCalls: number;
  /** ace_context calls only. Undefined preserves legacy observations where every ACE call was a context call. */
  readonly observedAceContextCalls?: number;
  /** Request IDs observed in successful ace_context MCP tool events. */
  readonly observedAceRequestIds: readonly string[];
  /** Request IDs observed in successful Hermes ContextEngine transformations. */
  readonly contextTransformRequestIds?: readonly string[];
  /** Sanitized Hermes ContextEngine transformation receipts. */
  readonly hermesContextEvidence?: readonly HermesContextEvidence[];
  /** Request IDs found in the ACE provider trace for this trial. */
  readonly providerTraceRequestIds: readonly string[];
  readonly rawArtifactHashes: readonly FeedbackArtifactHash[];
}

export interface FeedbackTaskRow {
  readonly taskId: string;
  readonly nativeQuality: FeedbackQuality;
  readonly aceQuality: FeedbackQuality;
  readonly aceCalled: boolean | null;
  readonly aceCorrelation: 'correlated' | 'ACE_NOT_USED' | 'UNKNOWN';
  readonly nativeInputTokens: number | null;
  readonly nativeCachedInputTokens: number | null;
  readonly nativeOutputTokens: number | null;
  readonly nativeTotalTokens: number | null;
  readonly aceInputTokens: number | null;
  readonly aceCachedInputTokens: number | null;
  readonly aceOutputTokens: number | null;
  readonly aceTotalTokens: number | null;
  readonly nativeCostUsd: number | null;
  readonly aceCostUsd: number | null;
  readonly qualityDelta: 'no_regression' | 'regression' | 'unknown';
  readonly tokenRatio: number | null;
  readonly durationNativeMs: number | null;
  readonly durationAceMs: number | null;
  readonly nativeFileReads: number | null;
  readonly status: FeedbackStatus;
}

export interface FeedbackReport {
  readonly schemaVersion: 1;
  readonly status: FeedbackStatus;
  readonly qualityGate: 'pass' | 'unknown' | 'regression';
  readonly qualityRegressionTaskIds: readonly string[];
  readonly rows: readonly FeedbackTaskRow[];
  readonly nativeInputTokens: number | null;
  readonly aceInputTokens: number | null;
  readonly nativeCachedInputTokens: number | null;
  readonly aceCachedInputTokens: number | null;
  readonly nativeOutputTokens: number | null;
  readonly aceOutputTokens: number | null;
  readonly nativeTotalTokens: number | null;
  readonly aceTotalTokens: number | null;
  readonly tokenRatio: number | null;
  readonly nativeCostUsd: number | null;
  readonly aceCostUsd: number | null;
  readonly aceObservedCalls: number;
  readonly aceCorrelatedCalls: number;
  readonly aceNotUsed: boolean;
}

const sha256Hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const revision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40,64}$/iu.test(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nonNegativeNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const invalid = (path: string, message: string): Result<never, DomainError> => err(domainError('INVALID_BENCHMARK', path, message));

const uniqueStrings = (values: readonly unknown[]): values is readonly string[] => values.every(nonEmpty)
  && new Set(values).size === values.length;

export const validateFeedbackArtifactHashes = (value: unknown, path = 'rawArtifactHashes'): Result<readonly FeedbackArtifactHash[], DomainError> => {
  if (!Array.isArray(value) || value.length === 0) return invalid(path, 'at least one raw artifact hash is required');
  const paths = new Set<string>();
  const artifacts: FeedbackArtifactHash[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return invalid(`${path}[${index}]`, 'artifact hash must be an object');
    const artifact = item as Record<string, unknown>;
    if (!nonEmpty(artifact.path) || !sha256Hex(artifact.sha256) || paths.has(artifact.path)) {
      return invalid(`${path}[${index}]`, 'artifact paths must be unique and carry SHA-256 digests');
    }
    paths.add(artifact.path);
    artifacts.push({ path: artifact.path, sha256: artifact.sha256 });
  }
  return ok(artifacts);
};

const feedbackStatus = (value: unknown): value is FeedbackStatus =>
  value === 'PASS' || value === 'UNKNOWN' || value === 'BLOCKED' || value === 'QUALITY_REGRESSION' || value === 'ACE_NOT_USED';
const feedbackQuality = (value: unknown): value is FeedbackQuality => value === 'pass' || value === 'fail' || value === 'unknown';
const nullablePositiveInteger = (value: unknown): value is number | null => value === null || positiveInteger(value);
const nullableNonNegativeInteger = (value: unknown): value is number | null => value === null || nonNegativeInteger(value);
const nullableNonNegativeNumber = (value: unknown): value is number | null => value === null || nonNegativeNumber(value);

export const validateFeedbackReport = (value: unknown, path = 'feedback_report'): Result<FeedbackReport, DomainError> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(path, 'feedback report must be an object');
  const report = value as Record<string, unknown>;
  if (report.schemaVersion !== 1 || !feedbackStatus(report.status)
    || !['pass', 'unknown', 'regression'].includes(String(report.qualityGate))
    || !Array.isArray(report.rows) || report.rows.length === 0
    || !Array.isArray(report.qualityRegressionTaskIds) || !uniqueStrings(report.qualityRegressionTaskIds)
    || !nullablePositiveInteger(report.nativeInputTokens) || !nullablePositiveInteger(report.aceInputTokens)
    || !nullableNonNegativeInteger(report.nativeCachedInputTokens) || !nullableNonNegativeInteger(report.aceCachedInputTokens)
    || !nullablePositiveInteger(report.nativeOutputTokens) || !nullablePositiveInteger(report.aceOutputTokens)
    || !nullablePositiveInteger(report.nativeTotalTokens) || !nullablePositiveInteger(report.aceTotalTokens)
    || !(report.tokenRatio === null || typeof report.tokenRatio === 'number' && Number.isFinite(report.tokenRatio) && report.tokenRatio > 0)
    || !nullableNonNegativeNumber(report.nativeCostUsd) || !nullableNonNegativeNumber(report.aceCostUsd)
    || !nonNegativeInteger(report.aceObservedCalls) || !nonNegativeInteger(report.aceCorrelatedCalls)
    || (report.aceCorrelatedCalls as number) > (report.aceObservedCalls as number) || typeof report.aceNotUsed !== 'boolean') {
    return invalid(path, 'feedback report counters, status or quality fields are malformed');
  }
  for (const [index, valueAt] of report.rows.entries()) {
    if (typeof valueAt !== 'object' || valueAt === null || Array.isArray(valueAt)) return invalid(`${path}.rows[${index}]`, 'task row must be an object');
    const row = valueAt as Record<string, unknown>;
    if (!nonEmpty(row.taskId) || !feedbackQuality(row.nativeQuality) || !feedbackQuality(row.aceQuality)
      || !(row.aceCalled === null || typeof row.aceCalled === 'boolean')
      || !['correlated', 'ACE_NOT_USED', 'UNKNOWN'].includes(String(row.aceCorrelation))
      || !nullablePositiveInteger(row.nativeInputTokens) || !nullableNonNegativeInteger(row.nativeCachedInputTokens)
      || !nullablePositiveInteger(row.nativeOutputTokens) || !nullablePositiveInteger(row.nativeTotalTokens)
      || !nullablePositiveInteger(row.aceInputTokens) || !nullableNonNegativeInteger(row.aceCachedInputTokens)
      || !nullablePositiveInteger(row.aceOutputTokens) || !nullablePositiveInteger(row.aceTotalTokens)
      || !nullableNonNegativeNumber(row.nativeCostUsd) || !nullableNonNegativeNumber(row.aceCostUsd)
      || !['no_regression', 'regression', 'unknown'].includes(String(row.qualityDelta))
      || !(row.tokenRatio === null || typeof row.tokenRatio === 'number' && Number.isFinite(row.tokenRatio) && row.tokenRatio > 0)
      || !nullableNonNegativeNumber(row.durationNativeMs) || !nullableNonNegativeNumber(row.durationAceMs)
      || !nullableNonNegativeInteger(row.nativeFileReads) || !feedbackStatus(row.status)) {
      return invalid(`${path}.rows[${index}]`, 'task row fields are malformed');
    }
  }
  return ok(value as FeedbackReport);
};

const validateTask = (value: unknown, path: string): Result<FeedbackTaskIdentity, DomainError> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(path, 'task identity must be an object');
  const task = value as Record<string, unknown>;
  if (!nonEmpty(task.id) || !revision(task.sourceRevision) || !sha256Hex(task.sourceDigest) || !sha256Hex(task.taskDigest)) {
    return invalid(path, 'task identity requires id, source revision and source/task SHA-256 digests');
  }
  const taskPath = task.taskPath;
  if (taskPath !== undefined && (typeof taskPath !== 'string' || taskPath.trim().length === 0
    || taskPath.startsWith('/') || taskPath.split('/').some((part) => part === '..' || part.length === 0))) {
    return invalid(`${path}.taskPath`, 'task path must be relative and contained');
  }
  return ok({
    id: task.id,
    sourceRevision: task.sourceRevision,
    sourceDigest: task.sourceDigest,
    taskDigest: task.taskDigest,
    ...(taskPath === undefined ? {} : { taskPath }),
  });
};

const validateTaskList = (
  value: unknown,
  path: string,
  expectedLength: number | undefined,
  seen: Set<string>,
): Result<readonly FeedbackTaskIdentity[], DomainError> => {
  if (!Array.isArray(value) || value.length === 0 || expectedLength !== undefined && value.length !== expectedLength) {
    return invalid(path, expectedLength === undefined
      ? 'task list must be non-empty'
      : `task list must contain exactly ${expectedLength} tasks`);
  }
  const tasks: FeedbackTaskIdentity[] = [];
  for (const [index, item] of value.entries()) {
    const task = validateTask(item, `${path}[${index}]`);
    if (task._tag === 'Err') return task;
    if (seen.has(task.value.id)) return invalid(`${path}[${index}].id`, 'task IDs must be unique across main and holdout sets');
    seen.add(task.value.id);
    tasks.push(task.value);
  }
  return ok(tasks);
};

export const validateFeedbackTaskManifest = (value: unknown): Result<FeedbackTaskManifest, DomainError> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid('task_manifest', 'task manifest must be an object');
  const root = value as Record<string, unknown>;
  const dataset = typeof root.dataset === 'object' && root.dataset !== null && !Array.isArray(root.dataset)
    ? root.dataset as Record<string, unknown>
    : undefined;
  const selection = root.selection;
  if (root.schemaVersion !== 1 || (selection !== 'smoke' && selection !== 'main' && selection !== 'holdout')
    || dataset?.id !== 'scale-ai/swe-atlas-qna' || !revision(dataset.revision) || !sha256Hex(dataset.rawSha256)) {
    return invalid('task_manifest', 'dataset identity and selection are not pinned');
  }
  const seen = new Set<string>();
  const expectedMain = selection === 'smoke' ? 1 : 10;
  const tasks = validateTaskList(root.tasks, 'task_manifest.tasks', expectedMain, seen);
  if (tasks._tag === 'Err') return tasks;
  const holdout = (selection === 'smoke' || selection === 'holdout')
    && (root.holdout === undefined || Array.isArray(root.holdout) && root.holdout.length === 0)
    ? ok([] as readonly FeedbackTaskIdentity[])
    : validateTaskList(root.holdout, 'task_manifest.holdout', 10, seen);
  if (holdout._tag === 'Err') return holdout;
  return ok({
    schemaVersion: 1,
    selection,
    dataset: { id: 'scale-ai/swe-atlas-qna', revision: dataset.revision, rawSha256: dataset.rawSha256 },
    tasks: tasks.value,
    holdout: holdout.value,
  });
};

export const validateFeedbackExperimentManifest = (value: unknown): Result<FeedbackExperimentManifest, DomainError> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid('experiment_manifest', 'experiment manifest must be an object');
  const root = value as Record<string, unknown>;
  const effort = root.reasoningEffort;
  const seed = root.seed;
  const imageDigest = root.imageDigest;
  const taskImagesValue = root.taskImages;
  const taskImages: { readonly reference: string; readonly digest: string }[] = [];
  if (taskImagesValue !== undefined) {
    if (!Array.isArray(taskImagesValue) || taskImagesValue.length === 0) {
      return invalid('experiment_manifest.taskImages', 'task image provenance must be a non-empty array when present');
    }
    for (const [index, item] of taskImagesValue.entries()) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return invalid(`experiment_manifest.taskImages[${index}]`, 'task image provenance must be an object');
      }
      const image = item as Record<string, unknown>;
      if (!nonEmpty(image.reference) || typeof image.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(image.digest)) {
        return invalid(`experiment_manifest.taskImages[${index}]`, 'task image provenance requires a reference and Docker digest');
      }
      if (taskImages.some((candidate) => candidate.reference === image.reference)) {
        return invalid(`experiment_manifest.taskImages[${index}].reference`, 'task image references must be unique');
      }
      taskImages.push({ reference: image.reference, digest: image.digest });
    }
  }
  const hasSingleImage = typeof imageDigest === 'string' && /^sha256:[a-f0-9]{64}$/u.test(imageDigest);
  if (hasSingleImage && taskImages.length > 0
    && (taskImages.length !== 1 || taskImages[0]?.digest !== imageDigest)) {
    return invalid('experiment_manifest', 'single-image digest and task image provenance must describe the same Docker image');
  }
  if (!hasSingleImage && taskImages.length === 0) {
    return invalid('experiment_manifest', 'experiment requires one image digest or task image provenance');
  }
  if (imageDigest !== undefined && !hasSingleImage) {
    return invalid('experiment_manifest.imageDigest', 'imageDigest must be a Docker sha256 digest');
  }
  if (root.schemaVersion !== 1 || !nonEmpty(root.runId) || !revision(root.sourceCommit)
    || root.agent !== 'hermes' || !nonEmpty(root.agentVersion)
    || !sha256Hex(root.taskManifestSha256) || !nonEmpty(root.model) || !root.model.startsWith('openai-codex/')
    || (effort !== 'low' && effort !== 'medium' && effort !== 'high') || !nonEmpty(root.harborVersion)
    || !sha256Hex(root.agentAdapterSha256) || !sha256Hex(root.aceContextBridgeSha256) || !sha256Hex(root.contextPluginSha256)
    || !(seed === 'unknown' || nonEmpty(seed))
    || (root.mode !== 'cold' && root.mode !== 'warm') || root.nConcurrentTrials !== 1 || root.nAttempts !== 1
    || !nonEmpty(root.authenticationRoute)) {
    return invalid('experiment_manifest', 'experiment requires pinned Hermes/model/reasoning, agent/MCP digests and serial one-attempt limits');
  }
  if (/(?:bearer|api[_-]?key|access[_-]?token|password|secret)\s*[:=]/iu.test(root.authenticationRoute)) {
    return err(domainError('SECRET_DETECTED', 'experiment_manifest.authenticationRoute', 'authentication route must not contain credentials'));
  }
  return ok({
    schemaVersion: 1,
    runId: root.runId,
    sourceCommit: root.sourceCommit,
    taskManifestSha256: root.taskManifestSha256,
    agent: 'hermes',
    agentVersion: root.agentVersion,
    model: root.model,
    reasoningEffort: effort,
    harborVersion: root.harborVersion,
    ...(hasSingleImage ? { imageDigest } : {}),
    taskImages,
    agentAdapterSha256: root.agentAdapterSha256,
    aceContextBridgeSha256: root.aceContextBridgeSha256,
    contextPluginSha256: root.contextPluginSha256,
    seed,
    mode: root.mode,
    nConcurrentTrials: 1,
    nAttempts: 1,
    authenticationRoute: root.authenticationRoute,
  });
};

const validateUsage = (usage: FeedbackUsage, path: string): Result<void, DomainError> => {
  const values: readonly [string, number | undefined][] = [
    ['inputTokens', usage.inputTokens],
    ['cachedInputTokens', usage.cachedInputTokens],
    ['outputTokens', usage.outputTokens],
  ];
  for (const [name, value] of values) {
    if (value !== undefined && (name === 'cachedInputTokens' ? !nonNegativeInteger(value) : !positiveInteger(value))) {
      return invalid(`${path}.${name}`, 'provider token counters must be positive; cached input may be zero but never negative/fractional');
    }
  }
  if (usage.inputTokens !== undefined && usage.cachedInputTokens !== undefined && usage.cachedInputTokens > usage.inputTokens) {
    return invalid(`${path}.cachedInputTokens`, 'cached input tokens cannot exceed input tokens');
  }
  if (usage.costUsd !== undefined && !nonNegativeNumber(usage.costUsd)) return invalid(`${path}.costUsd`, 'cost must be a finite non-negative number');
  return ok(undefined);
};

const validateObservation = (observation: FeedbackTrialObservation, path: string): Result<void, DomainError> => {
  if ((observation.arm !== 'native' && observation.arm !== 'ace_optional') || !nonEmpty(observation.taskId)
    || !nonEmpty(observation.trialId) || !revision(observation.sourceRevision) || !sha256Hex(observation.sourceDigest)
    || !sha256Hex(observation.taskDigest) || !['pass', 'fail', 'unknown'].includes(observation.quality)
    || !nonNegativeInteger(observation.observedAceCalls) || !uniqueStrings(observation.observedAceRequestIds)
    || !uniqueStrings(observation.providerTraceRequestIds)) {
    return invalid(path, 'trial observation identity, usage, ACE request IDs and raw artifact hashes are malformed');
  }
  const usage = validateUsage(observation.usage, `${path}.usage`);
  if (usage._tag === 'Err') return usage;
  if (observation.durationMs !== undefined && !nonNegativeNumber(observation.durationMs)) return invalid(`${path}.durationMs`, 'duration must be non-negative');
  if (observation.nativeFileReads !== undefined && !nonNegativeInteger(observation.nativeFileReads)) return invalid(`${path}.nativeFileReads`, 'native file reads must be non-negative');
  const observedContextCalls = observation.observedAceContextCalls ?? observation.observedAceCalls;
  if (!nonNegativeInteger(observedContextCalls) || observedContextCalls > observation.observedAceCalls) {
    return invalid(`${path}.observedAceContextCalls`, 'context calls must be non-negative and cannot exceed total observed ACE calls');
  }
  const contextTransformIds = observation.contextTransformRequestIds ?? [];
  if ((observation.arm === 'native' && (contextTransformIds.length > 0 || (observation.hermesContextEvidence?.length ?? 0) > 0))
    || !uniqueStrings(contextTransformIds)) {
    return invalid(path, 'native arm must not contain Hermes ContextEngine evidence and context request IDs must be unique');
  }
  if (observation.hermesContextEvidence !== undefined
    && observation.hermesContextEvidence.length !== contextTransformIds.length) {
    return invalid(`${path}.hermesContextEvidence`, 'Hermes evidence count must match transformation request IDs');
  }
  if (observation.observedAceCalls < observedContextCalls + contextTransformIds.length) {
    return invalid(`${path}.observedAceCalls`, 'total ACE calls must include MCP context calls and Hermes ContextEngine transformations');
  }
  if (observation.hermesContextEvidence?.some((item) => item.requestId.trim().length === 0)) {
    return invalid(`${path}.hermesContextEvidence`, 'Hermes evidence request IDs must be non-empty');
  }
  if (observation.observedAceRequestIds.length > observedContextCalls) return invalid(`${path}.observedAceRequestIds`, 'request IDs cannot exceed observed ace_context calls');
  if (observation.arm === 'native' && (observation.observedAceCalls !== 0 || observedContextCalls !== 0 || observation.observedAceRequestIds.length > 0 || observation.providerTraceRequestIds.length > 0)) {
    return invalid(path, 'native arm must not contain ACE calls or provider trace requests');
  }
  const artifacts = validateFeedbackArtifactHashes(observation.rawArtifactHashes, `${path}.rawArtifactHashes`);
  if (artifacts._tag === 'Err') return artifacts;
  return ok(undefined);
};

const mapByTask = (observations: readonly FeedbackTrialObservation[], arm: FeedbackArm): Result<ReadonlyMap<string, FeedbackTrialObservation>, DomainError> => {
  const result = new Map<string, FeedbackTrialObservation>();
  const trialIds = new Set<string>();
  const requestIds = new Set<string>();
  for (const [index, observation] of observations.entries()) {
    const checked = validateObservation(observation, `${arm}.observations[${index}]`);
    if (checked._tag === 'Err') return checked;
    if (observation.arm !== arm || result.has(observation.taskId) || trialIds.has(observation.trialId)) {
      return invalid(`${arm}.observations[${index}]`, 'trial/task IDs must be unique and belong to the declared arm');
    }
    for (const requestId of [...observation.observedAceRequestIds, ...(observation.contextTransformRequestIds ?? [])]) {
      if (requestIds.has(requestId)) return invalid(`${arm}.observations[${index}].requestIds`, 'ACE request IDs must not be duplicated');
      requestIds.add(requestId);
    }
    trialIds.add(observation.trialId);
    result.set(observation.taskId, observation);
  }
  return ok(result);
};

const tokenValue = (usage: FeedbackUsage, field: 'inputTokens' | 'cachedInputTokens' | 'outputTokens'): number | null => usage[field] ?? null;
const totalTokens = (usage: FeedbackUsage): number | null => usage.inputTokens === undefined || usage.outputTokens === undefined
  ? null
  : usage.inputTokens + usage.outputTokens;
const sumKnown = (values: readonly (number | null)[]): number | null => values.every((value): value is number => value !== null)
  ? values.reduce((sum, value) => sum + value, 0)
  : null;
const sumOptional = (values: readonly (number | undefined)[]): number | null => values.every((value): value is number => value !== undefined)
  ? values.reduce((sum, value) => sum + value, 0)
  : null;

const correlationFor = (observation: FeedbackTrialObservation): 'correlated' | 'ACE_NOT_USED' | 'UNKNOWN' => {
  const transformIds = observation.contextTransformRequestIds ?? [];
  const providerIds = new Set(observation.providerTraceRequestIds);
  if (transformIds.length > 0) {
    const receipts = observation.hermesContextEvidence ?? [];
    if (receipts.length !== transformIds.length || receipts.some((item) => item.status !== 'ready')) return 'UNKNOWN';
    return receipts.every((item) => typeof item.providerRequestId === 'string'
      && transformIds.includes(item.requestId) && providerIds.has(item.providerRequestId))
      ? 'correlated' : 'UNKNOWN';
  }
  if (observation.observedAceCalls === 0) return 'ACE_NOT_USED';
  const observedContextCalls = observation.observedAceContextCalls ?? observation.observedAceCalls;
  if (observedContextCalls === 0 || observation.observedAceRequestIds.length !== observedContextCalls) return 'UNKNOWN';
  return observation.observedAceRequestIds.every((requestId) => providerIds.has(requestId)) ? 'correlated' : 'UNKNOWN';
};

const rowStatus = (native: FeedbackTrialObservation, ace: FeedbackTrialObservation, qualityDelta: FeedbackTaskRow['qualityDelta'], correlation: FeedbackTaskRow['aceCorrelation']): FeedbackStatus => {
  if (qualityDelta === 'regression') return 'QUALITY_REGRESSION';
  if (correlation === 'ACE_NOT_USED') return 'ACE_NOT_USED';
  if (qualityDelta === 'unknown' || correlation === 'UNKNOWN' || native.quality !== 'pass' || ace.quality !== 'pass'
    || totalTokens(native.usage) === null || totalTokens(ace.usage) === null) return 'UNKNOWN';
  return 'PASS';
};

const rowFor = (taskId: string, native: FeedbackTrialObservation, ace: FeedbackTrialObservation): FeedbackTaskRow => {
  const correlation = correlationFor(ace);
  const qualityDelta: FeedbackTaskRow['qualityDelta'] = native.quality === 'pass' && ace.quality === 'fail'
    ? 'regression'
    : native.quality === 'unknown' || ace.quality === 'unknown' ? 'unknown' : 'no_regression';
  const nativeTotal = totalTokens(native.usage);
  const aceTotal = totalTokens(ace.usage);
  const tokenRatio = qualityDelta === 'no_regression' && native.quality === 'pass' && ace.quality === 'pass'
    && nativeTotal !== null && aceTotal !== null && nativeTotal > 0 && aceTotal > 0 && correlation === 'correlated'
    ? nativeTotal / aceTotal
    : null;
  return {
    taskId,
    nativeQuality: native.quality,
    aceQuality: ace.quality,
    aceCalled: ace.observedAceCalls > 0 || (ace.contextTransformRequestIds?.length ?? 0) > 0,
    aceCorrelation: correlation,
    nativeInputTokens: tokenValue(native.usage, 'inputTokens'),
    nativeCachedInputTokens: tokenValue(native.usage, 'cachedInputTokens'),
    nativeOutputTokens: tokenValue(native.usage, 'outputTokens'),
    nativeTotalTokens: nativeTotal,
    aceInputTokens: tokenValue(ace.usage, 'inputTokens'),
    aceCachedInputTokens: tokenValue(ace.usage, 'cachedInputTokens'),
    aceOutputTokens: tokenValue(ace.usage, 'outputTokens'),
    aceTotalTokens: aceTotal,
    nativeCostUsd: native.usage.costUsd ?? null,
    aceCostUsd: ace.usage.costUsd ?? null,
    qualityDelta,
    tokenRatio,
    durationNativeMs: native.durationMs ?? null,
    durationAceMs: ace.durationMs ?? null,
    nativeFileReads: native.nativeFileReads ?? null,
    status: rowStatus(native, ace, qualityDelta, correlation),
  };
};

export const reconcileFeedbackTrials = (input: {
  readonly taskManifest: FeedbackTaskManifest;
  readonly native: readonly FeedbackTrialObservation[];
  readonly ace: readonly FeedbackTrialObservation[];
  readonly expectedTaskManifestSha256?: string;
}): Result<FeedbackReport, DomainError> => {
  const manifest = validateFeedbackTaskManifest(input.taskManifest);
  if (manifest._tag === 'Err') return manifest;
  if (input.expectedTaskManifestSha256 !== undefined && !sha256Hex(input.expectedTaskManifestSha256)) {
    return invalid('task_manifest.sha256', 'task manifest digest must be SHA-256');
  }
  const native = mapByTask(input.native, 'native');
  if (native._tag === 'Err') return native;
  const ace = mapByTask(input.ace, 'ace_optional');
  if (ace._tag === 'Err') return ace;
  const globalTrialIds = new Set<string>();
  for (const observation of [...input.native, ...input.ace]) {
    if (globalTrialIds.has(observation.trialId)) return invalid('trials.trialId', 'trial IDs must be unique across both arms');
    globalTrialIds.add(observation.trialId);
  }
  const globalRequestIds = new Set<string>();
  for (const observation of [...input.native, ...input.ace]) {
    for (const requestId of [...observation.observedAceRequestIds, ...(observation.contextTransformRequestIds ?? [])]) {
      if (globalRequestIds.has(requestId)) return invalid('trials.requestId', 'ACE request IDs must be unique across both arms');
      globalRequestIds.add(requestId);
    }
  }
  const rows: FeedbackTaskRow[] = [];
  for (const task of manifest.value.tasks) {
    const nativeTrial = native.value.get(task.id);
    const aceTrial = ace.value.get(task.id);
    if (nativeTrial === undefined || aceTrial === undefined) {
      return err(domainError('DIGEST_MISMATCH', `tasks.${task.id}`, 'both arms must retain one trial observation for every frozen task; missing trials are not converted to zero'));
    }
    const observations = [nativeTrial, aceTrial];
    if (observations.some((item) => item.sourceRevision !== task.sourceRevision || item.sourceDigest !== task.sourceDigest || item.taskDigest !== task.taskDigest)) {
      return err(domainError('DIGEST_MISMATCH', `tasks.${task.id}`, 'trial source/task digest does not match the frozen task manifest'));
    }
    rows.push(rowFor(task.id, nativeTrial, aceTrial));
  }
  if (native.value.size !== manifest.value.tasks.length || ace.value.size !== manifest.value.tasks.length) {
    return invalid('trials', 'observations for unknown tasks are not allowed');
  }
  const regressionIds = rows.filter((row) => row.qualityDelta === 'regression').map((row) => row.taskId);
  const unknownQuality = rows.some((row) => row.qualityDelta === 'unknown');
  const qualityGate = regressionIds.length > 0 ? 'regression' : unknownQuality ? 'unknown' : 'pass';
  const allCorrelated = rows.every((row) => row.aceCorrelation === 'correlated');
  const aceNotUsed = rows.every((row) => row.aceCorrelation === 'ACE_NOT_USED');
  const usageUnknown = rows.some((row) => row.nativeTotalTokens === null || row.aceTotalTokens === null);
  // An equal number of failures is not an accepted-task token-saving result.
  const nonAcceptedPairs = rows.some((row) => row.nativeQuality !== 'pass' || row.aceQuality !== 'pass');
  const nativeTotal = sumKnown(rows.map((row) => row.nativeTotalTokens));
  const aceTotal = sumKnown(rows.map((row) => row.aceTotalTokens));
  const tokenRatio = qualityGate === 'pass' && !nonAcceptedPairs && allCorrelated
    && nativeTotal !== null && aceTotal !== null && nativeTotal > 0 && aceTotal > 0
    ? nativeTotal / aceTotal
    : null;
  const status: FeedbackStatus = regressionIds.length > 0
    ? 'QUALITY_REGRESSION'
    : aceNotUsed ? 'ACE_NOT_USED'
      : qualityGate === 'unknown' || nonAcceptedPairs || !allCorrelated || usageUnknown ? 'UNKNOWN' : 'PASS';
  return ok({
    schemaVersion: 1,
    status,
    qualityGate,
    qualityRegressionTaskIds: regressionIds,
    rows,
    nativeInputTokens: sumKnown(rows.map((row) => row.nativeInputTokens)),
    aceInputTokens: sumKnown(rows.map((row) => row.aceInputTokens)),
    nativeCachedInputTokens: sumKnown(rows.map((row) => row.nativeCachedInputTokens)),
    aceCachedInputTokens: sumKnown(rows.map((row) => row.aceCachedInputTokens)),
    nativeOutputTokens: sumKnown(rows.map((row) => row.nativeOutputTokens)),
    aceOutputTokens: sumKnown(rows.map((row) => row.aceOutputTokens)),
    nativeTotalTokens: nativeTotal,
    aceTotalTokens: aceTotal,
    tokenRatio,
    nativeCostUsd: sumOptional(input.native.map((item) => item.usage.costUsd)),
    aceCostUsd: sumOptional(input.ace.map((item) => item.usage.costUsd)),
    aceObservedCalls: input.ace.reduce((sum, item) => sum + item.observedAceCalls, 0),
    aceCorrelatedCalls: input.ace.reduce((sum, trial) => {
      const providerIds = new Set(trial.providerTraceRequestIds);
      const mcpCorrelated = trial.observedAceRequestIds.filter((id) => providerIds.has(id)).length;
      const transformIds = new Set(trial.contextTransformRequestIds ?? []);
      const transformCorrelated = (trial.hermesContextEvidence ?? []).filter((item) =>
        item.status === 'ready'
        && transformIds.has(item.requestId)
        && typeof item.providerRequestId === 'string'
        && providerIds.has(item.providerRequestId)).length;
      return sum + mcpCorrelated + transformCorrelated;
    }, 0),
    aceNotUsed,
  });
};

export const feedbackTokenRatio = (nativeTotalTokens: number | null, aceTotalTokens: number | null): number | null =>
  nativeTotalTokens !== null && aceTotalTokens !== null && nativeTotalTokens > 0 && aceTotalTokens > 0
    ? nativeTotalTokens / aceTotalTokens
    : null;
