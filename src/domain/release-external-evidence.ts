import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type ReleaseExternalEvidenceName =
  | 'graphiti'
  | 'vertex'
  | 'k3s-worktree'
  | 'backup-restore'
  | 'supply-chain';

export interface ValidatedReleaseExternalEvidence {
  readonly name: ReleaseExternalEvidenceName;
  readonly evidence: string;
  readonly sourceCommit: string;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const sha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

const commitSha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40,64}$/u.test(value);

const exactCommit = (
  value: unknown,
  currentCommit: string,
  path: string,
): Result<string, DomainError> =>
  commitSha(value) && value === currentCommit
    ? ok(value)
    : err(domainError('INVALID_BENCHMARK', path, 'external evidence must be bound to the exact current Git commit'));

const validateGraphiti = (
  root: Record<string, unknown>,
  currentCommit: string,
): Result<ValidatedReleaseExternalEvidence, DomainError> => {
  if (root.evidence !== 'real-graphiti-lifecycle'
    || !sha256(root.fixtureSha256)
    || !nonEmpty(root.fixture)
    || !nonEmpty(root.providerTrace)
    || !nonEmpty(root.graphitiVersion)
    || root.graphitiVersion === 'unknown') {
    return err(domainError('INVALID_BENCHMARK', 'external.graphiti', 'Graphiti evidence identity/version metadata is incomplete'));
  }
  const commit = exactCommit(root.sourceCommit, currentCommit, 'external.graphiti.sourceCommit');
  if (commit._tag === 'Err') return commit;
  const lifecycle = record(root.lifecycle);
  if (lifecycle === undefined
    || lifecycle.projectionObserved !== true
    || lifecycle.purgeVerified !== true
    || lifecycle.archiveTombstoneVerified !== true
    || typeof lifecycle.provenanceHitCount !== 'number'
    || !Number.isSafeInteger(lifecycle.provenanceHitCount)
    || lifecycle.provenanceHitCount < 1
    || typeof lifecycle.projectionAttempts !== 'number'
    || !Number.isSafeInteger(lifecycle.projectionAttempts)
    || lifecycle.projectionAttempts < 1
    || !sha256(lifecycle.sourceDigest)
    || !nonEmpty(lifecycle.sourcePointer)
    || !nonEmpty(lifecycle.requestId)
    || !nonEmpty(lifecycle.episodeId)
    || !nonEmpty(lifecycle.projectionKey)) {
    return err(domainError('INVALID_BENCHMARK', 'external.graphiti.lifecycle', 'Graphiti lifecycle proof is incomplete'));
  }
  const inference = record(root.inference);
  if (inference === undefined
    || !nonEmpty(inference.llm) || inference.llm === 'unknown'
    || !nonEmpty(inference.embedder) || inference.embedder === 'unknown'
    || !nonEmpty(inference.reranker) || inference.reranker === 'unknown') {
    return err(domainError('INVALID_BENCHMARK', 'external.graphiti.inference', 'Graphiti local inference identities must be explicit'));
  }
  return ok({ name: 'graphiti', evidence: root.evidence, sourceCommit: commit.value });
};

const validateVertex = (
  root: Record<string, unknown>,
  currentCommit: string,
): Result<ValidatedReleaseExternalEvidence, DomainError> => {
  if (root.evidence !== 'real-vertex-synthetic-code-doc-conflict'
    || !nonEmpty(root.requestId)
    || !nonEmpty(root.project)
    || !nonEmpty(root.location)
    || !nonEmpty(root.corpusId)
    || !nonEmpty(root.providerTrace)) {
    return err(domainError('INVALID_BENCHMARK', 'external.vertex', 'Vertex evidence identity is incomplete'));
  }
  const commit = exactCommit(root.sourceCommit, currentCommit, 'external.vertex.sourceCommit');
  if (commit._tag === 'Err') return commit;
  const documentation = record(root.documentation);
  const currentCode = record(root.currentCode);
  const conflict = record(root.conflict);
  if (documentation === undefined
    || !sha256(documentation.fixtureSha256)
    || documentation.fixtureVersion !== 'vertex-conflict-v1'
    || documentation.claim !== 'wait-for-operator-confirmation'
    || !Array.isArray(documentation.citations)
    || documentation.citations.length === 0
    || !documentation.citations.every(nonEmpty)
    || !Array.isArray(documentation.retrievedEvidenceIds)
    || documentation.retrievedEvidenceIds.length === 0
    || !documentation.retrievedEvidenceIds.every(nonEmpty)
    || currentCode === undefined
    || !sha256(currentCode.fixtureSha256)
    || currentCode.symbol !== 'aceVertexConflictPolicy'
    || currentCode.claim !== 'retry-immediately'
    || conflict === undefined
    || conflict.detectedByGate !== true
    || conflict.priorityForCurrentBehavior !== 'current-code') {
    return err(domainError('INVALID_BENCHMARK', 'external.vertex.conflict', 'Vertex code/document conflict proof is incomplete'));
  }
  return ok({ name: 'vertex', evidence: root.evidence, sourceCommit: commit.value });
};

