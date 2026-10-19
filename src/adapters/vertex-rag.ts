import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import { authorizeOutbound, type ProjectDataPolicy } from '../domain/policy.js';
import type { DocumentationPort, HttpPort } from '../application/ports.js';
import type { RetrievalEvidence } from '../domain/retrieval.js';
import { containsLikelySecret } from '../domain/sensitive-text.js';

export interface VertexRagConfig {
  readonly project: string;
  readonly location: string;
  readonly corpusId: string;
  readonly accessToken: () => string | undefined;
  readonly policy: ProjectDataPolicy;
  readonly http: HttpPort;
  readonly authorizedPaths?: readonly string[];
}

/** Google Vertex RAG Engine projects.locations.retrieveContexts, official v1beta1 shape. */
export const makeVertexRagRetrievalPort = (config: VertexRagConfig): DocumentationPort => ({
  search: (input): Effect.Effect<Result<readonly RetrievalEvidence[], DomainError>> => Effect.gen(function* () {
    const policy = authorizeOutbound({
      workspaceId: input.workspaceId, operation: 'documentation_search',
      destination: 'vertex', dataClasses: ['project_document'],
      paths: config.authorizedPaths ?? [], secretDetected: containsLikelySecret(input.query),
    }, config.policy);
    if (policy._tag === 'Err') return policy;
    if (policy.value.outcome !== 'allowed') return err(domainError('POLICY_DENIED', 'vertex', policy.value.reasonCode));
    const token = config.accessToken();
    if (token === undefined || token.trim().length === 0) return err(domainError('AUTH_REQUIRED', 'vertex', 'OAuth token required'));
    const { project, location, corpusId } = config;
    if (![project, location, corpusId].every((x) => /^[a-zA-Z0-9_-]+$/u.test(x))) {
      return err(domainError('INVALID_INPUT', 'vertex', 'invalid resource name'));
    }
    const parent = `projects/${project}/locations/${location}`;
    const response = yield* config.http.request({
      method: 'POST',
      url: `https://${location}-aiplatform.googleapis.com/v1beta1/${parent}:retrieveContexts`,
      headers: { authorization: `Bearer ${token}` },
      body: {
        vertexRagStore: { ragResources: [{ ragCorpus: `${parent}/ragCorpora/${corpusId}` }] },
        query: { text: input.query, ragRetrievalConfig: { topK: input.topK } },
      },
      timeoutMs: 30_000,
    });
    if (response._tag === 'Err') return response;
    if (response.value.status < 200 || response.value.status >= 300) {
      return err(domainError('EXTERNAL_UNAVAILABLE', 'vertex', `retrieveContexts returned HTTP ${response.value.status}`));
    }
    const outer = response.value.body;
    if (typeof outer !== 'object' || outer === null || Array.isArray(outer)) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'vertex', 'RAG response must be object'));
    }
    const group = (outer as { contexts?: unknown }).contexts;
    const contexts = typeof group === 'object' && group !== null && !Array.isArray(group)
      ? (group as { contexts?: unknown }).contexts
      : Object.keys(outer as Record<string, unknown>).length === 0 ? [] : undefined;
    if (!Array.isArray(contexts)) return err(domainError('INVALID_EXTERNAL_RESPONSE', 'vertex', 'contexts.contexts must be array'));
    const results: RetrievalEvidence[] = [];
    for (const [i, raw] of contexts.entries()) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return err(domainError('INVALID_EXTERNAL_RESPONSE', `contexts[${i}]`, 'invalid chunk'));
      const item = raw as { text?: unknown; sourceUri?: unknown; sourceDisplayName?: unknown };
      if (typeof item.text !== 'string' || typeof item.sourceUri !== 'string' || item.text.length === 0) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', `contexts[${i}]`, 'missing sourceUri or text'));
      }
      // Chunk is a projection of corpus content, not a verified current code file.
      results.push({
        evidenceId: createHash('sha256').update(`${item.sourceUri}:${i}:${item.text}`).digest('hex') as RetrievalEvidence['evidenceId'],
        source: 'documentation', citation: item.sourceUri,
        content: item.text, proofClass: 'derived', freshness: 'unknown',
      });
    }
    return ok(results);
  }),
});
