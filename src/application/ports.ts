import type { Effect } from 'effect';
import type { DomainError } from '../domain/errors.js';
import type { SafeAuditRecord } from '../domain/policy.js';
import type {
  ContentDigest,
  FileObservation,
  RepoPath,
  WorkspaceId,
  WorkspaceRecord,
  WorkspaceSnapshot,
} from '../domain/workspace.js';
import type { Result } from '../domain/result.js';
import type { CodeRetrievalStrategy, ContextBundle, CodeCandidate, RankedCandidate } from '../domain/retrieval.js';
import type { DecisionRecord, EpisodeId, MemorySearchResult, ProjectionKey, ProjectionReceipt, SessionEpisode } from '../domain/memory.js';
import type {
  SemanticDefinition,
  SemanticDiagnostic,
  SemanticReference,
  SemanticTypeInfo,
  StructuralAnalysis,
} from '../domain/semantic.js';
import type { ProviderTraceEvent } from '../domain/provider-trace.js';

export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface HttpPort {
  readonly request: (request: HttpRequest) => Effect.Effect<Result<HttpResponse, DomainError>>;
}

/**
 * Embedding provider boundary. The concrete provider is intentionally not
 * selected here; provider choice requires an approved, measured spike.
 */
export interface VectorEmbeddingPort {
  readonly embedMany: (input: readonly string[], requestId?: string) => Effect.Effect<Result<readonly (readonly number[])[], DomainError>>;
}

export interface RerankScore {
  readonly index: number;
  readonly score: number;
}

export interface RerankerPort {
  readonly rerank: (input: {
    readonly query: string;
    readonly documents: readonly string[];
    readonly requestId?: string;
  }) => Effect.Effect<Result<readonly RerankScore[], DomainError>>;
}

export interface ProviderTraceSink {
  readonly record: (event: ProviderTraceEvent) => void;
}

export interface CodePoint {
  readonly candidate: CodeCandidate;
  readonly vector: readonly number[];
  /** Opaque source-snapshot key used to isolate equal observation epochs. */
  readonly indexKey?: string;
  /** Content-addressed embedding identity, independent from source citation identity. */
  readonly embeddingKey?: string;
}

export interface CodeCandidatePort {
  readonly search: (input: {
    readonly workspaceId: WorkspaceId;
    /** Dense query vector; not required by sparse-only ablation. */
    readonly vector?: readonly number[];
    /** Original text used by provider-native Qdrant BM25. */
    readonly queryText?: string;
    /** Explicit strategy keeps benchmark arms on the same production adapter. */
    readonly strategy?: CodeRetrievalStrategy;
    readonly limit: number;
    /** Per-branch candidate depth before fusion; defaults to a bounded multiple of limit. */
    readonly prefetchLimit?: number;
    /** Current build epoch, preventing deleted/renamed sources from reappearing. */
    readonly generation?: number;
    /** Current source snapshot key, preventing equal epochs from mixing. */
    readonly indexKey?: string;
    /** Correlates query-time provider work to one ACE ContextBundle. */
    readonly requestId?: string;
  }) => Effect.Effect<Result<readonly RankedCandidate[], DomainError>>;
  readonly upsert: (points: readonly CodePoint[]) => Effect.Effect<Result<void, DomainError>>;
}

export interface DocumentationPort {
  readonly search: (input: {
    readonly workspaceId: WorkspaceId;
    readonly query: string;
    readonly topK: number;
    readonly requestId?: string;
  }) => Effect.Effect<Result<readonly ContextBundle['evidence'][number][], DomainError>>;
}

export interface StructuralAnalysisPort {
  readonly extract: (input: {
    readonly repoPath: string;
    readonly source: Uint8Array;
  }) => Effect.Effect<Result<StructuralAnalysis, DomainError>>;
}

export interface SemanticAnalysisPort {
  readonly definition: (input: SemanticQuery) => Effect.Effect<Result<readonly SemanticDefinition[], DomainError>>;
  readonly references: (input: SemanticQuery) => Effect.Effect<Result<readonly SemanticReference[], DomainError>>;
  readonly typeInfo: (input: SemanticQuery) => Effect.Effect<Result<SemanticTypeInfo | undefined, DomainError>>;
  readonly diagnostics: (input: { readonly repoPath: string }) => Effect.Effect<Result<readonly SemanticDiagnostic[], DomainError>>;
}

export interface SemanticQuery {
  readonly repoPath: string;
  readonly line: number;
  readonly column: number;
  /** Correlates semantic provider work to one ACE ContextBundle. */
  readonly requestId?: string;
  /** Identity of the source/configuration generation the caller verified. */
  readonly snapshotIdentity?: string;
}