const validateCheckAggregate = (
  name: 'k3s-worktree' | 'backup-restore',
  root: Record<string, unknown>,
  currentCommit: string,
  expectedEvidence: string,
  expectedCheckPrefix: string,
  expectedCount: number,
): Result<ValidatedReleaseExternalEvidence, DomainError> => {
  if (root.evidence !== expectedEvidence || root.schemaVersion !== 1) {
    return err(domainError('INVALID_BENCHMARK', `external.${name}`, 'external evidence label/schema is invalid'));
  }
  const commit = exactCommit(root.sourceCommit, currentCommit, `external.${name}.sourceCommit`);
  if (commit._tag === 'Err') return commit;
  if (root.currentCommit !== currentCommit) {
    return err(domainError('INVALID_BENCHMARK', `external.${name}.currentCommit`, 'external evidence finalizer commit does not match release commit'));
  }
  const verdict = record(root.verdict);
  const checks = root.checks;
  if (verdict === undefined
    || verdict.evidence !== expectedEvidence
    || verdict.allPassed !== true
    || verdict.sourceCommit !== currentCommit
    || !Array.isArray(verdict.failures)
    || verdict.failures.length !== 0
    || !Array.isArray(checks)
    || checks.length !== expectedCount) {
    return err(domainError('INVALID_BENCHMARK', `external.${name}.verdict`, 'external aggregate verdict is not a complete PASS'));
  }
  const ids = new Set<string>();
  for (const raw of checks) {
    const check = record(raw);
    if (check === undefined || !nonEmpty(check.id) || check.verdict !== 'PASS'
      || !new RegExp(`^${expectedCheckPrefix}-\\d{2}$`, 'u').test(check.id)
      || ids.has(check.id)
      || !Array.isArray(check.artifacts)
      || check.artifacts.length === 0) {
      return err(domainError('INVALID_BENCHMARK', `external.${name}.checks`, 'external evidence contains a missing/duplicate/non-PASS check'));
    }
    ids.add(check.id);
  }
  return ok({ name, evidence: expectedEvidence, sourceCommit: commit.value });
};

const validateSupplyChain = (
  root: Record<string, unknown>,
  currentCommit: string,
): Result<ValidatedReleaseExternalEvidence, DomainError> => {
  if (root.schemaVersion !== 1
    || root.evidence !== 'supply-chain-provenance'
    || root.currentCommit !== currentCommit) {
    return err(domainError('INVALID_BENCHMARK', 'external.supply-chain', 'supply-chain evidence identity is invalid'));
  }
  const verdict = record(root.verdict);
  if (verdict === undefined
    || verdict.status !== 'PASS'
    || verdict.evidence !== 'supply-chain-provenance'
    || verdict.sourceCommit !== currentCommit
    || !Array.isArray(verdict.failures)
    || verdict.failures.length !== 0
    || !sha256(verdict.packageLockSha256)
    || !sha256(verdict.sbomSha256)
    || typeof verdict.imageDigest !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(verdict.imageDigest)
    || typeof verdict.baseImageDigest !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(verdict.baseImageDigest)
    || typeof verdict.baseImageReference !== 'string'
    || !verdict.baseImageReference.endsWith('@' + verdict.baseImageDigest)) {
    return err(domainError('INVALID_BENCHMARK', 'external.supply-chain.verdict', 'supply-chain internal PASS verdict is incomplete'));
  }
  return ok({ name: 'supply-chain', evidence: root.evidence, sourceCommit: currentCommit });
};

export const validateReleaseExternalEvidenceDocument = (
  name: ReleaseExternalEvidenceName,
  document: unknown,
  currentCommit: string,
): Result<ValidatedReleaseExternalEvidence, DomainError> => {
  if (!commitSha(currentCommit)) {
    return err(domainError('INVALID_BENCHMARK', 'release_commit', 'external evidence validation requires an exact current Git commit'));
  }
  const root = record(document);
  if (root === undefined) {
    return err(domainError('INVALID_BENCHMARK', `external.${name}`, 'external evidence document must be an object'));
  }
  switch (name) {
    case 'graphiti':
      return validateGraphiti(root, currentCommit);
    case 'vertex':
      return validateVertex(root, currentCommit);
    case 'k3s-worktree':
      return validateCheckAggregate(name, root, currentCommit, 'real-k3s-live-worktree', 'K3S', 10);
    case 'backup-restore':
      return validateCheckAggregate(name, root, currentCommit, 'operations-backup-restore', 'OPS', 6);
    case 'supply-chain':
      return validateSupplyChain(root, currentCommit);
  }
};
