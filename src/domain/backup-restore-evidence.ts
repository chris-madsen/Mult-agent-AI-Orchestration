import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type BackupRestoreCheckId =
  | 'OPS-01'
  | 'OPS-02'
  | 'OPS-03'
  | 'OPS-04'
  | 'OPS-05'
  | 'OPS-06';

export type BackupRestoreCheckVerdict = 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED';

export interface BackupRestoreArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly kind: string;
}

export interface BackupRestoreCheck {
  readonly id: BackupRestoreCheckId;
  readonly verdict: BackupRestoreCheckVerdict;
  readonly command?: string;
  readonly observed: readonly string[];
  readonly artifacts: readonly BackupRestoreArtifact[];
  readonly limitation?: string;
}

export interface BackupRestoreEvidenceInput {
  readonly schemaVersion: 1;
  readonly sourceCommit: string;
  readonly generatedAt: string;
  readonly environment: {
    readonly aceVersion: string;
    readonly qdrantVersion: string;
    readonly graphitiVersion: string;
    readonly falkorDbVersion: string;
    readonly deployment: string;
  };
  readonly checks: readonly BackupRestoreCheck[];
}

export interface BackupRestoreEvidenceVerdict {
  readonly evidence: 'operations-backup-restore' | 'operations-backup-restore-incomplete';
  readonly sourceCommit: string;
  readonly allPassed: boolean;
  readonly failures: readonly string[];
}

export const requiredBackupRestoreChecks: readonly BackupRestoreCheckId[] = [
  'OPS-01',
  'OPS-02',
  'OPS-03',
  'OPS-04',
  'OPS-05',
  'OPS-06',
];

const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const commitSha = (value: string): boolean => /^[a-f0-9]{40,64}$/u.test(value);
const nonEmpty = (value: string): boolean => value.trim().length > 0;
const safeText = (value: string): boolean =>
  nonEmpty(value)
  && !/(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|private[_-]?key)\s*[:=]\s*\S+/iu.test(value)
  && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value);

const validArtifact = (artifact: BackupRestoreArtifact): boolean =>
  nonEmpty(artifact.path)
  && !artifact.path.startsWith('/')
  && !artifact.path.includes('\\')
  && !artifact.path.split('/').some((part) => part === '' || part === '.' || part === '..')
  && sha256(artifact.sha256)
  && safeText(artifact.kind);

export const evaluateBackupRestoreEvidence = (
  input: BackupRestoreEvidenceInput,
  currentCommit: string,
): Result<BackupRestoreEvidenceVerdict, DomainError> => {
  if (input.schemaVersion !== 1
    || !commitSha(input.sourceCommit)
    || !commitSha(currentCommit)
    || Number.isNaN(Date.parse(input.generatedAt))) {
    return err(domainError('INVALID_BENCHMARK', 'backup_restore_evidence', 'operations evidence identity/timestamp is invalid'));
  }
  if (!Object.values(input.environment).every((value) => typeof value === 'string' && safeText(value))) {
    return err(domainError('INVALID_BENCHMARK', 'backup_restore_environment', 'operations environment metadata is incomplete or unsafe'));
  }
  if (input.checks.length !== requiredBackupRestoreChecks.length
    || new Set(input.checks.map((item) => item.id)).size !== input.checks.length) {
    return err(domainError('INVALID_BENCHMARK', 'backup_restore_checks', 'exactly one record for each required operations check is required'));
  }

  const failures: string[] = [];
  for (const id of requiredBackupRestoreChecks) {
    const item = input.checks.find((candidate) => candidate.id === id);
    if (item === undefined) {
      failures.push(`missing:${id}`);
      continue;
    }
    if (item.observed.some((value) => !safeText(value))
      || item.artifacts.some((artifact) => !validArtifact(artifact))
      || (item.command !== undefined && !safeText(item.command))
      || (item.limitation !== undefined && !safeText(item.limitation))) {
      return err(domainError('INVALID_BENCHMARK', `backup_restore_checks.${id}`, 'operations check contains invalid or unsafe metadata'));
    }
    if (item.verdict === 'PASS' || item.verdict === 'FAIL') {
      if (item.command === undefined || item.observed.length === 0 || item.artifacts.length === 0) {
        return err(domainError(
          'INVALID_BENCHMARK',
          `backup_restore_checks.${id}`,
          'PASS/FAIL requires command, observations and retained artifact evidence',
        ));
      }
    }
    if ((item.verdict === 'NOT_RUN' || item.verdict === 'BLOCKED') && item.limitation === undefined) {
      return err(domainError(
        'INVALID_BENCHMARK',
        `backup_restore_checks.${id}`,
        'NOT_RUN/BLOCKED requires an explicit limitation',
      ));
    }
    if (item.verdict !== 'PASS') failures.push(`${item.verdict.toLowerCase()}:${id}`);
  }
  if (input.sourceCommit !== currentCommit) failures.push('source_commit_mismatch');

  return ok({
    evidence: failures.length === 0 ? 'operations-backup-restore' : 'operations-backup-restore-incomplete',
    sourceCommit: input.sourceCommit,
    allPassed: failures.length === 0,
    failures,
  });
};
