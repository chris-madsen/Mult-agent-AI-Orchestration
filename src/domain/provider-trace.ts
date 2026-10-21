export type ProviderTraceStatus = 'success' | 'failure';

export type ProviderTraceName =
  | 'embedding'
  | 'sparse_embedding'
  | 'reranker'
  | 'qdrant'
  | 'ast_grep'
  | 'lsp'
  | 'vertex_rag'
  | 'graphiti'
  | 'git_history'
  | 'source_verification';

/**
 * Safe runtime evidence.  This deliberately contains no source text, query,
 * token, URL credential, or raw provider response.
 */
export interface ProviderTraceEvent {
  readonly timestampMs: number;
  readonly provider: ProviderTraceName;
  readonly providerVersion: string;
  readonly operation: string;
  readonly status: ProviderTraceStatus;
  readonly durationMs: number;
  /** ACE ContextBundle request id; absent for startup/indexing work. */
  readonly requestId?: string;
  readonly collection?: string;
  readonly generation?: number;
  readonly vectorDimension?: number;
  readonly errorCode?: string;
}
