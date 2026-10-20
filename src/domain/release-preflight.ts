import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import {
  dbcAcceptanceSummary,
  makeDbcEvidenceManifest,
  type DbcEvidenceRecord,
} from './dbc-evidence.js';
import { validateReleaseExternalEvidenceDocument } from './release-external-evidence.js';

export type ReleaseCapability = 'code' | 'documentation' | 'memory';

export interface ReleaseOwnerApproval {
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly releaseCommit: string;
  readonly reference: string;
  readonly approvedCapabilities: readonly ReleaseCapability[];
}

export interface ReleaseExternalEvidence {
  readonly name: 'graphiti' | 'vertex' | 'k3s-worktree' | 'backup-restore' | 'supply-chain';
  readonly evidence: string;
  readonly sha256: string;
  /** Parsed retained evidence; revalidated here so direct domain callers cannot bypass semantics. */
  readonly document: unknown;
}

export interface ReleasePreflightInput {
  readonly currentCommit: string;
  readonly dbc: unknown;
  readonly embeddingSelection: unknown;
  readonly semanticSelection: unknown;
  readonly retrievalQuality: unknown;
  readonly harborThreeArm: unknown;
  readonly externalEvidence: readonly ReleaseExternalEvidence[];
  readonly ownerApproval: ReleaseOwnerApproval;
}

export interface ReleasePreflightVerdict {
  readonly status: 'READY' | 'BLOCKED';
  readonly currentCommit: string;
  readonly failures: readonly string[];
  readonly approvedCapabilities: readonly ReleaseCapability[];
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

const dbcFailures = (dbc: unknown, currentCommit: string): readonly string[] => {
  const root = record(dbc);
  const records = root?.records;
  const generatedAt = root?.generatedAt;
  if (root?.schemaVersion !== 1 || !Array.isArray(records) || typeof generatedAt !== 'string') {
    return ['dbc_manifest_incomplete'];
  }
  const validated = makeDbcEvidenceManifest(records as DbcEvidenceRecord[], generatedAt);
  if (validated._tag === 'Err') return ['dbc_manifest_invalid'];
  const summary = dbcAcceptanceSummary(validated.value);
  const failures: string[] = [];
  if (!summary.allPassed) {
    for (const item of validated.value.records) {
      if (item.verdict !== 'PASS') failures.push(`dbc_not_passed:${item.dbcId}`);
    }
    if (validated.value.records.length !== 14) failures.push('dbc_manifest_incomplete');
  }
  for (const item of validated.value.records) {
    if (item.sourceCommit !== currentCommit) failures.push(`dbc_wrong_commit:${item.dbcId}`);
  }
  return failures;
};

const requiredExternal: Readonly<Record<ReleaseExternalEvidence['name'], string>> = {
  graphiti: 'real-graphiti-lifecycle',
  vertex: 'real-vertex-synthetic-code-doc-conflict',
  'k3s-worktree': 'real-k3s-live-worktree',
  'backup-restore': 'operations-backup-restore',
  'supply-chain': 'supply-chain-provenance',
};

export const evaluateReleasePreflight = (
  input: ReleasePreflightInput,
): Result<ReleasePreflightVerdict, DomainError> => {
  if (!commitSha(input.currentCommit)) {
    return err(domainError('INVALID_BENCHMARK', 'release_commit', 'release preflight requires an exact Git commit SHA'));
  }
  if (!commitSha(input.ownerApproval.releaseCommit)
    || !nonEmpty(input.ownerApproval.reference)
    || input.ownerApproval.approvedCapabilities.some((value) => !['code', 'documentation', 'memory'].includes(value))
    || new Set(input.ownerApproval.approvedCapabilities).size !== input.ownerApproval.approvedCapabilities.length) {
    return err(domainError('INVALID_BENCHMARK', 'owner_approval', 'owner approval metadata is invalid'));
  }

  const failures: string[] = [...dbcFailures(input.dbc, input.currentCommit)];

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

  const externalByName = new Map(input.externalEvidence.map((item) => [item.name, item] as const));
  if (externalByName.size !== input.externalEvidence.length) failures.push('duplicate_external_evidence');
  for (const [name, expectedEvidence] of Object.entries(requiredExternal) as Array<[ReleaseExternalEvidence['name'], string]>) {
    const evidence = externalByName.get(name);
    if (evidence === undefined) {
      failures.push(`external_evidence_missing:${name}`);
      continue;
    }
    const validated = validateReleaseExternalEvidenceDocument(name, evidence.document, input.currentCommit);
    if (evidence.evidence !== expectedEvidence
      || !sha256(evidence.sha256)
      || validated._tag === 'Err'
      || validated.value.evidence !== expectedEvidence) {
      failures.push(`external_evidence_invalid:${name}`);
    }
  }

  if (input.ownerApproval.status !== 'approved') failures.push('owner_approval_missing');
  if (input.ownerApproval.releaseCommit !== input.currentCommit) failures.push('owner_approval_wrong_commit');
  const approved = new Set(input.ownerApproval.approvedCapabilities);
  for (const capability of ['code', 'documentation', 'memory'] as const) {
    if (!approved.has(capability)) failures.push(`owner_capability_not_approved:${capability}`);
  }

  return ok({
    status: failures.length === 0 ? 'READY' : 'BLOCKED',
    currentCommit: input.currentCommit,
    failures: [...new Set(failures)],
    approvedCapabilities: [...input.ownerApproval.approvedCapabilities],
  });
};
