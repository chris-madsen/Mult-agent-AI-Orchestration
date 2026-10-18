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
  readonly generation?: number;
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

/** Tree-sitter uses one-based line/column coordinates here, but columns count UTF-8 bytes.
 * Re-slice authoritative workspace bytes and compare them with the Qdrant payload.
 * Qdrant ranking never confers source-of-truth status. */
export const exactUtf8Span = (
  bytes: Uint8Array,
  range: { readonly startLine: number; readonly endLine: number; readonly startColumn?: number; readonly endColumn?: number },
): string | undefined => {
  if (range.startColumn === undefined || range.endColumn === undefined) return undefined;
  const raw = Buffer.from(bytes);
  const lineOffsets = [0];
  for (let i = 0; i < raw.length; i += 1) if (raw[i] === 10) lineOffsets.push(i + 1);
  const a = lineOffsets[range.startLine - 1];
  const b = lineOffsets[range.endLine - 1];
  if (a === undefined || b === undefined) return undefined;
  const from = a + range.startColumn - 1;
  const until = b + range.endColumn - 1;
  if (from < 0 || until <= from || until > raw.length) return undefined;
  return raw.subarray(from, until).toString('utf8');
};

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
    const result = yield* config.qdrant.search({ workspaceId: input.workspaceId, vector, limit: 12, ...(config.generation === undefined ? {} : { generation: config.generation }) });
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
      // Both the digest AND the byte-exact AST slice must match. Never deliver
      // unverified Qdrant payload as if it were the workspace's current source.
      const current = full.digest === candidate.sourceDigest;
      const verifiedText = exactUtf8Span(full.bytes, candidate.range);
      const verified = current && verifiedText !== undefined && verifiedText === candidate.text;
      const freshness = current ? (verified ? 'current' : 'unknown') : 'stale';
      if (!verified) {
        warnings.push(candidate.repoPath + ': stale index or AST slice disagrees with current original bytes');
        failed.push('code');
      }
      const evidenceId = makeEvidenceId('qdrant-code-' + (i + 1));
      if (evidenceId._tag === 'Err') return evidenceId;
      // Even a partial response must never present an unverified indexed snippet as direct evidence.
      if (!verified || verifiedText === undefined) continue;
      const symbolLocationLine = Buffer.from(full.bytes).toString('utf8').split('\n')[candidate.range.startLine - 1] ?? '';
      const symbolOffset = candidate.symbolName === undefined ? -1 : symbolLocationLine.indexOf(candidate.symbolName);
      if (symbolOffset < 0) {
        warnings.push(candidate.repoPath + ': symbol identifier was not found at the syntax node start');
        failed.push('lsp');
      } else {
        const definitions = yield* config.semantics.definition({
          repoPath: candidate.repoPath,
          line: candidate.range.startLine,
          column: symbolOffset + 1,
        });
        if (definitions._tag === 'Err') {
          warnings.push(candidate.repoPath + ': language service unavailable (' + definitions.error.code + ')');
          failed.push('lsp');
        } else {
          const matchingDefinition = definitions.value.some((entry) =>
            entry.location.repoPath === candidate.repoPath
            && entry.location.startLine >= candidate.range.startLine
            && entry.location.endLine <= candidate.range.endLine);
          if (!matchingDefinition) {
            warnings.push(candidate.repoPath + ': LSP definition does not agree with the selected structural node');
            failed.push('lsp');
          }
        }
      }
      evidence.push({
        ...evidenceFromCandidate({ ...ranked, freshness }, evidenceId.value),
        content: verifiedText,
        expansionHandle: full.handle,
      });
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
