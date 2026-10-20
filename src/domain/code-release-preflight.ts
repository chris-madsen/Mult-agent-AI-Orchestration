import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import {
  makeDbcEvidenceManifest,
  type DbcEvidenceRecord,
  type DbcId,
} from './dbc-evidence.js';
import type { ReleaseOwnerApproval } from './release-preflight.js';
import { validateReleaseExternalEvidenceDocument } from './release-external-evidence.js';

export type CodeReleaseDeployment = 'host' | 'k3s';

export interface CodeReleaseExternalEvidence {
  readonly name: 'supply-chain' | 'k3s-worktree';
  readonly evidence: string;
  readonly sha256: string;
  readonly document: unknown;
}

export interface CodeReleasePreflightInput {
  readonly currentCommit: string;
  readonly deployment: CodeReleaseDeployment;
  readonly dbc: unknown;
  readonly embeddingSelection: unknown;
  readonly semanticSelection: unknown;
  readonly retrievalQuality: unknown;
  readonly harborThreeArm: unknown;
  readonly externalEvidence: readonly CodeReleaseExternalEvidence[];
  readonly ownerApproval: ReleaseOwnerApproval;
}

export interface CodeReleasePreflightVerdict {
  readonly status: 'READY_CODE_ONLY' | 'BLOCKED';
  readonly scope: 'code-only';
  readonly deployment: CodeReleaseDeployment;
  readonly currentCommit: string;
  readonly requiredDbcs: readonly DbcId[];
  readonly failures: readonly string[];
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const nested = (value: unknown, ...keys: readonly string[]): unknown => {
  let current: unknown = value;
  for (const key of keys) {
    const object = record(current);
    if (object === undefined) return undefined;
    current = object[key];
  }
  return current;
};

const commitSha = (value: string): boolean => /^[a-f0-9]{40,64}$/u.test(value);
const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const nonEmpty = (value: string): boolean => value.trim().length > 0;

/**
 * DBC-10/11 are memory-only and DBC-14 requires the documentation capability.
 * Every other current DBC exercises the code retrieval/MCP/benchmark/security path.
 */
export const codeOnlyRequiredDbcs: readonly DbcId[] = [
  'DBC-01',
  'DBC-02',
  'DBC-03',
  'DBC-04',
  'DBC-05',
  'DBC-06',
  'DBC-07',
  'DBC-08',
  'DBC-09',
  'DBC-12',
  'DBC-13',
];

const codeDbcFailures = (dbc: unknown, currentCommit: string): readonly string[] => {
  const root = record(dbc);
  const records = root?.records;
  const generatedAt = root?.generatedAt;
  if (root?.schemaVersion !== 1 || !Array.isArray(records) || typeof generatedAt !== 'string') {
    return ['dbc_manifest_incomplete'];
  }
  const validated = makeDbcEvidenceManifest(records as DbcEvidenceRecord[], generatedAt);
  if (validated._tag === 'Err') return ['dbc_manifest_invalid'];

  const byId = new Map(validated.value.records.map((item) => [item.dbcId, item] as const));
  const failures: string[] = [];
  for (const dbcId of codeOnlyRequiredDbcs) {
    const item = byId.get(dbcId);
    if (item === undefined) {
      failures.push(`dbc_missing:${dbcId}`);
      continue;
    }
    if (item.verdict !== 'PASS') failures.push(`dbc_not_passed:${dbcId}`);
    if (item.sourceCommit !== currentCommit) failures.push(`dbc_wrong_commit:${dbcId}`);
  }
  return failures;
};

export const evaluateCodeReleasePreflight = (
  input: CodeReleasePreflightInput,
): Result<CodeReleasePreflightVerdict, DomainError> => {
  if (!commitSha(input.currentCommit)) {
    return err(domainError('INVALID_BENCHMARK', 'release_commit', 'code-only release requires an exact Git commit SHA'));
  }
  if (input.deployment !== 'host' && input.deployment !== 'k3s') {
    return err(domainError('INVALID_BENCHMARK', 'deployment', 'code-only release deployment must be host or k3s'));
  }
  if (!commitSha(input.ownerApproval.releaseCommit)
    || !nonEmpty(input.ownerApproval.reference)
    || input.ownerApproval.approvedCapabilities.some((value) => !['code', 'documentation', 'memory'].includes(value))
    || new Set(input.ownerApproval.approvedCapabilities).size !== input.ownerApproval.approvedCapabilities.length) {
    return err(domainError('INVALID_BENCHMARK', 'owner_approval', 'owner approval metadata is invalid'));
  }

  const failures: string[] = [...codeDbcFailures(input.dbc, input.currentCommit)];

  if (nested(input.embeddingSelection, 'verdict', 'productionApproved') !== true
    || nested(input.embeddingSelection, 'verdict', 'status') !== 'PRODUCTION_APPROVED') {
    failures.push('embedding_not_production_approved');
  }
  if (nested(input.semanticSelection, 'verdict', 'productionApproved') !== true
    || nested(input.semanticSelection, 'verdict', 'status') !== 'PRODUCTION_APPROVED') {
    failures.push('semantic_provider_not_production_approved');
  }
  if (nested(input.retrievalQuality, 'verdict', 'measurementAccepted') !== true
    || nested(input.retrievalQuality, 'verdict', 'metrics', 'holdoutStatus') !== 'frozen_holdout') {
    failures.push('retrieval_quality_not_accepted_on_frozen_holdout');
  }

  const harborOutcome = nested(input.harborThreeArm, 'outcome');
  if (nested(harborOutcome, 'productionAcceptance') !== 'measured-not-necessarily-5x'
    || nested(harborOutcome, 'naturalUse') !== 'observed_complete'
    || nested(harborOutcome, 'naturalQualityNonInferior') !== true
    || nested(harborOutcome, 'naturalProviderCorrelationVerified') !== true
    || nested(harborOutcome, 'costTelemetryComplete') !== true) {
    failures.push('harbor_natural_use_acceptance_incomplete');
  }

  const evidenceByName = new Map(input.externalEvidence.map((item) => [item.name, item] as const));
  if (evidenceByName.size !== input.externalEvidence.length) failures.push('duplicate_external_evidence');

  const supplyChain = evidenceByName.get('supply-chain');
  if (supplyChain === undefined) failures.push('external_evidence_missing:supply-chain');
  else {
    const validated = validateReleaseExternalEvidenceDocument('supply-chain', supplyChain.document, input.currentCommit);
    if (supplyChain.evidence !== 'supply-chain-provenance'
      || !sha256(supplyChain.sha256)
      || validated._tag === 'Err'
      || validated.value.evidence !== 'supply-chain-provenance') {
      failures.push('external_evidence_invalid:supply-chain');
    }
  }

  const k3s = evidenceByName.get('k3s-worktree');
  if (input.deployment === 'k3s') {
    if (k3s === undefined) failures.push('external_evidence_missing:k3s-worktree');
    else {
      const validated = validateReleaseExternalEvidenceDocument('k3s-worktree', k3s.document, input.currentCommit);
      if (k3s.evidence !== 'real-k3s-live-worktree'
        || !sha256(k3s.sha256)
        || validated._tag === 'Err'
        || validated.value.evidence !== 'real-k3s-live-worktree') {
        failures.push('external_evidence_invalid:k3s-worktree');
      }
    }
  } else if (k3s !== undefined) {
    const validated = validateReleaseExternalEvidenceDocument('k3s-worktree', k3s.document, input.currentCommit);
    if (k3s.evidence !== 'real-k3s-live-worktree'
      || !sha256(k3s.sha256)
      || validated._tag === 'Err'
      || validated.value.evidence !== 'real-k3s-live-worktree') {
      failures.push('external_evidence_invalid:k3s-worktree');
    }
  }

  if (input.ownerApproval.status !== 'approved') failures.push('owner_approval_missing');
  if (input.ownerApproval.releaseCommit !== input.currentCommit) failures.push('owner_approval_wrong_commit');
  const approved = [...input.ownerApproval.approvedCapabilities];
  if (approved.length !== 1 || approved[0] !== 'code') {
    failures.push('owner_scope_must_be_code_only');
  }

  return ok({
    status: failures.length === 0 ? 'READY_CODE_ONLY' : 'BLOCKED',
    scope: 'code-only',
    deployment: input.deployment,
    currentCommit: input.currentCommit,
    requiredDbcs: codeOnlyRequiredDbcs,
    failures: [...new Set(failures)],
  });
};
