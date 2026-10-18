import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  evidenceFromCandidate,
  makeEvidenceId,
  makeRequestId,
  mergeEvidence,
  type CodeIndex,
  type ContextBundle,
  type RetrievalEvidence,
} from '../domain/retrieval.js';
import type {
  ArtifactStore,
  CodeCandidatePort,
  CodePoint,
  HttpPort,
  SemanticAnalysisPort,
  WorkspaceFilePort,
} from '../application/ports.js';
import type { RepoPath, WorkspaceId } from '../domain/workspace.js';
import type { VectorEmbeddingPort } from './ollama-embedding.js';

export interface QdrantContextConfig {
  readonly workspaceId: WorkspaceId;
  readonly rootPath: string;
  readonly files: WorkspaceFilePort;
  readonly qdrant: CodeCandidatePort;
  readonly embeddings: VectorEmbeddingPort;
  readonly artifacts: ArtifactStore;
  readonly semantics: SemanticAnalysisPort;
  readonly newRequestId: () => string;
}

export const populateQdrantFromStructuralIndex = (
  index: CodeIndex,
  qdrant: CodeCandidatePort,
  embeddings: VectorEmbeddingPort,
): Effect.Effect<Result<number, DomainError>> => Effect.gen(function* () {
  if (index.candidates.length === 0) {
    return err(domainError('UNSUPPORTED_PROVIDER', 'index', 'no verified structural candidates available for Qdrant'));
  }
  let count = 0;
  for (let offset = 0; offset < index.candidates.length; offset += 16) {
    const candidates = index.candidates.slice(offset, offset + 16);
    const vectors = yield* embeddings.embedMany(candidates.map((candidate) => candidate.text));
    if (vectors._tag === 'Err') return vectors;
    if (vectors.value.length !== candidates.length) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding', 'embedding batch size mismatch'));
    }
    const points: CodePoint[] = candidates.map((candidate, i) => ({
      candidate,
      vector: vectors.value[i] ?? [],
    }));
    const result = yield* qdrant.upsert(points);
    if (result._tag === 'Err') return result;
    count += candidates.length;
  }
  return ok(count);
});

// Index creation never deletes or silently replaces an existing collection.
// The vector dimension must match the configured real embedding model.
export const ensureQdrantCollection = (
  http: HttpPort,
  baseUrl: string,
  collection: string,
  dimension: number,
  apiKey?: string,
): Effect.Effect<Result<void, DomainError>> => Effect.gen(function* () {
  if (!Number.isSafeInteger(dimension) || dimension < 1) {
    return err(domainError('INVALID_INPUT', 'vector_dimension', 'invalid embedding dimension'));
  }
  const url = baseUrl.replace(/\/$/u, '') + '/collections/' + encodeURIComponent(collection);
  const headers = apiKey === undefined ? {} : { 'api-key': apiKey };
  const found = yield* http.request({ method: 'GET', url, headers });
  if (found._tag === 'Err') return found;
  if (found.value.status === 200) {
    const body = found.value.body as { result?: { config?: { params?: { vectors?: { size?: number } } } } };
    const configured = body?.result?.config?.params?.vectors?.size;
    if (configured !== dimension) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'qdrant', 'collection vector dimension does not match approved embedding model'));
    }
    return ok(undefined);
  }
  if (found.value.status !== 404) {
    return err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'cannot inspect collection: HTTP ' + found.value.status));
  }
  const created = yield* http.request({
    method: 'PUT', url, headers, body: { vectors: { size: dimension, distance: 'Cosine' } },
  });
  if (created._tag === 'Err') return created;
  return created.value.status >= 200 && created.value.status < 300
    ? ok(undefined)
    : err(domainError('EXTERNAL_UNAVAILABLE', 'qdrant', 'could not create dedicated collection'));
});

