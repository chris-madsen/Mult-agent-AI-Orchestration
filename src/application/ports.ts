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
import type { ContextBundle, CodeCandidate, RankedCandidate } from '../domain/retrieval.js';
import type { EpisodeId, ProjectionReceipt } from '../domain/memory.js';
import type {
  SemanticDefinition,
  SemanticDiagnostic,
  SemanticReference,
  SemanticTypeInfo,
  StructuralAnalysis,
} from '../domain/semantic.js';

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
  readonly embedMany: (input: readonly string[]) => Effect.Effect<Result<readonly (readonly number[])[], DomainError>>;
}

export interface CodePoint {
  readonly candidate: CodeCandidate;
  readonly vector: readonly number[];
}

export interface CodeCandidatePort {
  readonly search: (input: {
    readonly workspaceId: WorkspaceId;
    readonly vector: readonly number[];
    readonly limit: number;
    /** Current build epoch, preventing deleted/renamed sources from reappearing. */
    readonly generation?: number;
  }) => Effect.Effect<Result<readonly RankedCandidate[], DomainError>>;
  readonly upsert: (points: readonly CodePoint[]) => Effect.Effect<Result<void, DomainError>>;
}

export interface DocumentationPort {
  readonly search: (input: {
    readonly workspaceId: WorkspaceId;
    readonly query: string;
    readonly topK: number;
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
}

export interface GraphProjectionPort {
  readonly project: (input: {
    readonly episodeId: EpisodeId;
    readonly extractorVersion: string;
    readonly claims: readonly Readonly<Record<string, string>>[];
  }) => Effect.Effect<Result<ProjectionReceipt, DomainError>>;
  readonly purge: (episodeId: EpisodeId) => Effect.Effect<Result<void, DomainError>>;
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
