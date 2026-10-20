import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { readVerifiedSemanticSnapshot, semanticSnapshotIdentity } from '../src/application/semantic-snapshot.js';
import { domainError } from '../src/domain/errors.js';
import { err, ok } from '../src/domain/result.js';
import type { WorkspaceFilePort } from '../src/application/ports.js';
import type { IndexFileIdentity } from '../src/domain/retrieval.js';

const repoPath = 'src/service.ts' as never;
const source = Buffer.from('export function stable(): string { return "ok"; }\n', 'utf8');
const digest = createHash('sha256').update(source).digest('hex') as never;
const manifest: readonly IndexFileIdentity[] = [{
  repoPath,
  sourceDigest: digest,
  candidateIds: ['candidate-1' as never],
}];

const filesReturning = (bytes: Uint8Array, sourceDigest: string): WorkspaceFilePort => ({
  canonicalizeRoot: () => Effect.succeed(ok('/repo')),
  snapshot: () => { throw new Error('not used'); },
  readExact: () => Effect.succeed(ok({ bytes, digest: sourceDigest as never })),
});

test('semantic snapshot accepts only exact bytes bound to the structural/index manifest', async () => {
  const result = await Effect.runPromise(readVerifiedSemanticSnapshot(
    filesReturning(source, digest),
    '/repo',
    [repoPath],
    manifest,
  ));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value[repoPath], source.toString('utf8'));
});

test('D1 index plus D2 worktree is rejected before TypeScript LS can be constructed', async () => {
  const changed = Buffer.from('export function stable(): string { return "changed"; }\n', 'utf8');
  const changedDigest = createHash('sha256').update(changed).digest('hex');
  const result = await Effect.runPromise(readVerifiedSemanticSnapshot(
    filesReturning(changed, changedDigest),
    '/repo',
    [repoPath],
    manifest,
  ));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'WORKTREE_RACED');
});

test('semantic snapshot does not silently skip exact-read failures', async () => {
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => { throw new Error('not used'); },
    readExact: () => Effect.succeed(err(domainError('FILE_NOT_FOUND', repoPath, 'gone'))),
  };
  const result = await Effect.runPromise(readVerifiedSemanticSnapshot(files, '/repo', [repoPath], manifest));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'FILE_NOT_FOUND');
});

test('semantic snapshot rejects a path absent from the manifest and malformed text', async () => {
  const missing = await Effect.runPromise(readVerifiedSemanticSnapshot(
    filesReturning(source, digest),
    '/repo',
    ['src/unmanifested.ts' as never],
    manifest,
  ));
  assert.equal(missing._tag, 'Err');
  if (missing._tag === 'Err') assert.equal(missing.error.code, 'INVALID_RETRIEVAL');

  const malformed = new Uint8Array([0x65, 0x78, 0x70, 0xc3, 0x28]);
  const malformedDigest = createHash('sha256').update(malformed).digest('hex') as never;
  const malformedManifest: readonly IndexFileIdentity[] = [{
    repoPath,
    sourceDigest: malformedDigest,
    candidateIds: [],
  }];
  const invalid = await Effect.runPromise(readVerifiedSemanticSnapshot(
    filesReturning(malformed, malformedDigest),
    '/repo',
    [repoPath],
    malformedManifest,
  ));
  assert.equal(invalid._tag, 'Err');
  if (invalid._tag === 'Err') assert.equal(invalid.error.code, 'INVALID_RETRIEVAL');
});

test('semantic snapshot identity changes when configuration, declarations, lock inputs or provider changes', () => {
  const base = {
    indexKey: 'a'.repeat(64),
    tsconfigIdentity: 'tsconfig:a',
    projectReferencesIdentity: 'refs:a',
    moduleResolutionIdentity: 'node-next',
    declarationsIdentity: 'decl:a',
    packageLockIdentity: 'lock:a',
    providerIdentity: 'typescript/5.9.3',
  };
  const original = semanticSnapshotIdentity(base);
  assert.notEqual(original, semanticSnapshotIdentity({ ...base, tsconfigIdentity: 'tsconfig:b' }));
  assert.notEqual(original, semanticSnapshotIdentity({ ...base, projectReferencesIdentity: 'refs:b' }));
  assert.notEqual(original, semanticSnapshotIdentity({ ...base, moduleResolutionIdentity: 'bundler' }));
  assert.notEqual(original, semanticSnapshotIdentity({ ...base, declarationsIdentity: 'decl:b' }));
  assert.notEqual(original, semanticSnapshotIdentity({ ...base, packageLockIdentity: 'lock:b' }));
  assert.notEqual(original, semanticSnapshotIdentity({ ...base, providerIdentity: 'typescript/next' }));
});
