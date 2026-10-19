export type ProviderTraceStatus = 'success' | 'failure';

export type ProviderTraceName =
  | 'embedding'
  | 'qdrant'
  | 'tree_sitter'
  | 'typescript_language_service';

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
  readonly collection?: string;
  readonly generation?: number;
  readonly vectorDimension?: number;
  readonly errorCode?: string;
}
