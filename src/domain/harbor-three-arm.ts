import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type HarborArm = 'native' | 'ace-natural' | 'ace-forced';

export interface NormalizedHarborJob {
  readonly arm: HarborArm;
  readonly tasks: readonly string[];
  readonly modelName: string;
  readonly reasoningEffort: string;
  readonly codexConfig?: string;
  readonly extraInstructions: readonly string[];
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const forcedAceInstruction = (instructions: readonly string[]): boolean =>
  instructions.some((instruction) =>
    /(?:before editing|must|require|mandatory).*?(?:ace_context|call.*?ace)/iu.test(instruction));

export const normalizeHarborJob = (
  arm: HarborArm,
  value: unknown,
): Result<NormalizedHarborJob, DomainError> => {
  const root = object(value);
  const agents = Array.isArray(root?.agents) ? root.agents : undefined;
  const agent = agents?.length === 1 ? object(agents[0]) : undefined;
  const kwargs = object(agent?.kwargs);
  const tasksRaw = Array.isArray(root?.tasks) ? root.tasks : undefined;
  if (agent === undefined || kwargs === undefined || tasksRaw === undefined || tasksRaw.length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job', 'job must contain one Codex agent and at least one task'));
  }
  if (agent.name !== 'codex' || typeof agent.model_name !== 'string' || agent.model_name.trim().length === 0
    || typeof kwargs.reasoning_effort !== 'string' || kwargs.reasoning_effort.trim().length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.agent', 'Codex model and reasoning effort must be explicit'));
  }
  const tasks: string[] = [];
  for (const [index, raw] of tasksRaw.entries()) {
    const task = object(raw);
    if (typeof task?.path !== 'string' || task.path.trim().length === 0) {
      return err(domainError('INVALID_BENCHMARK', `harbor_job.tasks[${index}]`, 'task path must be explicit'));
    }
    tasks.push(task.path.trim());
  }
  const extraRaw = root.extra_instructions ?? [];
  if (!Array.isArray(extraRaw) || !extraRaw.every((entry) => typeof entry === 'string')) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.extra_instructions', 'extra instructions must be a string array'));
  }
  const codexConfig = typeof kwargs.config === 'string' && kwargs.config.trim().length > 0
    ? kwargs.config.trim()
    : undefined;
  return ok({
    arm,
    tasks,
    modelName: agent.model_name.trim(),
    reasoningEffort: kwargs.reasoning_effort.trim(),
    ...(codexConfig === undefined ? {} : { codexConfig }),
    extraInstructions: extraRaw.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
  });
};

export interface ThreeArmDesign {
  readonly native: NormalizedHarborJob;
  readonly natural: NormalizedHarborJob;
  readonly forced: NormalizedHarborJob;
  readonly distinctTaskCount: number;
}

export const validateThreeArmDesign = (
  nativeValue: unknown,
  naturalValue: unknown,
  forcedValue: unknown,
): Result<ThreeArmDesign, DomainError> => {
  const native = normalizeHarborJob('native', nativeValue);
  const natural = normalizeHarborJob('ace-natural', naturalValue);
  const forced = normalizeHarborJob('ace-forced', forcedValue);
  if (native._tag === 'Err') return native;
  if (natural._tag === 'Err') return natural;
  if (forced._tag === 'Err') return forced;

  const sameTasks = JSON.stringify(native.value.tasks) === JSON.stringify(natural.value.tasks)
    && JSON.stringify(native.value.tasks) === JSON.stringify(forced.value.tasks);
  if (!sameTasks) return err(domainError('INVALID_BENCHMARK', 'harbor_job.tasks', 'all three arms must use the identical ordered task list'));
  if (native.value.modelName !== natural.value.modelName || native.value.modelName !== forced.value.modelName) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.model', 'all three arms must pin the same Codex model'));
  }
  if (native.value.reasoningEffort !== natural.value.reasoningEffort
    || native.value.reasoningEffort !== forced.value.reasoningEffort) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.reasoning', 'all three arms must pin the same reasoning effort'));
  }
  if (native.value.extraInstructions.length !== 0 || natural.value.extraInstructions.length !== 0) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.natural_prompt', 'native and optional-natural arms must not add arm-specific task instructions'));
  }
  if (!forcedAceInstruction(forced.value.extraInstructions)) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.forced_prompt', 'forced diagnostic arm must explicitly require an ACE call'));
  }
  if (natural.value.codexConfig === undefined || forced.value.codexConfig !== natural.value.codexConfig) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.ace_config', 'natural and forced ACE arms must use the same Codex MCP config'));
  }
  const distinctTaskCount = new Set(native.value.tasks).size;
  if (distinctTaskCount < 3) {
    return err(domainError('INVALID_BENCHMARK', 'harbor_job.tasks', 'three-arm workload requires at least three distinct task paths'));
  }
  return ok({
    native: native.value,
    natural: natural.value,
    forced: forced.value,
    distinctTaskCount,
  });
};

