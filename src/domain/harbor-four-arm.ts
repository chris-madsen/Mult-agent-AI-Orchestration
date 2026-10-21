import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import { normalizeHarborJob, type NormalizedHarborJob } from './harbor-three-arm.js';

export type HarborFourArmName = 'native' | 'dense' | 'hybrid' | 'hybrid-delta';

export interface HarborFourArmDesign {
  readonly native: NormalizedHarborJob;
  readonly dense: NormalizedHarborJob;
  readonly hybrid: NormalizedHarborJob;
  readonly hybridDelta: NormalizedHarborJob;
  readonly distinctTaskCount: number;
  readonly tasksPerRepository: Readonly<Record<string, number>>;
}

export interface HarborFourArmValidationOptions {
  /** Repository IDs must be supplied by the external benchmark composition. */
  readonly repositoryIds: readonly string[];
  /** Final external jobs must bind the task manifest and exact source revisions. */
  readonly requireExternalEvidence?: boolean;
}

const repositoryForTask = (task: string, repositoryIds: readonly string[]): string | undefined => {
  const segments = task.split(/[\\/]/u).filter((segment) => segment.length > 0);
  return repositoryIds.find((repositoryId) => {
    const escaped = repositoryId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const marker = new RegExp(`(?:^|[-_])${escaped}(?:[-_]|$)`, 'u');
    return segments.some((segment) => marker.test(segment));
  });
};

const configHas = (job: NormalizedHarborJob, pattern: RegExp): boolean =>
  job.codexConfig !== undefined && pattern.test(job.codexConfig);

