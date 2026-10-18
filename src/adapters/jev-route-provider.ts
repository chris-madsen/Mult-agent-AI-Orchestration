import { Effect } from 'effect';
import { authorizeOutbound, type ProjectDataPolicy } from '../domain/policy.js';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import { type RoutePlan, type RouteRequest, type RouteSource } from '../domain/routing.js';
import type { HttpPort } from '../application/ports.js';

interface JevConfig {
  readonly endpoint: string;
  readonly http: HttpPort;
  readonly policy: ProjectDataPolicy;
  readonly accessToken: () => string | undefined;
}

const sources: readonly RouteSource[] = ['code', 'structural', 'documentation', 'memory'];

const isSource = (value: unknown): value is RouteSource => typeof value === 'string' && sources.includes(value as RouteSource);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const selectJevRouteOverHttp = (
  config: JevConfig,
  request: RouteRequest,
): Effect.Effect<Result<RoutePlan, ReturnType<typeof domainError>>> => Effect.gen(function* () {
  const policy = authorizeOutbound({
    workspaceId: config.policy.workspaceId,
    operation: 'adaptive_route_selection',
    destination: 'jev',
    dataClasses: [request.privateCode ? 'private_source' : 'public'],
    paths: [],
    secretDetected: false,
  }, config.policy);
  if (policy._tag === 'Err') return policy;
  if (policy.value.outcome !== 'allowed') return err(domainError('POLICY_DENIED', 'jev', policy.value.reasonCode));
  const token = config.accessToken();
  if (token === undefined || token.trim() === '') return err(domainError('AUTH_REQUIRED', 'jev', 'Jev access token is unavailable'));
  const responseResult = yield* config.http.request({
    method: 'POST',
    url: config.endpoint,
    headers: { authorization: `Bearer ${token}` },
    body: { request_id: request.requestId, query: request.query },
  });
  if (responseResult._tag === 'Err') return responseResult;
  if (responseResult.value.status < 200 || responseResult.value.status >= 300) return err(domainError('EXTERNAL_UNAVAILABLE', 'jev', `external provider returned HTTP ${responseResult.value.status}`));
  const body = responseResult.value.body;
  if (!isRecord(body) || !Array.isArray(body.sources) || body.sources.length === 0 || body.sources.some((source) => !isSource(source))) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'sources', 'Jev response sources are invalid'));
  }
  const fallback = Array.isArray(body.fallback_sources) && body.fallback_sources.every(isSource)
    ? body.fallback_sources
    : ['structural'];
  return ok({
    strategy: 'jev_experimental',
    sources: [...new Set(body.sources)] as RouteSource[],
    rationale: [typeof body.rationale === 'string' ? body.rationale : 'Jev experimental route'],
    fallbackSources: [...new Set(fallback)] as RouteSource[],
  });
});
