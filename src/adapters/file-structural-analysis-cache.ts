import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { makeStructuralAnalysis, type StructuralAnalysis } from '../domain/semantic.js';
import { err, ok, type Result } from '../domain/result.js';
import type { StructuralAnalysisCachePort } from '../application/ports.js';

interface StoredStructuralAnalysis {
  readonly schemaVersion: 1;
  readonly providerFingerprint: string;
  readonly repoPath: string;
  readonly sourceDigest: string;
  readonly symbols: StructuralAnalysis['symbols'];
  readonly hasSyntaxErrors: boolean;
}

const validFingerprint = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);

const keyFor = (repoPath: string, sourceDigest: string, providerFingerprint: string): string =>
  createHash('sha256')
    .update(providerFingerprint)
    .update('\0')
    .update(repoPath)
    .update('\0')
    .update(sourceDigest)
    .digest('hex');

const persistenceError = (message: string): Result<never, DomainError> =>
  err(domainError('PERSISTENCE_FAILED', 'structural_cache', message));

export const makeFileStructuralAnalysisCache = async (
  rootPath: string,
): Promise<StructuralAnalysisCachePort> => {
  await mkdir(rootPath, { recursive: true });

  const pathFor = (repoPath: string, sourceDigest: string, providerFingerprint: string): string =>
    join(rootPath, `${keyFor(repoPath, sourceDigest, providerFingerprint)}.json`);

  return {
    get: (input) => Effect.promise(async () => {
      if (!validFingerprint(input.providerFingerprint)) {
        return err(domainError('INVALID_INPUT', 'provider_fingerprint', 'structural cache requires a lowercase SHA-256 provider fingerprint'));
      }
      const path = pathFor(input.repoPath, input.sourceDigest, input.providerFingerprint);
      let decoded: unknown;
      try {
        decoded = JSON.parse(await readFile(path, 'utf8')) as unknown;
      } catch (cause) {
        return (cause as NodeJS.ErrnoException).code === 'ENOENT'
          ? ok(undefined)
          : persistenceError('could not read structural cache entry');
      }
      if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
        return persistenceError('structural cache entry is not an object');
      }
      const stored = decoded as Partial<StoredStructuralAnalysis>;
      if (stored.schemaVersion !== 1
        || stored.providerFingerprint !== input.providerFingerprint
        || stored.repoPath !== input.repoPath
        || stored.sourceDigest !== input.sourceDigest
        || !Array.isArray(stored.symbols)
        || typeof stored.hasSyntaxErrors !== 'boolean') {
        return persistenceError('structural cache entry identity does not match the requested source/provider');
      }
      const checked = makeStructuralAnalysis({
        repoPath: stored.repoPath,
        sourceDigest: stored.sourceDigest,
        symbols: stored.symbols,
        hasSyntaxErrors: stored.hasSyntaxErrors,
      });
      return checked._tag === 'Err'
        ? persistenceError('structural cache entry failed domain validation')
        : ok(checked.value);
    }),
    put: (input) => Effect.promise(async () => {
      if (!validFingerprint(input.providerFingerprint)) {
        return err(domainError('INVALID_INPUT', 'provider_fingerprint', 'structural cache requires a lowercase SHA-256 provider fingerprint'));
      }
      const checked = makeStructuralAnalysis({
        repoPath: input.analysis.repoPath,
        sourceDigest: input.analysis.sourceDigest,
        symbols: input.analysis.symbols,
        hasSyntaxErrors: input.analysis.hasSyntaxErrors,
      });
      if (checked._tag === 'Err') return checked;

      const stored: StoredStructuralAnalysis = {
        schemaVersion: 1,
        providerFingerprint: input.providerFingerprint,
        repoPath: checked.value.repoPath,
        sourceDigest: checked.value.sourceDigest,
        symbols: checked.value.symbols,
        hasSyntaxErrors: checked.value.hasSyntaxErrors,
      };
      const path = pathFor(stored.repoPath, stored.sourceDigest, stored.providerFingerprint);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(stored), { flag: 'wx' });
        await rename(temporary, path);
        return ok(undefined);
      } catch {
        await rm(temporary, { force: true }).catch(() => undefined);
        return persistenceError('could not atomically persist structural cache entry');
      }
    }),
  };
};