export interface HarborPairReportSummary {
  readonly native: {
    readonly aggregateSha256: string;
    readonly trials: number;
    readonly successes: number;
    readonly taskNames: readonly string[];
    readonly rawTotalTokens: number | null;
    readonly costUsd: number | null;
  };
  readonly ace: {
    readonly trials: number;
    readonly successes: number;
    readonly taskNames: readonly string[];
    readonly rawTotalTokens: number | null;
    readonly costUsd: number | null;
    readonly aceObservedCalls: number;
    readonly aceCalls: number;
  };
  readonly paired: boolean;
  readonly qualityNonInferior: boolean;
  readonly evaluationDesign: string;
  readonly providerCorrelationVerified: boolean;
  readonly acceptance: string;
  readonly costScope?: string;
}

export interface ThreeArmOutcome {
  readonly naturalUse: 'not_observed' | 'observed_partial_only' | 'observed_complete';
  readonly forcedArm: 'diagnostic-only';
  readonly productionAcceptance: 'rejected' | 'diagnostic-only' | 'measured-not-necessarily-5x';
  readonly nativeTrials: number;
  readonly naturalTrials: number;
  readonly forcedTrials: number;
  readonly naturalQualityNonInferior: boolean;
  readonly naturalProviderCorrelationVerified: boolean;
  readonly naturalRawTokenRatioAceOverNative: number | null;
  readonly forcedRawTokenRatioAceOverNative: number | null;
  readonly costTelemetryComplete: boolean;
}

const ratioOrNull = (left: number | null, right: number | null): number | null =>
  left === null || right === null || right === 0 ? null : left / right;

export const assessThreeArmReports = (
  natural: HarborPairReportSummary,
  forced: HarborPairReportSummary,
): Result<ThreeArmOutcome, DomainError> => {
  if (natural.evaluationDesign !== 'optional-natural-tool-use') {
    return err(domainError('INVALID_BENCHMARK', 'natural_report', 'natural report must come from optional natural ACE configuration'));
  }
  if (forced.evaluationDesign !== 'forced-tool-use') {
    return err(domainError('INVALID_BENCHMARK', 'forced_report', 'forced report must come from forced ACE diagnostic configuration'));
  }
  if (natural.native.aggregateSha256 !== forced.native.aggregateSha256
    || natural.native.trials !== forced.native.trials
    || JSON.stringify(natural.native.taskNames) !== JSON.stringify(forced.native.taskNames)) {
    return err(domainError('INVALID_BENCHMARK', 'native_baseline', 'natural and forced comparisons must share the exact same native aggregate'));
  }
  if (!natural.paired || !forced.paired) {
    return err(domainError('INVALID_BENCHMARK', 'paired', 'both natural and forced reports must be paired'));
  }

  const naturalUse = natural.ace.aceObservedCalls === 0
    ? 'not_observed'
    : natural.ace.aceCalls === 0
      ? 'observed_partial_only'
      : 'observed_complete';
  const costTelemetryComplete = !/unmeasured|unknown|codex-reported-usage-only/iu.test(natural.costScope ?? 'unknown');
  const productionAcceptance: ThreeArmOutcome['productionAcceptance'] =
    naturalUse !== 'observed_complete' || !natural.qualityNonInferior
      ? 'rejected'
      : natural.providerCorrelationVerified && costTelemetryComplete
        ? 'measured-not-necessarily-5x'
        : 'diagnostic-only';

  return ok({
    naturalUse,
    forcedArm: 'diagnostic-only',
    productionAcceptance,
    nativeTrials: natural.native.trials,
    naturalTrials: natural.ace.trials,
    forcedTrials: forced.ace.trials,
    naturalQualityNonInferior: natural.qualityNonInferior,
    naturalProviderCorrelationVerified: natural.providerCorrelationVerified,
    naturalRawTokenRatioAceOverNative: ratioOrNull(natural.ace.rawTotalTokens, natural.native.rawTotalTokens),
    forcedRawTokenRatioAceOverNative: ratioOrNull(forced.ace.rawTotalTokens, forced.native.rawTotalTokens),
    costTelemetryComplete,
  });
};
