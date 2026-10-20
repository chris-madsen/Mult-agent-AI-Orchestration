import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { makeCodeCandidate, type CodeCandidate } from '../domain/retrieval.js';
import { err, ok, type Result } from '../domain/result.js';
import type { ContentDigest, RepoPath, WorkspaceId } from '../domain/workspace.js';
import type { CodeCandidateCacheEntry, CodeCandidateCachePort } from '../application/ports.js';

interface StoredCodeCandidateCacheEntry {
  readonly schemaVersion: 1;
  readonly workspaceId: WorkspaceId;
  readonly repoPath: RepoPath;
  readonly sourceDigest: ContentDigest;
  readonly providerFingerprint: string;
  readonly parserPartial: boolean;
  readonly candidates: readonly CodeCandidate[];
}

const validFingerprint = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const validDigest = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);

const keyFor = (
  workspaceId: WorkspaceId,
  repoPath: RepoPath,
  sourceDigest: ContentDigest,
  providerFingerprint: string,
): string => createHash('sha256')
  .update(workspaceId)
  .update('\0')
  .update(repoPath)
  .update('\0')
  .update(sourceDigest)
  .update('\0')
  .update(providerFingerprint)
  .digest('hex');

const persistenceError = (message: string): Result<never, DomainError> =>
  err(domainError('PERSISTENCE_FAILED', 'candidate_cache', message));

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const validRange = (value: unknown): value is CodeCandidate['range'] => {
  const range = record(value);
  return range !== undefined
    && Number.isSafeInteger(range.startLine)
    && Number.isSafeInteger(range.endLine)
    && (range.startLine as number) >= 1
    && (range.endLine as number) >= (range.startLine as number)
    && (range.startColumn === undefined || (Number.isSafeInteger(range.startColumn) && (range.startColumn as number) >= 1))
    && (range.endColumn === undefined || (Number.isSafeInteger(range.endColumn) && (range.endColumn as number) >= 1));
};

const validAnchor = (value: unknown): value is NonNullable<CodeCandidate['semanticAnchor']> => {
  const anchor = record(value);
  return anchor !== undefined
    && [anchor.line, anchor.byteColumn, anchor.endLine, anchor.endByteColumn]
      .every((item) => Number.isSafeInteger(item) && (item as number) >= 1)
    && ((anchor.endLine as number) > (anchor.line as number)
      || (anchor.endLine as number) === (anchor.line as number)
      && (anchor.endByteColumn as number) > (anchor.byteColumn as number));
};

const decodeCandidate = (
  value: unknown,
  expected: Pick<StoredCodeCandidateCacheEntry, 'workspaceId' | 'repoPath' | 'sourceDigest'>,
  index: number,
): Result<CodeCandidate, DomainError> => {
  const raw = record(value);
  if (raw === undefined
    || typeof raw.candidateId !== 'string'
    || typeof raw.workspaceId !== 'string'
    || typeof raw.repoPath !== 'string'
    || typeof raw.text !== 'string'
    || typeof raw.sourceDigest !== 'string'
    || !validDigest(raw.sourceDigest)
    || !validRange(raw.range)
    || (raw.semanticAnchor !== undefined && !validAnchor(raw.semanticAnchor))
    || !Number.isSafeInteger(raw.generation)
    || (raw.generation as number) < 1
    || !Number.isSafeInteger(raw.indexedAtMs)
    || (raw.indexedAtMs as number) < 0
    || raw.invalidated !== false
    || (raw.symbolName !== undefined && typeof raw.symbolName !== 'string')
    || (raw.conflictKey !== undefined && typeof raw.conflictKey !== 'string')
    || (raw.conflictValue !== undefined && typeof raw.conflictValue !== 'string')) {
    return err(domainError('PERSISTENCE_FAILED', `candidate_cache.candidates[${index}]`, 'cached candidate has an invalid shape'));
  }
  if (raw.workspaceId !== expected.workspaceId
    || raw.repoPath !== expected.repoPath
    || raw.sourceDigest !== expected.sourceDigest) {
    return err(domainError('PERSISTENCE_FAILED', `candidate_cache.candidates[${index}]`, 'cached candidate identity does not match its file entry'));
  }
  const checked = makeCodeCandidate({
    candidateId: raw.candidateId as CodeCandidate['candidateId'],
    workspaceId: expected.workspaceId,
    repoPath: expected.repoPath,
    range: raw.range,
    ...(raw.symbolName === undefined ? {} : { symbolName: raw.symbolName }),
    ...(raw.semanticAnchor === undefined ? {} : { semanticAnchor: raw.semanticAnchor }),
    text: raw.text,
    sourceDigest: expected.sourceDigest,
    generation: raw.generation as CodeCandidate['generation'],
    indexedAtMs: raw.indexedAtMs as number,
    ...(raw.conflictKey === undefined ? {} : { conflictKey: raw.conflictKey }),
    ...(raw.conflictValue === undefined ? {} : { conflictValue: raw.conflictValue }),
    invalidated: false,
  });
  return checked._tag === 'Err'
    ? persistenceError(`cached candidate ${index} failed domain validation`)
    : checked;
};

