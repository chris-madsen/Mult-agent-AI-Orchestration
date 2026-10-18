import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type RouteSource = 'code' | 'structural' | 'documentation' | 'memory';
export type RoutingStrategy = 'deterministic' | 'jev_experimental';

export interface RouteRequest {
  readonly requestId: string;
  readonly query: string;
  readonly privateCode: boolean;
  readonly jevOptIn: boolean;
}

export interface RoutePlan {
  readonly strategy: RoutingStrategy;
  readonly sources: readonly RouteSource[];
  readonly rationale: readonly string[];
  readonly fallbackSources: readonly RouteSource[];
}

export interface RouteDecision {
  readonly outcome: 'selected' | 'blocked' | 'unavailable';
  readonly plan?: RoutePlan;
  readonly reason: string;
}

export interface ExperimentalRouter {
  readonly name: 'jev';
  readonly select: (request: RouteRequest) => Result<RoutePlan, DomainError>;
}

export interface RoutingComparison {
  readonly requestId: string;
  readonly reference: RoutePlan;
  readonly candidate: RouteDecision;
  readonly requiredSources: readonly RouteSource[];
  readonly candidateMissedSources: readonly RouteSource[];
  readonly qualityAccepted: boolean;
}

const hasAny = (query: string, terms: readonly string[]): boolean => terms.some((term) => query.toLocaleLowerCase().includes(term));

export const deterministicRoute = (request: RouteRequest): RoutePlan => {
  const query = request.query.toLocaleLowerCase();
  const exactFile = /(?:^|\s|\/)[\w.-]+\.(?:ts|tsx|js|jsx|rs|py)(?::\d+)?(?:\s|$)/u.test(request.query);
  const exactSymbol = /\b[a-z_$][\w$]*\s*(?:\(|function\b|method\b)/iu.test(request.query);
  const asksMemory = hasAny(query, ['decision', 'decided', 'alternative', 'session', 'discussion', 'memory', 'why did we']);
  const asksDocs = hasAny(query, ['adr', 'architecture', 'rationale', 'documentation', 'design']);
  const sources: RouteSource[] = [];
  if (exactFile || exactSymbol || !asksMemory && !asksDocs) sources.push('code');
  if (exactFile || exactSymbol || hasAny(query, ['type', 'reference', 'call', 'implementation', 'diagnostic'])) sources.push('structural');
  if (asksDocs) sources.push('documentation');
  if (asksMemory) sources.push('memory');
  const uniqueSources = [...new Set(sources)];
  if (uniqueSources.length === 0) uniqueSources.push('code');
  const fallbackSources: RouteSource[] = uniqueSources.includes('memory') ? ['code'] : ['structural'];
  return {
    strategy: 'deterministic',
    sources: uniqueSources,
    rationale: [
      exactFile ? 'request names a source file' : 'request has no exact source file',
      exactSymbol ? 'request contains a symbol-shaped expression' : 'request does not require exact symbol routing',
      asksMemory ? 'request asks for temporal/project memory' : 'request does not ask for project memory',
    ],
    fallbackSources,
  };
};

export const selectRoute = (request: RouteRequest, experimental?: ExperimentalRouter): Result<RouteDecision, DomainError> => {
  const reference = deterministicRoute(request);
  if (!request.jevOptIn || !request.privateCode) return ok({ outcome: 'selected', plan: reference, reason: 'deterministic reference strategy selected' });
  if (experimental === undefined) return ok({ outcome: 'blocked', reason: 'private-code Jev route requires an explicit available adapter' });
  const selected = experimental.select(request);
  if (selected._tag === 'Err') return ok({ outcome: 'unavailable', reason: selected.error.message });
  return ok({ outcome: 'selected', plan: selected.value, reason: 'explicitly opted-in experimental strategy selected' });
};

export const compareRoutes = (
  request: RouteRequest,
  requiredSources: readonly RouteSource[],
  candidate: RouteDecision,
): RoutingComparison => {
  const reference = deterministicRoute(request);
  const candidateSources = candidate.plan?.sources ?? [];
  const missed = requiredSources.filter((source) => !candidateSources.includes(source));
  return {
    requestId: request.requestId,
    reference,
    candidate,
    requiredSources: [...requiredSources],
    candidateMissedSources: missed,
    qualityAccepted: candidate.outcome === 'selected' && missed.length === 0,
  };
};

export const unsupportedJevRouter = (reason: string): ExperimentalRouter => ({
  name: 'jev',
  select: () => err(domainError('UNSUPPORTED_PROVIDER', 'jev', reason)),
});

export const routeEvidence = (comparison: RoutingComparison): Result<RoutingComparison, DomainError> => {
  if (comparison.candidate.outcome === 'selected' && comparison.candidate.plan === undefined) {
    return err(domainError('INVALID_ROUTING', 'candidate', 'selected route must include a plan'));
  }
  if (comparison.qualityAccepted && comparison.candidateMissedSources.length > 0) {
    return err(domainError('INVALID_ROUTING', 'quality', 'route cannot be accepted while required sources are missed'));
  }
  return ok(comparison);
};
