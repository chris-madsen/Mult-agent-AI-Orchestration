export const codexAuthenticationRoute = 'CODEX_FORCE_AUTH_JSON=1 with the host Codex auth route; credentials are not retained';

export type CodexAuthenticationCheck = {
  readonly status: 'ready' | 'not_ready';
  readonly reason: string;
  readonly identity?: string;
  readonly authenticationRoute?: typeof codexAuthenticationRoute;
};

type JsonObject = Readonly<Record<string, unknown>>;

const object = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const codexIdTokenIsLoadable = (value: unknown): boolean => {
  if (!nonEmpty(value)) return false;
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1] as string, 'base64url').toString('utf8')) as unknown;
    return object(payload) !== undefined;
  } catch {
    return false;
  }
};

export const inspectCodexAuthJson = (authPath: string, contents: string): CodexAuthenticationCheck => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    return { status: 'not_ready', reason: 'Codex auth file is not valid JSON' };
  }
  const root = object(parsed);
  const tokens = object(root?.tokens);
  const authMode = root?.auth_mode;
  const hasAccessToken = nonEmpty(tokens?.access_token);
  const hasRefreshToken = nonEmpty(tokens?.refresh_token);
  const hasLoadableIdToken = codexIdTokenIsLoadable(tokens?.id_token);
  const refreshMetadata = root?.last_refresh;
  const hasRefreshMetadata = nonEmpty(refreshMetadata)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(refreshMetadata)
    && Number.isFinite(Date.parse(refreshMetadata));
  if (authMode !== 'chatgpt' || !hasAccessToken || !hasRefreshToken || !hasLoadableIdToken || !hasRefreshMetadata) {
    return { status: 'not_ready', reason: 'Codex auth file does not contain complete ChatGPT OAuth access/refresh state' };
  }
  return {
    status: 'ready',
    reason: 'Codex ChatGPT OAuth auth file is present; token bytes are not retained',
    identity: authPath,
    authenticationRoute: codexAuthenticationRoute,
  };
};


export interface FeedbackPreflightBindingInput {
  readonly currentSourceCommit: string;
  readonly actualHarborVersion: string;
  readonly expectedAuthenticationRoute: string;
  readonly jobModel: string;
  readonly jobReasoningEffort: 'low' | 'medium' | 'high';
  readonly experiment: {
    readonly sourceCommit: string;
    readonly model: string;
    readonly reasoningEffort: 'low' | 'medium' | 'high';
    readonly harborVersion: string;
    readonly authenticationRoute: string;
  };
}

export const validateFeedbackPreflightBinding = (
  input: FeedbackPreflightBindingInput,
): readonly string[] => {
  const failures: string[] = [];
  if (input.experiment.sourceCommit !== input.currentSourceCommit) failures.push('sourceCommit');
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
  if (taskImages.length > 0) {
    return taskImages.length === 1 && taskImages[0]?.digest === requested ? [] : ['imageDigest'];
  }
  return experimentImageDigest === undefined || experimentImageDigest === requested ? [] : ['imageDigest'];
};
