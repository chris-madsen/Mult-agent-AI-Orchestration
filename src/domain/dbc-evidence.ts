import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export type DbcId =
  | 'DBC-01' | 'DBC-02' | 'DBC-03' | 'DBC-04' | 'DBC-05' | 'DBC-06' | 'DBC-07'
  | 'DBC-08' | 'DBC-09' | 'DBC-10' | 'DBC-11' | 'DBC-12' | 'DBC-13' | 'DBC-14';

export type DbcVerdict = 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED';

export interface DbcArtifactEvidence {
  readonly path: string;
  readonly sha256: string;
  readonly kind: string;
}

export interface DbcEvidenceRecord {
  readonly dbcId: DbcId;
  readonly verdict: DbcVerdict;
  readonly sourceCommit: string;
  readonly fixtureSha256?: string;
  readonly command?: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly credentialScope: string;
  readonly requestIds: readonly string[];
  readonly artifacts: readonly DbcArtifactEvidence[];
  readonly observed: readonly string[];
  readonly limitation?: string;
}

export interface DbcEvidenceManifest {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly records: readonly DbcEvidenceRecord[];
}

const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const commitSha = (value: string): boolean => /^[a-f0-9]{40,64}$/u.test(value);
const nonEmpty = (value: string): boolean => value.trim().length > 0;

const secretLike = (value: string): boolean => {
  const normalized = value.trim();
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(normalized)) return true;
  if (/(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*\S+/iu.test(normalized)) return true;
  if (/^ya29\.[A-Za-z0-9._-]+$/u.test(normalized)) return true;
  if (/^gh[pousr]_[A-Za-z0-9]{20,}$/u.test(normalized)) return true;
  return false;
};

const validateArtifact = (
  artifact: DbcArtifactEvidence,
  index: number,
): Result<DbcArtifactEvidence, DomainError> => {
  if (!nonEmpty(artifact.path) || artifact.path.startsWith('/') || artifact.path.includes('\\')
    || artifact.path.split('/').some((segment) => segment === '..' || segment === '.' || segment.length === 0)) {
    return err(domainError('INVALID_BENCHMARK', `artifacts[${index}].path`, 'artifact path must be non-empty and repository-relative'));
  }
  if (!sha256(artifact.sha256)) {
    return err(domainError('INVALID_BENCHMARK', `artifacts[${index}].sha256`, 'artifact digest must be lowercase SHA-256'));
  }
  if (!nonEmpty(artifact.kind)) {
    return err(domainError('INVALID_BENCHMARK', `artifacts[${index}].kind`, 'artifact kind is required'));
  }
  return ok({ ...artifact, path: artifact.path.trim(), kind: artifact.kind.trim() });
};

