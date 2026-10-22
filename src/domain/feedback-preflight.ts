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
  const hasRefreshMetadata = nonEmpty(root?.last_refresh);
  if (authMode !== 'chatgpt' || !hasAccessToken || !hasRefreshToken || !hasRefreshMetadata) {
    return { status: 'not_ready', reason: 'Codex auth file does not contain complete ChatGPT OAuth access/refresh state' };
  }
  return {
    status: 'ready',
    reason: 'Codex ChatGPT OAuth auth file is present; token bytes are not retained',
    identity: authPath,
    authenticationRoute: codexAuthenticationRoute,
  };
};
