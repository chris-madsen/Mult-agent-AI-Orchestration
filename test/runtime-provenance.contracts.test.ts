import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  runtimeRelevantPath,
  sourceManifestBytes,
  validateRuntimeProvenance,
  type RuntimeProvenanceManifest,
  type RuntimeProvenanceObservation,
  type RuntimeIdentity,
  type RuntimeSourceManifestEntry,
} from '../src/domain/runtime-provenance.js';

const sourceManifestSha256 = (entries: readonly RuntimeSourceManifestEntry[]): string =>
  createHash('sha256').update(Buffer.from(sourceManifestBytes(entries), 'utf8')).digest('hex');

const runtime: RuntimeIdentity = {
  acePackage: 'ace-harness@0.1.0',
  node: 'v24.15.0',
  typescript: '5.9.3',
  mcpClientSdk: '2.3.1',
  mcpServerSdk: '2.3.1',
};
const sourceFiles: readonly RuntimeSourceManifestEntry[] = [{
  path: 'src/bin/ace-mcp.ts',
  sha256: 'a'.repeat(64),
  sizeBytes: 10,
}];
const base: RuntimeProvenanceManifest = {
  schemaVersion: 1,
  runtimeRoot: '/repo',
  executablePath: 'dist/bin/ace-mcp.js',
  executableSha256: 'b'.repeat(64),
  sourceCommit: 'c'.repeat(40),
  sourceClean: true,
  dirtyRelevantPaths: [],
  sourceManifestSha256: sourceManifestSha256(sourceFiles),
  sourceFiles,
  runtime,
};
const observed: RuntimeProvenanceObservation = {
  runtimeRoot: '/repo',
  executableSha256: base.executableSha256,
  sourceCommit: base.sourceCommit,
  sourceClean: true,
  sourceManifestSha256: base.sourceManifestSha256,
  runtime,
};

test('runtime provenance accepts a clean source and matching executable', () => {
  assert.deepEqual(validateRuntimeProvenance(base, observed, sourceManifestSha256), []);
});

test('tracked source changes invalidate the bound manifest', () => {
  const changedSource = [{ ...sourceFiles[0], sha256: 'd'.repeat(64) }];
  const failures = validateRuntimeProvenance(base, {
    ...observed,
    sourceClean: false,
    sourceManifestSha256: sourceManifestSha256(changedSource),
  }, sourceManifestSha256);
  assert.ok(failures.includes('source_worktree_dirty'));
  assert.ok(failures.includes('source_manifest_mismatch'));
});

test('relevant untracked source is not treated as an absent change', () => {
  assert.equal(runtimeRelevantPath('src/untracked-runtime.ts'), true);
  assert.equal(runtimeRelevantPath('docs/untracked-note.md'), false);
  const failures = validateRuntimeProvenance(base, { ...observed, sourceClean: false }, sourceManifestSha256);
  assert.ok(failures.includes('source_worktree_dirty'));
});

test('stale or replaced dist executable fails the digest binding', () => {
  const failures = validateRuntimeProvenance(base, {
    ...observed,
    executableSha256: 'e'.repeat(64),
  }, sourceManifestSha256);
  assert.ok(failures.includes('executable_digest_mismatch'));
});

test('a runtime root mismatch cannot reuse another root manifest', () => {
  const failures = validateRuntimeProvenance(base, {
    ...observed,
    runtimeRoot: '/different-root',
  }, sourceManifestSha256);
  assert.ok(failures.includes('runtime_root_mismatch'));
});