export const validateDbcEvidenceRecord = (
  input: DbcEvidenceRecord,
): Result<DbcEvidenceRecord, DomainError> => {
  if (!/^DBC-(?:0[1-9]|1[0-4])$/u.test(input.dbcId)) {
    return err(domainError('INVALID_BENCHMARK', 'dbc_id', 'DBC id must be DBC-01 through DBC-14'));
  }
  if (!commitSha(input.sourceCommit)) {
    return err(domainError('INVALID_BENCHMARK', 'source_commit', 'source commit must be a 40-64 character hexadecimal Git SHA'));
  }
  if (input.fixtureSha256 !== undefined && !sha256(input.fixtureSha256)) {
    return err(domainError('INVALID_BENCHMARK', 'fixture_sha256', 'fixture digest must be lowercase SHA-256'));
  }
  if (!nonEmpty(input.credentialScope) || secretLike(input.credentialScope)) {
    return err(domainError('INVALID_BENCHMARK', 'credential_scope', 'credential scope must describe authorization without containing credentials'));
  }
  const versions = Object.entries(input.toolVersions);
  if (versions.length === 0 || versions.some(([name, version]) => !nonEmpty(name) || !nonEmpty(version) || secretLike(version))) {
    return err(domainError('INVALID_BENCHMARK', 'tool_versions', 'tool versions must be non-empty metadata and contain no secrets'));
  }
  if (input.requestIds.some((value) => !nonEmpty(value) || secretLike(value))) {
    return err(domainError('INVALID_BENCHMARK', 'request_ids', 'request ids must be non-empty safe metadata'));
  }
  if (input.observed.some((value) => !nonEmpty(value) || secretLike(value))) {
    return err(domainError('INVALID_BENCHMARK', 'observed', 'observations must be non-empty and must not contain credentials'));
  }
  if (input.command !== undefined && (!nonEmpty(input.command) || secretLike(input.command))) {
    return err(domainError('INVALID_BENCHMARK', 'command', 'evidence command must be non-empty and must not embed credentials'));
  }
  if (input.limitation !== undefined && (!nonEmpty(input.limitation) || secretLike(input.limitation))) {
    return err(domainError('INVALID_BENCHMARK', 'limitation', 'limitation must be non-empty safe text'));
  }
  const artifacts: DbcArtifactEvidence[] = [];
  for (const [index, artifact] of input.artifacts.entries()) {
    const checked = validateArtifact(artifact, index);
    if (checked._tag === 'Err') return checked;
    artifacts.push(checked.value);
  }

  if (input.verdict === 'PASS' || input.verdict === 'FAIL') {
    if (input.command === undefined || input.fixtureSha256 === undefined || input.observed.length === 0 || artifacts.length === 0) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'evidence',
        'PASS/FAIL requires exact command, fixture digest, observations and at least one retained artifact',
      ));
    }
  }
  if (input.verdict === 'PASS' && input.dbcId === 'DBC-12' && input.requestIds.length === 0) {
    return err(domainError('INVALID_BENCHMARK', 'request_ids', 'DBC-12 PASS requires request-correlated provider evidence'));
  }
  if ((input.verdict === 'NOT_RUN' || input.verdict === 'BLOCKED') && input.limitation === undefined) {
    return err(domainError('INVALID_BENCHMARK', 'limitation', 'NOT_RUN/BLOCKED requires an explicit reason'));
  }

  return ok({
    ...input,
    sourceCommit: input.sourceCommit.toLowerCase(),
    ...(input.fixtureSha256 === undefined ? {} : { fixtureSha256: input.fixtureSha256.toLowerCase() }),
    credentialScope: input.credentialScope.trim(),
    toolVersions: Object.fromEntries(versions.map(([name, version]) => [name.trim(), version.trim()])),
    requestIds: [...new Set(input.requestIds.map((value) => value.trim()))],
    artifacts,
    observed: input.observed.map((value) => value.trim()),
    ...(input.command === undefined ? {} : { command: input.command.trim() }),
    ...(input.limitation === undefined ? {} : { limitation: input.limitation.trim() }),
  });
};

export const makeDbcEvidenceManifest = (
  records: readonly DbcEvidenceRecord[],
  generatedAt: string,
): Result<DbcEvidenceManifest, DomainError> => {
  if (records.length === 0) return err(domainError('INVALID_BENCHMARK', 'records', 'DBC evidence manifest must contain at least one record'));
  if (Number.isNaN(Date.parse(generatedAt))) {
    return err(domainError('INVALID_BENCHMARK', 'generated_at', 'generatedAt must be an ISO-compatible timestamp'));
  }
  const ids = new Set<DbcId>();
  const validated: DbcEvidenceRecord[] = [];
  for (const record of records) {
    if (ids.has(record.dbcId)) {
      return err(domainError('INVALID_BENCHMARK', 'records', 'DBC evidence manifest must contain at most one record per DBC id'));
    }
    const checked = validateDbcEvidenceRecord(record);
    if (checked._tag === 'Err') return checked;
    ids.add(checked.value.dbcId);
    validated.push(checked.value);
  }
  return ok({
    schemaVersion: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    records: validated.sort((left, right) => left.dbcId.localeCompare(right.dbcId)),
  });
};

export const dbcAcceptanceSummary = (
  manifest: DbcEvidenceManifest,
): {
  readonly pass: number;
  readonly fail: number;
  readonly notRun: number;
  readonly blocked: number;
  readonly allPassed: boolean;
} => {
  const count = (verdict: DbcVerdict): number => manifest.records.filter((record) => record.verdict === verdict).length;
  const pass = count('PASS');
  const fail = count('FAIL');
  const notRun = count('NOT_RUN');
  const blocked = count('BLOCKED');
  return {
    pass,
    fail,
    notRun,
    blocked,
    allPassed: manifest.records.length === 14 && pass === 14,
  };
};
