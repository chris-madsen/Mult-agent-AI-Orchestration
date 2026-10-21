import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import {
  dbcAcceptanceSummary,
  makeDbcEvidenceManifest,
  type DbcEvidenceRecord,
} from './dbc-evidence.js';
import { validateReleaseExternalEvidenceDocument } from './release-external-evidence.js';
import { validateResourceBudgetEvidenceDocument } from './resource-budget-evidence.js';
import { validateRuntimeConfigEvidenceDocument } from './runtime-config-evidence.js';
import { validateReleaseAcceptanceArtifacts } from './release-artifact-validation.js';

export type ReleaseCapability = 'code' | 'documentation' | 'memory';

export interface ReleaseOwnerApproval {
  readonly schemaVersion?: 1;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly releaseCommit: string;
  readonly reference: string;
  readonly approvedCapabilities: readonly ReleaseCapability[];
  /** Provider identities covered by this signed approval scope. */
  readonly approvedProviderIdentities: readonly string[];
  readonly signingKeyId?: string;
  readonly publicKeyPem?: string;
  readonly signedPayloadSha256?: string;
  readonly signatureBase64?: string;
}

export interface ReleaseOwnerApprovalTrustRoot {
  readonly signingKeyId: string;
  readonly publicKeySha256: string;
  readonly publicKeyPem: string;
  /** Computed by the imperative release boundary using the pinned key. */
  readonly publicKeyIdentityVerified?: boolean;
  readonly signatureVerified?: boolean;
}

export interface ReleaseExternalEvidence {
  readonly name: 'graphiti' | 'graphiti-crash-recovery' | 'vertex' | 'k3s-worktree' | 'backup-restore' | 'supply-chain';
  readonly evidence: string;
  readonly sha256: string;
  /** Parsed retained evidence; revalidated here so direct domain callers cannot bypass semantics. */
  readonly document: unknown;
}

