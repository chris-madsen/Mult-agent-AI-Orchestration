import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type K3sWorktreeCheckId =
  | 'K3S-01' | 'K3S-02' | 'K3S-03' | 'K3S-04' | 'K3S-05'
  | 'K3S-06' | 'K3S-07' | 'K3S-08' | 'K3S-09' | 'K3S-10';

export type K3sWorktreeVerdict = 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED';

export interface K3sWorktreeArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly kind: string;
}

export interface K3sWorktreeCheck {
  readonly id: K3sWorktreeCheckId;
  readonly verdict: K3sWorktreeVerdict;
  readonly command?: string;
  readonly observed: readonly string[];
  readonly artifacts: readonly K3sWorktreeArtifact[];
  readonly limitation?: string;
}

export interface K3sWorktreeEvidenceInput {
  readonly schemaVersion: 1;
  readonly sourceCommit: string;
  readonly generatedAt: string;
  readonly environment: {
    readonly k3sVersion: string;
    readonly nodeVersion: string;
    readonly helperVersion: string;
    readonly workspaceIdHash: string;
  };
  readonly checks: readonly K3sWorktreeCheck[];
}

export interface K3sWorktreeEvidenceVerdict {
  readonly evidence: 'real-k3s-live-worktree' | 'k3s-live-worktree-incomplete';
  readonly sourceCommit: string;
  readonly allPassed: boolean;
  readonly failures: readonly string[];
}

export const requiredK3sWorktreeChecks: readonly K3sWorktreeCheckId[] = [
  'K3S-01', 'K3S-02', 'K3S-03', 'K3S-04', 'K3S-05',
  'K3S-06', 'K3S-07', 'K3S-08', 'K3S-09', 'K3S-10',
];

const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const commitSha = (value: string): boolean => /^[a-f0-9]{40,64}$/u.test(value);
const nonEmpty = (value: string): boolean => value.trim().length > 0;

const safeText = (value: string): boolean =>
  nonEmpty(value)
  && !/(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|private[_-]?key)\s*[:=]\s*\S+/iu.test(value)
  && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value);

const validArtifact = (artifact: K3sWorktreeArtifact): boolean =>
  nonEmpty(artifact.path)
  && !artifact.path.startsWith('/')
  && !artifact.path.includes('\\')
  && !artifact.path.split('/').some((part) => part === '' || part === '.' || part === '..')
  && sha256(artifact.sha256)
  && safeText(artifact.kind);

export const evaluateK3sWorktreeEvidence = (
  input: K3sWorktreeEvidenceInput,
  currentCommit: string,
): Result<K3sWorktreeEvidenceVerdict, DomainError> => {
  if (input.schemaVersion !== 1 || !commitSha(input.sourceCommit) || !commitSha(currentCommit)
    || Number.isNaN(Date.parse(input.generatedAt))) {
    return err(domainError('INVALID_BENCHMARK', 'k3s_evidence', 'k3s evidence identity/timestamp is invalid'));
  }
  const env = input.environment;
  if (![env.k3sVersion, env.nodeVersion, env.helperVersion].every(safeText)
    || !sha256(env.workspaceIdHash)) {
    return err(domainError('INVALID_BENCHMARK', 'k3s_environment', 'k3s environment metadata is incomplete or unsafe'));
  }
  if (input.checks.length !== requiredK3sWorktreeChecks.length
    || new Set(input.checks.map((item) => item.id)).size !== input.checks.length) {
    return err(domainError('INVALID_BENCHMARK', 'k3s_checks', 'exactly one record for each required k3s check is required'));
  }
  const failures: string[] = [];
  for (const id of requiredK3sWorktreeChecks) {
    const item = input.checks.find((candidate) => candidate.id === id);
    if (item === undefined) {
      failures.push(`missing:${id}`);
      continue;
    }
    if (item.observed.some((value) => !safeText(value))
      || item.artifacts.some((artifact) => !validArtifact(artifact))
      || (item.command !== undefined && !safeText(item.command))
      || (item.limitation !== undefined && !safeText(item.limitation))) {
      return err(domainError('INVALID_BENCHMARK', `k3s_checks.${id}`, 'k3s check contains invalid or unsafe metadata'));
    }
    if (item.verdict === 'PASS' || item.verdict === 'FAIL') {
      if (item.command === undefined || item.observed.length === 0 || item.artifacts.length === 0) {
        return err(domainError('INVALID_BENCHMARK', `k3s_checks.${id}`, 'PASS/FAIL requires command, observations and retained artifact evidence'));
      }
    }
    if ((item.verdict === 'NOT_RUN' || item.verdict === 'BLOCKED') && item.limitation === undefined) {
      return err(domainError('INVALID_BENCHMARK', `k3s_checks.${id}`, 'NOT_RUN/BLOCKED requires an explicit limitation'));
    }
    if (item.verdict !== 'PASS') failures.push(`${item.verdict.toLowerCase()}:${id}`);
  }
  if (input.sourceCommit !== currentCommit) failures.push('source_commit_mismatch');
  return ok({
    evidence: failures.length === 0 ? 'real-k3s-live-worktree' : 'k3s-live-worktree-incomplete',
    sourceCommit: input.sourceCommit,
    allPassed: failures.length === 0,
    failures,
  });
};
