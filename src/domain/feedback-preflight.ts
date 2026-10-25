export const hermesCodexAuthenticationRoute = 'Hermes openai-codex uses a dedicated host ~/.hermes/auth.json and synchronizes refreshed OAuth state back after each serial Harbor trial; credentials are not retained in benchmark artifacts';

export type FeedbackVerifierReadinessStatus =
  | 'ready'
  | 'missing_configuration'
  | 'invalid_configuration'
  | 'authentication_rejected'
  | 'unavailable';

export interface FeedbackVerifierReadiness {
  readonly status: FeedbackVerifierReadinessStatus;
  readonly reason: string;
  readonly identity?: string;
}

const verifierIdentity = (baseUrl: string, model: string): string =>
  `${baseUrl.replace(/\/$/u, '')}#model=${model}`;

const placeholder = (value: string): boolean =>
  value.includes('${') || value === '***' || value === '[REDACTED]' || value === 'changeme';

export const inspectFeedbackVerifierConfiguration = (input: {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly model?: string;
}): FeedbackVerifierReadiness => {
  const apiKey = input.apiKey?.trim();
  const baseUrl = input.baseUrl?.trim();
  const model = input.model?.trim();
  if (apiKey === undefined || apiKey.length === 0 || baseUrl === undefined || baseUrl.length === 0
    || model === undefined || model.length === 0) {
    return { status: 'missing_configuration', reason: 'task verifier configuration is incomplete' };
  }
  if (placeholder(apiKey) || placeholder(baseUrl) || placeholder(model)) {
    return { status: 'invalid_configuration', reason: 'task verifier configuration contains an unresolved placeholder' };
  }
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
  } catch {
    return { status: 'invalid_configuration', reason: 'task verifier endpoint is not a valid HTTP(S) URL' };
  }
  return {
    status: 'ready',
    reason: 'task verifier configuration is present',
    identity: verifierIdentity(baseUrl, model),
  };
};

export const classifyFeedbackVerifierHttpStatus = (
  status: number,
  identity: string,
): FeedbackVerifierReadiness => {
  if (status >= 200 && status < 300) return { status: 'ready', reason: 'task verifier endpoint accepted the readiness probe', identity };
  if (status === 401 || status === 403) return { status: 'authentication_rejected', reason: 'task verifier endpoint rejected authentication', identity };
  if (status === 400 || status === 404) return { status: 'invalid_configuration', reason: 'task verifier endpoint rejected the configured request', identity };
  return { status: 'unavailable', reason: 'task verifier endpoint is unavailable', identity };
};

export type HermesAuthenticationCheck = {
  readonly status: 'ready' | 'not_ready';
  readonly reason: string;
  readonly identity?: string;
  readonly authenticationRoute?: typeof hermesCodexAuthenticationRoute;
};

type JsonObject = Readonly<Record<string, unknown>>;
const object = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export const inspectHermesAuthJson = (authPath: string, contents: string): HermesAuthenticationCheck => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    return { status: 'not_ready', reason: 'Hermes auth file is not valid JSON' };
  }
  const root = object(parsed);
  const providers = object(root?.providers);
  const legacy = object(providers?.['openai-codex']);
  const legacyTokens = object(legacy?.tokens);
  const pool = object(root?.credential_pool);
  const currentEntries = Array.isArray(pool?.['openai-codex']) ? pool?.['openai-codex'] : [];
  const current = currentEntries.map(object).find((entry): entry is JsonObject => entry !== undefined);
  const currentAccess = nonEmpty(current?.access_token);
  const currentRefresh = nonEmpty(current?.refresh_token);
  const legacyAccess = nonEmpty(legacyTokens?.access_token);
  const legacyRefresh = nonEmpty(legacyTokens?.refresh_token);
  const authModeValid = legacy?.auth_mode === 'chatgpt' || current?.auth_type === 'oauth';
  const hasAccessToken = currentAccess || legacyAccess;
  const hasRefreshToken = currentRefresh || legacyRefresh;
  const refreshMetadata = current?.last_refresh ?? legacy?.last_refresh;
  const hasRefreshMetadata = nonEmpty(refreshMetadata)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(refreshMetadata)
    && Number.isFinite(Date.parse(refreshMetadata));
  if (!authModeValid || !hasAccessToken || !hasRefreshToken || !hasRefreshMetadata) {
    return {
      status: 'not_ready',
      reason: 'Hermes auth file does not contain a complete independent openai-codex ChatGPT OAuth session',
    };
  }
  return {
    status: 'ready',
    reason: 'Dedicated Hermes ChatGPT OAuth state is ready; token bytes are not retained',
    identity: authPath,
    authenticationRoute: hermesCodexAuthenticationRoute,
  };
};

export interface FeedbackPreflightBindingInput {
  readonly currentSourceCommit: string;
  readonly actualHarborVersion: string;
  readonly expectedAuthenticationRoute: string;
  readonly jobAgent: 'hermes';
  readonly jobAgentVersion: string;
  readonly jobModel: string;
  readonly jobReasoningEffort: 'low' | 'medium' | 'high';
  readonly experiment: {
    readonly sourceCommit: string;
    readonly agent: 'hermes';
    readonly agentVersion: string;
    readonly model: string;
    readonly reasoningEffort: 'low' | 'medium' | 'high';
    readonly harborVersion: string;
    readonly authenticationRoute: string;
  };
}

export const validateFeedbackPreflightBinding = (input: FeedbackPreflightBindingInput): readonly string[] => {
  const failures: string[] = [];
  if (input.experiment.sourceCommit !== input.currentSourceCommit) failures.push('sourceCommit');
  if (input.experiment.agent !== input.jobAgent) failures.push('agent');
  if (input.experiment.agentVersion !== input.jobAgentVersion) failures.push('agentVersion');
  if (input.experiment.model !== input.jobModel) failures.push('model');
  if (input.experiment.reasoningEffort !== input.jobReasoningEffort) failures.push('reasoningEffort');
  if (input.experiment.harborVersion !== input.actualHarborVersion) failures.push('harborVersion');
  if (input.experiment.authenticationRoute !== input.expectedAuthenticationRoute) failures.push('authenticationRoute');
  return failures;
};

export const validateFeedbackImageOverride = (
  requested: string | undefined,
  experimentImageDigest: string | undefined,
  taskImages: readonly { readonly reference: string; readonly digest: string }[],
): readonly string[] => {
  if (requested === undefined) return [];
  if (taskImages.length > 0) return taskImages.length === 1 && taskImages[0]?.digest === requested ? [] : ['imageDigest'];
  return experimentImageDigest === undefined || experimentImageDigest === requested ? [] : ['imageDigest'];
};
