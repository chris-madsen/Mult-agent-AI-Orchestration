import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type HermesContextTransformStatus = 'ready' | 'partial' | 'not_ready' | 'blocked';

export interface HermesContextEvidence {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly status: HermesContextTransformStatus;
  readonly receiptId: string;
  /** Provider trace correlation ID, distinct from requestId on the local bridge. */
  readonly providerRequestId?: string;
  readonly selectedEvidenceIds: readonly string[];
  readonly omittedEvidenceIds: readonly string[];
  readonly bridgeDigest: string;
  readonly pluginDigest: string;
  readonly estimatedTokens?: number;
  readonly sourceCommit?: string;
  readonly sourceManifestSha256?: string;
  readonly limitations: readonly string[];
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const revision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40,64}$/iu.test(value);
const uniqueStrings = (value: unknown): value is readonly string[] => Array.isArray(value)
  && value.every(nonEmpty)
  && new Set(value).size === value.length;
const invalid = (path: string, message: string): Result<never, DomainError> =>
  err(domainError('INVALID_BENCHMARK', path, message));

export const validateHermesContextEvidence = (value: unknown): Result<HermesContextEvidence, DomainError> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('hermes_context_evidence', 'evidence must be an object');
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1
    || !nonEmpty(input.requestId)
    || !nonEmpty(input.sessionId)
    || !nonEmpty(input.turnId)
    || !['ready', 'partial', 'not_ready', 'blocked'].includes(String(input.status))
    || !nonEmpty(input.receiptId)
    || !uniqueStrings(input.selectedEvidenceIds)
    || !uniqueStrings(input.omittedEvidenceIds)
    || !digest(input.bridgeDigest)
    || !digest(input.pluginDigest)
    || !Array.isArray(input.limitations)
    || !input.limitations.every(nonEmpty)) {
    return invalid('hermes_context_evidence', 'identity, status, digests, IDs or limitations are malformed');
  }
  if (input.providerRequestId !== undefined && !nonEmpty(input.providerRequestId)) {
    return invalid('hermes_context_evidence.providerRequestId', 'provider request ID must be non-empty');
  }
  if (input.status === 'ready' && !nonEmpty(input.providerRequestId)) {
    return invalid('hermes_context_evidence.providerRequestId', 'ready transformations require a real provider trace ID');
  }
  const selected = new Set(input.selectedEvidenceIds as readonly string[]);
  if ((input.omittedEvidenceIds as readonly string[]).some((id) => selected.has(id))) {
    return invalid('hermes_context_evidence.evidence_ids', 'selected and omitted evidence IDs must be disjoint');
  }
  if (input.estimatedTokens !== undefined
    && (typeof input.estimatedTokens !== 'number' || !Number.isSafeInteger(input.estimatedTokens) || input.estimatedTokens < 0)) {
    return invalid('hermes_context_evidence.estimatedTokens', 'estimated tokens must be a non-negative integer');
  }
  if (input.sourceCommit !== undefined && !revision(input.sourceCommit)) {
    return invalid('hermes_context_evidence.sourceCommit', 'source commit must be a Git revision');
  }
  if (input.sourceManifestSha256 !== undefined && !digest(input.sourceManifestSha256)) {
    return invalid('hermes_context_evidence.sourceManifestSha256', 'source manifest must be a SHA-256 digest');
  }
  if (/(?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret)\s*[:=]/iu.test(JSON.stringify(input.limitations))) {
    return err(domainError('SECRET_DETECTED', 'hermes_context_evidence.limitations', 'credential-like metadata is forbidden'));
  }
  return ok(input as unknown as HermesContextEvidence);
};