const decodeEntry = (
  value: unknown,
  expected: Pick<StoredCodeCandidateCacheEntry, 'workspaceId' | 'repoPath' | 'sourceDigest' | 'providerFingerprint'>,
): Result<CodeCandidateCacheEntry, DomainError> => {
  const raw = record(value);
  if (raw === undefined
    || raw.schemaVersion !== 1
    || raw.workspaceId !== expected.workspaceId
    || raw.repoPath !== expected.repoPath
    || raw.sourceDigest !== expected.sourceDigest
    || raw.providerFingerprint !== expected.providerFingerprint
    || typeof raw.parserPartial !== 'boolean'
    || !Array.isArray(raw.candidates)) {
    return persistenceError('cached candidate entry identity or shape is invalid');
  }
  const candidates: CodeCandidate[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of raw.candidates.entries()) {
    const decoded = decodeCandidate(candidate, expected, index);
    if (decoded._tag === 'Err') return decoded;
    if (ids.has(decoded.value.candidateId)) return persistenceError('cached candidate entry contains duplicate candidate IDs');
    ids.add(decoded.value.candidateId);
    candidates.push(decoded.value);
  }
  return ok({ candidates, parserPartial: raw.parserPartial });
};

export const makeFileCodeCandidateCache = async (
  rootPath: string,
): Promise<CodeCandidateCachePort> => {
  await mkdir(rootPath, { recursive: true });
  const pathFor = (workspaceId: WorkspaceId, repoPath: RepoPath, sourceDigest: ContentDigest, providerFingerprint: string): string =>
    join(rootPath, `${keyFor(workspaceId, repoPath, sourceDigest, providerFingerprint)}.json`);

  return {
    get: (input) => Effect.promise(async () => {
      if (!validFingerprint(input.providerFingerprint) || !validDigest(input.sourceDigest)) {
        return err(domainError('INVALID_INPUT', 'candidate_cache.identity', 'candidate cache requires lowercase SHA-256 source and provider fingerprints'));
      }
      const path = pathFor(input.workspaceId, input.repoPath, input.sourceDigest, input.providerFingerprint);
      try {
        const decoded = JSON.parse(await readFile(path, 'utf8')) as unknown;
        return decodeEntry(decoded, input);
      } catch (cause) {
        return (cause as NodeJS.ErrnoException).code === 'ENOENT'
          ? ok(undefined)
          : persistenceError('could not read candidate cache entry');
      }
    }),
    put: (input) => Effect.promise(async () => {
      if (!validFingerprint(input.providerFingerprint) || !validDigest(input.sourceDigest)) {
        return err(domainError('INVALID_INPUT', 'candidate_cache.identity', 'candidate cache requires lowercase SHA-256 source and provider fingerprints'));
      }
      const candidates = [...input.entry.candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
      const ids = new Set<string>();
      for (const candidate of candidates) {
        if (candidate.workspaceId !== input.workspaceId
          || candidate.repoPath !== input.repoPath
          || candidate.sourceDigest !== input.sourceDigest
          || candidate.invalidated
          || ids.has(candidate.candidateId)) {
          return err(domainError('INVALID_INPUT', 'candidate_cache.entry', 'candidate cache entry contains an identity mismatch or duplicate'));
        }
        ids.add(candidate.candidateId);
      }
      const stored: StoredCodeCandidateCacheEntry = {
        schemaVersion: 1,
        workspaceId: input.workspaceId,
        repoPath: input.repoPath,
        sourceDigest: input.sourceDigest,
        providerFingerprint: input.providerFingerprint,
        parserPartial: input.entry.parserPartial,
        candidates,
      };
      const path = pathFor(input.workspaceId, input.repoPath, input.sourceDigest, input.providerFingerprint);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(stored), { flag: 'wx' });
        await rename(temporary, path);
        return ok(undefined);
      } catch {
        await rm(temporary, { force: true }).catch(() => undefined);
        return persistenceError('could not atomically persist candidate cache entry');
      }
    }),
  };
};