export interface MemorySearchPort {
  readonly search: (input: {
    readonly workspaceId: WorkspaceId;
    readonly query: string;
    readonly asOfMs?: number;
    readonly includeOriginal: boolean;
    readonly requestId?: string;
  }) => Effect.Effect<Result<MemorySearchResult, DomainError>>;
}

export interface DecisionHistoryPort {
  readonly list: (workspaceId: WorkspaceId) => Effect.Effect<Result<readonly DecisionRecord[], DomainError>>;
}

export interface ProjectionOutboxPort {
  readonly begin: (episodeId: EpisodeId, extractorVersion: string) => Promise<Result<ProjectionReceipt, DomainError>>;
  readonly put: (receipt: ProjectionReceipt) => Promise<Result<void, DomainError>>;
  readonly get: (key: ProjectionKey) => Promise<Result<ProjectionReceipt | undefined, DomainError>>;
  readonly list: () => Promise<Result<readonly ProjectionReceipt[], DomainError>>;
  readonly beginDeletion: (episodeId: EpisodeId) => Promise<Result<void, DomainError>>;
  readonly finalizeDeletion: (episodeId: EpisodeId) => Promise<Result<void, DomainError>>;
  readonly isDeletionBlocked: (episodeId: EpisodeId) => Promise<Result<boolean, DomainError>>;
}

export interface GraphProjectionStatePort {
  /** True only when the derived Graphiti episode still exists. */
  readonly isPresent: (episodeId: EpisodeId) => Effect.Effect<Result<boolean, DomainError>>;
}

export interface GraphProjectionPort {
  readonly project: (input: {
    readonly episodeId: EpisodeId;
    /** Original event time; required for Graphiti bi-temporal reference_time. */
    readonly occurredAtMs: number;
    readonly extractorVersion: string;
    readonly claims: readonly Readonly<Record<string, string>>[];
  }) => Effect.Effect<Result<ProjectionReceipt, DomainError>>;
  readonly purge: (episodeId: EpisodeId) => Effect.Effect<Result<void, DomainError>>;
}

export interface MemoryArchivePort {
  readonly importEpisode: (episode: SessionEpisode) => Promise<Result<{ readonly created: boolean; readonly episode: SessionEpisode }, DomainError>>;
  readonly readEpisode: (episodeId: EpisodeId) => Promise<Result<SessionEpisode, DomainError>>;
  readonly deleteEpisode: (episodeId: EpisodeId) => Promise<Result<void, DomainError>>;
}

export interface ExactRead {
  readonly bytes: Uint8Array;
  readonly digest: ContentDigest;
}

export interface WorkspaceFilePort {
  readonly canonicalizeRoot: (candidate: string) => Effect.Effect<Result<string, DomainError>>;
  readonly snapshot: (rootPath: string, observedAtMs: number) => Effect.Effect<Result<WorkspaceSnapshot, DomainError>>;
  readonly readExact: (rootPath: string, repoPath: RepoPath) => Effect.Effect<Result<ExactRead, DomainError>>;
}

export interface WorkspaceStore {
  readonly get: (workspaceId: WorkspaceId) => Effect.Effect<Result<WorkspaceRecord, DomainError>>;
  readonly findByRoot: (rootPath: string) => Effect.Effect<Result<WorkspaceRecord | undefined, DomainError>>;
  readonly save: (record: WorkspaceRecord) => Effect.Effect<Result<void, DomainError>>;
}

export interface ClockPort {
  readonly nowMs: () => number;
}

export interface IdPort {
  readonly newWorkspaceId: () => string;
  readonly newRequestId: () => string;
}

export interface AuditSink {
  readonly append: (record: SafeAuditRecord) => Effect.Effect<Result<void, DomainError>>;
}

export interface ArtifactReference {
  readonly handle: string;
  readonly digest: ContentDigest;
  readonly sizeBytes: number;
}

export interface ArtifactRange {
  readonly bytes: Uint8Array;
  readonly digest: ContentDigest;
  readonly offset: number;
  readonly totalBytes: number;
  readonly nextCursor?: string;
}

export interface ArtifactStore {
  readonly storeExact: (bytes: Uint8Array) => Effect.Effect<Result<ArtifactReference, DomainError>>;
  readonly readRange: (
    handle: string,
    cursor: string | undefined,
    maxBytes: number | undefined,
  ) => Effect.Effect<Result<ArtifactRange, DomainError>>;
}

export const fileCount = (files: readonly FileObservation[]): number => files.length;