export const validateHarborFourArmDesign = (
  nativeValue: unknown,
  denseValue: unknown,
  hybridValue: unknown,
  hybridDeltaValue: unknown,
  options: HarborFourArmValidationOptions,
): Result<HarborFourArmDesign, DomainError> => {
  const repositoryIds = [...new Set(options.repositoryIds.map((repositoryId) => repositoryId.trim()))]
    .filter((repositoryId) => repositoryId.length > 0);
  if (repositoryIds.length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.repositories', 'at least one repository ID must be configured'));
  }
  const native = normalizeHarborJob('native', nativeValue);
  const dense = normalizeHarborJob('dense', denseValue);
  const hybrid = normalizeHarborJob('hybrid', hybridValue);
  const hybridDelta = normalizeHarborJob('hybrid-delta', hybridDeltaValue);
  if (native._tag === 'Err') return native;
  if (dense._tag === 'Err') return dense;
  if (hybrid._tag === 'Err') return hybrid;
  if (hybridDelta._tag === 'Err') return hybridDelta;
  const jobs = [native.value, dense.value, hybrid.value, hybridDelta.value];
  const sameTasks = jobs.slice(1).every((job) => JSON.stringify(job.tasks) === JSON.stringify(native.value.tasks));
  if (!sameTasks) return err(domainError('INVALID_BENCHMARK', 'harbor_job.tasks', 'all four arms must use one identical ordered task list'));
  if (!jobs.slice(1).every((job) => job.modelName === native.value.modelName)) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.model', 'all four arms must pin one Codex model'));
  }
  if (!jobs.slice(1).every((job) => job.reasoningEffort === native.value.reasoningEffort)) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.reasoning', 'all four arms must pin one reasoning effort'));
  }
  if (jobs.some((job) => job.extraInstructions.length > 0)) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.extra_instructions', 'four-arm natural benchmark must not force an ACE call'));
  }
  if (options.requireExternalEvidence === true) {
    const evidence = jobs.map((job) => job.externalEvidence);
    if (evidence.some((item) => item === undefined)
      || new Set(evidence.map((item) => item?.taskManifestSha256)).size !== 1
      || new Set(evidence.map((item) => item?.taskBytesSha256)).size !== 1
      || repositoryIds.some((repositoryId) => jobs.some((job) => job.externalEvidence?.repositoryRevisions[repositoryId] === undefined))) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'harbor_job.external_evidence',
        'external four-arm jobs must bind one task manifest, task byte set and every configured repository revision',
      ));
    }
    const referenceRevisions = evidence[0]?.repositoryRevisions;
    if (referenceRevisions === undefined
      || JSON.stringify(Object.keys(referenceRevisions).sort()) !== JSON.stringify([...repositoryIds].sort())
      || repositoryIds.some((repositoryId) => jobs.some((job) =>
        job.externalEvidence?.repositoryRevisions[repositoryId] !== referenceRevisions[repositoryId]))) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'harbor_job.external_evidence.repository_revisions',
        'all external four-arm jobs must bind identical repository revisions',
      ));
    }
    const reference = evidence[0];
    if (reference === undefined || evidence.some((item) => item === undefined
      || JSON.stringify(item?.taskBindings) !== JSON.stringify(reference.taskBindings)
      || item?.taskManifestPath !== reference.taskManifestPath
      || item?.modelIdentity !== reference.modelIdentity
      || item?.providerIdentity !== reference.providerIdentity
      || item?.runtimeImageIdentity !== reference.runtimeImageIdentity
      || item?.codexConfig.effectiveSha256 === undefined)) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'harbor_job.external_evidence',
        'external four-arm jobs must bind identical task bytes and model/provider/runtime identities',
      ));
    }
    const taskBindingPaths = new Set(reference.taskBindings.map((binding) => binding.path));
    if (native.value.tasks.some((task) => !taskBindingPaths.has(task))) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'harbor_job.external_evidence.task_bindings',
        'every effective task path must be present in the frozen task byte bindings',
      ));
    }
    if (jobs.some((job) => {
      const config = job.externalEvidence?.codexConfig;
      return config === undefined
        || (job.codexConfig === undefined
          ? config.path !== null || config.bytesSha256 !== null
          : config.path !== job.codexConfig || config.bytesSha256 === null);
    })) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'harbor_job.external_evidence.codex_config',
        'each arm must bind the exact effective Codex/MCP config path and bytes; native must bind explicit no-config',
      ));
    }
  }
  if (native.value.codexConfig !== undefined
    || !configHas(dense.value, /dense/iu)
    || !configHas(hybrid.value, /hybrid/iu)
    || !configHas(hybridDelta.value, /delta/iu)) {
    return err(domainError(
      'INVALID_BENCHMARK',
      'harbor_job.ace_config',
      'native must have no ACE config and dense, hybrid, and delta arms must identify their frozen strategy configs',
    ));
  }
  const distinctTaskCount = new Set(native.value.tasks).size;
  const counts: Record<string, number> = Object.fromEntries(repositoryIds.map((repositoryId) => [repositoryId, 0]));
  const boundRepositoryByPath = options.requireExternalEvidence === true
    ? new Map((native.value.externalEvidence?.taskBindings ?? []).map((binding) => [binding.path, binding.repositoryId]))
    : undefined;
  for (const task of native.value.tasks) {
    const repository = boundRepositoryByPath?.get(task) ?? repositoryForTask(task, repositoryIds);
    if (repository === undefined) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'harbor_job.tasks',
        `task path does not identify one of the configured repositories (${repositoryIds.join(', ')}): ${task}`,
      ));
    }
    counts[repository] = (counts[repository] ?? 0) + 1;
  }
  if (distinctTaskCount < repositoryIds.length * 3 || repositoryIds.some((repositoryId) => (counts[repositoryId] ?? 0) < 3)) {
    return err(domainError(
      'INVALID_BENCHMARK',
      'harbor_job.tasks',
      'four-arm workload requires at least three distinct tasks per configured repository',
    ));
  }
  const repeatCounts = new Map(native.value.tasks.map((task) => [task, 0]));
  for (const task of native.value.tasks) repeatCounts.set(task, (repeatCounts.get(task) ?? 0) + 1);
  if ([...repeatCounts.values()].some((count) => count !== 5)) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.tasks', 'four-arm workload requires exactly five serial repeats per task'));
  }
  return ok({
    native: native.value,
    dense: dense.value,
    hybrid: hybrid.value,
    hybridDelta: hybridDelta.value,
    distinctTaskCount,
    tasksPerRepository: counts,
  });
};

export interface HarborFourArmReportArm {
  readonly trials: number;
  readonly successes: number;
  readonly taskNames: readonly string[];
  readonly rawInputTokens: number | null;
  readonly rawOutputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly aceObservedCalls: number;
  readonly nativeFileReads: number;
  readonly uniqueContextBytes: number;
  readonly newContextBytes: number;
  readonly reusedContextBytes: number;
  readonly duplicateContextAvoided: number;
  readonly latencyP95Ms: number;
  readonly failureCount: number;
  readonly timeoutCount: number;
}