export interface ReleaseEvidenceBinding {
  readonly schemaVersion: 1;
  readonly sourceCommit: string;
  readonly measurementArtifacts: readonly {
    readonly name: string;
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly providerIdentities: readonly string[];
  readonly reportIdentitySha256: string;
  /** Computed by the release boundary after hashing the retained files. */
  readonly reportIdentityVerified?: boolean;
}

export interface ReleasePreflightInput {
  readonly currentCommit: string;
  readonly dbc: unknown;
  readonly embeddingSelection: unknown;
  readonly semanticSelection: unknown;
  readonly retrievalQuality: unknown;
  readonly harborThreeArm: unknown;
  readonly resourceBudget: unknown;
  readonly runtimeConfig: unknown;
  readonly externalEvidence: readonly ReleaseExternalEvidence[];
  readonly evidenceBinding?: ReleaseEvidenceBinding;
  readonly ownerApproval: ReleaseOwnerApproval;
  /** Supplied by the release environment, not selected by the approval JSON. */
  readonly ownerApprovalTrustRoot?: ReleaseOwnerApprovalTrustRoot;
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

export const ownerApprovalPayload = (approval: ReleaseOwnerApproval): string => JSON.stringify({
  schemaVersion: 1,
  status: approval.status,
  releaseCommit: approval.releaseCommit,
  reference: approval.reference,
  approvedCapabilities: [...approval.approvedCapabilities].sort(),
  approvedProviderIdentities: [...approval.approvedProviderIdentities].sort(),
  signingKeyId: approval.signingKeyId ?? null,
});

const selectedProviderIdentities = (
  embeddingSelection: unknown,
  semanticSelection: unknown,
): readonly string[] => [
  nested(embeddingSelection, 'verdict', 'selectedProviderIdentity'),
  nested(semanticSelection, 'verdict', 'selectedProviderIdentity'),
].filter((value): value is string => typeof value === 'string' && nonEmpty(value));

export const validateOwnerApprovalProviderScope = (
  approval: ReleaseOwnerApproval,
  embeddingSelection: unknown,
  semanticSelection: unknown,
): readonly string[] => {
  if (!Array.isArray(approval.approvedProviderIdentities)
    || approval.approvedProviderIdentities.length === 0
    || approval.approvedProviderIdentities.some((identity) => typeof identity !== 'string' || !nonEmpty(identity))
    || new Set(approval.approvedProviderIdentities).size !== approval.approvedProviderIdentities.length) {
    return ['owner_approval_provider_scope_invalid'];
  }
  const approved = [...approval.approvedProviderIdentities].sort();
  const selected = [...selectedProviderIdentities(embeddingSelection, semanticSelection)].sort();
  return approved.length === selected.length
    && approved.every((identity, index) => identity === selected[index])
    ? []
    : ['owner_approval_provider_scope_mismatch'];
};

const approvalTrustRootFailures = (
  approval: ReleaseOwnerApproval,
  currentCommit: string,
  trustRoot: ReleaseOwnerApprovalTrustRoot | undefined,
): readonly string[] => {
  const failures: string[] = [];
  if (trustRoot === undefined) return ['owner_approval_trust_root_missing'];
  if (!nonEmpty(trustRoot.signingKeyId)
    || !sha256(trustRoot.publicKeySha256)
    || !nonEmpty(trustRoot.publicKeyPem)
    || trustRoot.signingKeyId !== approval.signingKeyId
    || trustRoot.publicKeyIdentityVerified !== true) {
    failures.push('owner_approval_trust_root_invalid');
    return failures;
  }
  if (trustRoot.signatureVerified !== true) {
    failures.push('owner_approval_signature_invalid');
    return failures;
  }
  if (approval.schemaVersion !== 1
    || !nonEmpty(approval.signingKeyId ?? '')
    || !sha256(approval.signedPayloadSha256 ?? '')
    || !nonEmpty(approval.signatureBase64 ?? '')
    || !nonEmpty(approval.publicKeyPem ?? '')
    || approval.publicKeyPem !== trustRoot.publicKeyPem
    || approval.releaseCommit !== currentCommit) {
    failures.push('owner_approval_signature_invalid');
    return failures;
  }
  return failures;
};

export const validateOwnerApproval = (
  approval: ReleaseOwnerApproval,
  currentCommit: string,
  trustRoot?: ReleaseOwnerApprovalTrustRoot,
): readonly string[] => approvalTrustRootFailures(approval, currentCommit, trustRoot);

const evidenceBindingFailures = (
  binding: ReleaseEvidenceBinding | undefined,
  currentCommit: string,
  embeddingSelection: unknown,
  semanticSelection: unknown,
): readonly string[] => {
  if (binding === undefined) return ['evidence_binding_missing'];
  const artifacts = [...binding.measurementArtifacts].sort((left, right) => left.name.localeCompare(right.name));
  const failures: string[] = [];
  if (binding.schemaVersion !== 1
    || binding.sourceCommit !== currentCommit
    || artifacts.length < 7
    || artifacts.some((artifact) => !nonEmpty(artifact.name) || !nonEmpty(artifact.path) || !sha256(artifact.sha256))
    || new Set(artifacts.map((artifact) => artifact.name)).size !== artifacts.length
    || !sha256(binding.reportIdentitySha256)
    || binding.reportIdentityVerified !== true
    || binding.providerIdentities.length === 0
    || binding.providerIdentities.some((identity) => !nonEmpty(identity))) {
    failures.push('evidence_binding_invalid');
    return failures;
  }
  const selectedEmbedding = nested(embeddingSelection, 'verdict', 'selectedProvider');
  const selectedSemantic = nested(semanticSelection, 'verdict', 'selectedProvider');
  if (typeof selectedEmbedding !== 'string' || !binding.providerIdentities.includes(selectedEmbedding)) {
    failures.push('evidence_binding_embedding_provider_missing');
  }
  if (typeof selectedSemantic !== 'string' || !binding.providerIdentities.includes(selectedSemantic)) {
    failures.push('evidence_binding_semantic_provider_missing');
  }
  return failures;
};

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
  'graphiti-crash-recovery': 'real-graphiti-crash-recovery',
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
  failures.push(...validateReleaseAcceptanceArtifacts(input, input.currentCommit));
  failures.push(...evidenceBindingFailures(
    input.evidenceBinding,
    input.currentCommit,
    input.embeddingSelection,
    input.semanticSelection,
  ));
  failures.push(...validateOwnerApproval(input.ownerApproval, input.currentCommit, input.ownerApprovalTrustRoot));
  failures.push(...validateOwnerApprovalProviderScope(
    input.ownerApproval,
    input.embeddingSelection,
    input.semanticSelection,
  ));

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

  const resourceBudget = validateResourceBudgetEvidenceDocument(
    input.resourceBudget,
    input.currentCommit,
    'full-unified',
  );
  if (resourceBudget._tag === 'Err' || !resourceBudget.value.allWithinBudget) {
    failures.push('resource_budget_not_accepted');
  }

  const runtimeConfig = validateRuntimeConfigEvidenceDocument(
    input.runtimeConfig,
    input.currentCommit,
    'full-unified',
    'k3s',
  );
  if (runtimeConfig._tag === 'Err') {
    failures.push('runtime_config_not_accepted');
  } else {
    const selectedEmbedding = nested(input.embeddingSelection, 'verdict', 'selectedProvider');
    const selectedSemantic = nested(input.semanticSelection, 'verdict', 'selectedProvider');
    if (runtimeConfig.value.embeddingProvider !== selectedEmbedding) {
      failures.push('runtime_embedding_provider_mismatch');
    }
    if (runtimeConfig.value.semanticProvider !== selectedSemantic) {
      failures.push('runtime_semantic_provider_mismatch');
    }
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