export const makeQdrantContextProvider = (config: QdrantContextConfig) => ({
  search: (input: {
    readonly workspaceId: WorkspaceId;
    readonly query: string;
    readonly includeDocs: boolean;
    readonly includeMemory: boolean;
  }): Effect.Effect<Result<ContextBundle, DomainError>> => Effect.gen(function* () {
    if (input.workspaceId !== config.workspaceId) {
      return err(domainError('POLICY_DENIED', 'workspace_id', 'Qdrant provider belongs to another workspace'));
    }
    const requestId = makeRequestId(config.newRequestId());
    if (requestId._tag === 'Err') return requestId;
    const vectors = yield* config.embeddings.embedMany([input.query]);
    if (vectors._tag === 'Err') return vectors;
    const vector = vectors.value[0];
    if (vector === undefined) return err(domainError('INVALID_EXTERNAL_RESPONSE', 'embedding', 'empty query vector'));
    const result = yield* config.qdrant.search({ workspaceId: input.workspaceId, vector, limit: 12 });
    if (result._tag === 'Err') return result;

    const evidence: RetrievalEvidence[] = [];
    const warnings: string[] = [];
    const failed: string[] = [];
    const fullSources = new Map<RepoPath, { readonly bytes: Uint8Array; readonly digest: string; readonly handle: string }>();

    for (const [i, ranked] of result.value.entries()) {
      const candidate = ranked.candidate;
      const read = yield* config.files.readExact(config.rootPath, candidate.repoPath);
      if (read._tag === 'Err') {
        warnings.push(candidate.repoPath + ': ' + read.error.code);
        failed.push('code');
        continue;
      }
      let full = fullSources.get(candidate.repoPath);
      if (full === undefined) {
        const stored = yield* config.artifacts.storeExact(read.value.bytes);
        if (stored._tag === 'Err') return stored;
        full = { bytes: read.value.bytes, digest: read.value.digest, handle: stored.value.handle };
        fullSources.set(candidate.repoPath, full);
      }
      // Qdrant payload is not authoritative even when its vector score is high.
      const freshness = full.digest === candidate.sourceDigest ? 'current' : 'stale';
      if (freshness !== 'current') {
        warnings.push(candidate.repoPath + ': indexed digest is stale');
        failed.push('code');
      }
      const evidenceId = makeEvidenceId('qdrant-code-' + (i + 1));
      if (evidenceId._tag === 'Err') return evidenceId;
      evidence.push({
        ...evidenceFromCandidate({ ...ranked, freshness }, evidenceId.value),
        expansionHandle: full.handle,
      });

      if (freshness !== 'current' || candidate.symbolName === undefined) continue;
      const sourceLines = Buffer.from(full.bytes).toString('utf8').split('\n');
      const line = sourceLines[candidate.range.startLine - 1] ?? '';
      const nameColumn = line.indexOf(candidate.symbolName);
      if (nameColumn < 0) {
        warnings.push(candidate.repoPath + ': symbol identity unresolved at candidate range');
        failed.push('lsp');
        continue;
      }
      const definitions = yield* config.semantics.definition({
        repoPath: candidate.repoPath,
        line: candidate.range.startLine,
        column: nameColumn + 1,
      });
      if (definitions._tag === 'Err') {
        warnings.push(candidate.repoPath + ': language service unavailable (' + definitions.error.code + ')');
        failed.push('lsp');
        continue;
      }
      if (definitions.value.length === 0) {
        warnings.push(candidate.repoPath + ': language service could not establish definition');
        failed.push('lsp');
      }
    }

    // A second exact read guards against edits during the multi-provider call.
    for (const [path, original] of fullSources) {
      const current = yield* config.files.readExact(config.rootPath, path);
      if (current._tag === 'Err' || current.value.digest !== original.digest) {
        warnings.push(path + ': source changed during retrieval');
        failed.push('code');
        for (let i = 0; i < evidence.length; i += 1) {
          if (evidence[i]?.citation.startsWith(path + ':')) {
            const existing = evidence[i];
            if (existing !== undefined) evidence[i] = { ...existing, freshness: 'changed_during_request', proofClass: 'uncertain' };
          }
        }
      }
    }
    if (input.includeDocs) { warnings.push('documentation provider not configured'); failed.push('documentation'); }
    if (input.includeMemory) { warnings.push('memory provider not configured'); failed.push('memory'); }
    return ok(mergeEvidence(requestId.value, input.query, evidence, warnings, failed));
  }),
});