export interface HarborFourArmReport {
  readonly schemaVersion: 1;
  readonly holdoutSha256: string;
  readonly qualityNonInferior: boolean;
  readonly rawTracePaths: readonly string[];
  readonly usageEventPaths: readonly string[];
  readonly failedRunPaths: readonly string[];
  readonly costTelemetryComplete: boolean;
  readonly arms: Readonly<Record<HarborFourArmName, HarborFourArmReportArm>>;
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const nonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableNonNegative = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

const normalizeArm = (value: unknown, name: string): Result<HarborFourArmReportArm, DomainError> => {
  const arm = object(value);
  const taskNames = arm?.taskNames;
  const fields = ['trials', 'successes', 'aceObservedCalls', 'nativeFileReads', 'uniqueContextBytes', 'newContextBytes', 'reusedContextBytes', 'duplicateContextAvoided', 'failureCount', 'timeoutCount'];
  if (arm === undefined
    || !fields.every((field) => nonNegativeInteger(arm[field]))
    || !nonNegativeInteger(arm.trials) || arm.trials === 0
    || !nonNegativeInteger(arm.successes) || arm.successes > arm.trials
    || !Array.isArray(taskNames) || taskNames.length !== arm.trials
    || !taskNames.every((task) => typeof task === 'string' && task.trim().length > 0)
    || !nullableNonNegative(arm.rawInputTokens)
    || !nullableNonNegative(arm.rawOutputTokens)
    || !nullableNonNegative(arm.cachedInputTokens)
    || !nullableNonNegative(arm.latencyP95Ms)) {
    return err(domainError('INVALID_BENCHMARK', `harbor_report.arms.${name}`, 'four-arm report contains invalid counters'));
  }
  return ok({
    trials: arm.trials,
    successes: arm.successes,
    taskNames: taskNames as readonly string[],
    rawInputTokens: arm.rawInputTokens as number | null,
    rawOutputTokens: arm.rawOutputTokens as number | null,
    cachedInputTokens: arm.cachedInputTokens as number | null,
    aceObservedCalls: arm.aceObservedCalls as number,
    nativeFileReads: arm.nativeFileReads as number,
    uniqueContextBytes: arm.uniqueContextBytes as number,
    newContextBytes: arm.newContextBytes as number,
    reusedContextBytes: arm.reusedContextBytes as number,
    duplicateContextAvoided: arm.duplicateContextAvoided as number,
    latencyP95Ms: arm.latencyP95Ms as number,
    failureCount: arm.failureCount as number,
    timeoutCount: arm.timeoutCount as number,
  });
};

export const validateHarborFourArmReport = (value: unknown): Result<HarborFourArmReport, DomainError> => {
  const root = object(value);
  if (root?.schemaVersion !== 1 || !sha256(root.holdoutSha256)
    || root.qualityNonInferior !== true
    || !Array.isArray(root.rawTracePaths) || root.rawTracePaths.length === 0
    || !root.rawTracePaths.every((path) => typeof path === 'string' && path.trim().length > 0)
    || !Array.isArray(root.usageEventPaths) || root.usageEventPaths.length === 0
    || !root.usageEventPaths.every((path) => typeof path === 'string' && path.trim().length > 0)
    || !Array.isArray(root.failedRunPaths)
    || root.costTelemetryComplete !== true) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_report', 'four-arm report requires quality, raw trace, usage, failure and complete cost evidence'));
  }
  const armsRoot = object(root.arms);
  if (armsRoot === undefined) return err(domainError('INVALID_BENCHMARK', 'harbor_report.arms', 'four arms are required'));
  const names: readonly HarborFourArmName[] = ['native', 'dense', 'hybrid', 'hybrid-delta'];
  const normalized = new Map<HarborFourArmName, HarborFourArmReportArm>();
  for (const name of names) {
    const arm = normalizeArm(armsRoot[name], name);
    if (arm._tag === 'Err') return arm;
    normalized.set(name, arm.value);
  }
  const native = normalized.get('native') as HarborFourArmReportArm;
  const dense = normalized.get('dense') as HarborFourArmReportArm;
  const hybrid = normalized.get('hybrid') as HarborFourArmReportArm;
  const delta = normalized.get('hybrid-delta') as HarborFourArmReportArm;
  if (![dense, hybrid, delta].every((arm) => arm.aceObservedCalls > 0)) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_report.aceObservedCalls', 'all ACE arms require observed real ACE calls'));
  }
  if (delta.reusedContextBytes === 0) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_report.hybrid_delta', 'receipt/delta arm requires observed reused context bytes'));
  }
  if (![dense, hybrid, delta].every((arm) => JSON.stringify(arm.taskNames) === JSON.stringify(native.taskNames))) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_report.taskNames', 'all arms must report the same ordered trials'));
  }
  if (dense.trials !== native.trials || hybrid.trials !== native.trials || delta.trials !== native.trials) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_report.trials', 'all arms must have equal trial counts'));
  }
  return ok({
    schemaVersion: 1,
    holdoutSha256: root.holdoutSha256,
    qualityNonInferior: true,
    rawTracePaths: root.rawTracePaths as readonly string[],
    usageEventPaths: root.usageEventPaths as readonly string[],
    failedRunPaths: root.failedRunPaths as readonly string[],
    costTelemetryComplete: true,
    arms: {
      native,
      dense,
      hybrid,
      'hybrid-delta': delta,
    },
  });
};
