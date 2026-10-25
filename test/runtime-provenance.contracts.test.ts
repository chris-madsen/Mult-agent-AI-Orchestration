import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyCompiledRuntimeProvenance } from '../src/application/runtime-provenance.js';
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
  schemaVersion: 2,
  runtimeId: 'ace-harbor-runtime-v1',
  executablePath: 'dist/bin/ace-mcp.js',
  executableSha256: 'b'.repeat(64),
  sourceCommit: 'c'.repeat(40),
  sourceCleanAtBuild: true,
  dirtyRelevantPaths: [],
  sourceManifestSha256: sourceManifestSha256(sourceFiles),
  sourceFiles,
  buildRuntime: runtime,
  supportedNodeVersions: ['v18.19.0', 'v22.9.0', 'v22.23.4', 'v24.15.0'],
  bundleManifestSha256: 'f'.repeat(64),
};
const observed: RuntimeProvenanceObservation = {
  runtimeRoot: '/repo',
  runtimeId: base.runtimeId,
  executableSha256: base.executableSha256,
  sourceCommit: base.sourceCommit,
  sourceCleanAtBuild: true,
  sourceManifestSha256: base.sourceManifestSha256,
  runtime,
};

test('runtime provenance accepts a clean source and matching executable', () => {
  assert.deepEqual(validateRuntimeProvenance(base, observed, sourceManifestSha256), []);
});

test('pinned Harbor task image Node 22.23.4 is accepted at execution time', () => {
  const failures = validateRuntimeProvenance(base, {
    ...observed,
    runtime: { ...runtime, node: 'v22.23.4' },
  }, sourceManifestSha256);
  assert.deepEqual(failures, []);
});

test('tracked source changes invalidate the bound manifest', () => {
  const changedSource = [{ ...sourceFiles[0], sha256: 'd'.repeat(64) }];
  const failures = validateRuntimeProvenance(base, {
    ...observed,
    sourceCleanAtBuild: false,
    sourceManifestSha256: sourceManifestSha256(changedSource),
  }, sourceManifestSha256);
  assert.ok(failures.includes('source_worktree_dirty'));
  assert.ok(failures.includes('source_manifest_mismatch'));
});

test('relevant untracked source is not treated as an absent change', () => {
  assert.equal(runtimeRelevantPath('src/untracked-runtime.ts'), true);
  assert.equal(runtimeRelevantPath('docs/untracked-note.md'), false);
  const failures = validateRuntimeProvenance(base, { ...observed, sourceCleanAtBuild: false }, sourceManifestSha256);
  assert.ok(failures.includes('source_worktree_dirty'));
});

test('stale or replaced dist executable fails the digest binding', () => {
  const failures = validateRuntimeProvenance(base, {
    ...observed,
    executableSha256: 'e'.repeat(64),
  }, sourceManifestSha256);
  assert.ok(failures.includes('executable_digest_mismatch'));
});

test('a relocated runtime root does not invalidate the logical bundle identity', () => {
  const failures = validateRuntimeProvenance(base, {
    ...observed,
    runtimeRoot: '/different-root',
  }, sourceManifestSha256);
  assert.deepEqual(failures, []);
});

test('unsupported execution Node is rejected independently of the build Node', () => {
  const failures = validateRuntimeProvenance(base, {
    ...observed,
    runtime: { ...runtime, node: 'v25.0.0' },
  }, sourceManifestSha256);
  assert.ok(failures.includes('unsupported_node_runtime'));
});

test('runtime identity mismatch is reported without requiring the build Node to match', () => {
  const failures = validateRuntimeProvenance(base, {
    ...observed,
    runtime: { ...runtime, node: 'v18.19.0', typescript: 'other' },
  }, sourceManifestSha256);
  assert.ok(failures.includes('runtime_identity_mismatch'));
  assert.ok(!failures.includes('unsupported_node_runtime'));
});

test('executing a binary from another checkout cannot reuse a clean manifest', async () => {
  const result = await verifyCompiledRuntimeProvenance(
    '/frozen-clean-checkout',
    '/different-runtime/dist/bin/ace-mcp.js',
  );
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') {
    assert.equal(result.error.code, 'NOT_READY');
    assert.match(result.error.message, /executable path does not match/u);
  }
});
