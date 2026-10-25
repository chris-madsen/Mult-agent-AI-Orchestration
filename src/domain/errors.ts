export type DomainErrorCode =
  | 'INVALID_INPUT'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_ROOT_NOT_ALLOWED'
  | 'PATH_ESCAPE'
  | 'FILE_NOT_FOUND'
  | 'DIGEST_MISMATCH'
  | 'WORKTREE_RACED'
  | 'SNAPSHOT_FAILED'
  | 'PERSISTENCE_FAILED'
  | 'POLICY_DENIED'
  | 'AUTH_REQUIRED'
  | 'SECRET_DETECTED'
  | 'AUDIT_FAILED'
  | 'ARTIFACT_NOT_FOUND'
  | 'INVALID_HANDLE'
  | 'NOT_READY'
  | 'INVALID_BENCHMARK'
  | 'INVALID_USAGE'
  | 'USAGE_UNAVAILABLE'
  | 'UNSUPPORTED_PROVIDER'
  | 'QUALITY_GATE_FAILED'
  | 'INVALID_RETRIEVAL'
  | 'INVALID_MEMORY'
  | 'INVALID_ROUTING'
  | 'ARCHIVE_TOMBSTONED'
  | 'EXTERNAL_UNAVAILABLE'
  | 'INVALID_EXTERNAL_RESPONSE'
  | 'INVALID_ATTESTATION'
  | 'UNSUPPORTED_PROTOCOL'
  | 'PROTECTED_GROUP_INVALID'
  | 'HOST_CONTEXT_UNATTESTED'
  | 'HOST_COMPACTION_ACTIVE'
  | 'PROVIDER_MANAGED_STATE_UNKNOWN'
  | 'DUAL_PROJECTION_OWNER'
  | 'DEADLINE_EXCEEDED';

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly path: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export const domainError = (
  code: DomainErrorCode,
  path: string,
  message: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): DomainError => ({ code, path, message, ...(details === undefined ? {} : { details }) });
