import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { computeAceRuntimeBundleDigest, verifyAceRuntimeBundle, missingAceRuntimeBundlePaths } from '../src/application/ace-runtime-bundle.js';
import {
  requiredAceRuntimeBundlePaths,
  validateAceRuntimeBundleManifest,
} from '../src/domain/ace-runtime-bundle.js';

const validManifest = {
  schemaVersion: 1,
  runtimeId: 'ace-harbor-runtime-v1',
  sourceCommit: 'a'.repeat(40),
  bundleSha256: 'b'.repeat(64),
  taskImages: [{ reference: 'example/task:1', digest: `sha256:${'c'.repeat(64)}` }],
  pythonVersions: ['3.10', '3.11'],
  fastembed: '0.7.4',
  onnxruntime: '1.31.0',
  numpy: '2.5.4',
  huggingfaceHub: '1.33.0',
  embeddingModelRevision: 'd'.repeat(40),
  embeddingArtifactRevision: 'e'.repeat(40),
  embeddingArtifactDigest: 'f'.repeat(64),
};

test('validates a pinned runtime bundle manifest', () => {
  assert.deepEqual(validateAceRuntimeBundleManifest(validManifest), []);
});

test('rejects a bundle manifest with missing image or provider pins', () => {
  const failures = validateAceRuntimeBundleManifest({
    ...validManifest,
    taskImages: [],
    fastembed: 'latest',
    embeddingArtifactDigest: 'unverified',
  });
  assert.ok(failures.includes('task_images_missing'));
  assert.ok(failures.includes('fastembed_pin_invalid'));
  assert.ok(failures.includes('embeddingArtifactDigest_invalid'));
});

test('reports missing runtime bundle paths instead of treating an incomplete mount as ready', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-runtime-bundle-'));
  const missing = missingAceRuntimeBundlePaths(root);
  assert.deepEqual(missing, requiredAceRuntimeBundlePaths);
  await mkdir(join(root, 'dist/bin'), { recursive: true });
  await writeFile(join(root, 'dist/bin/ace-context-bridge.js'), '');
  assert.ok(missingAceRuntimeBundlePaths(root).includes('node_modules/effect/package.json'));
});


test('verifies bundle bytes rather than accepting an unverified manifest digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-bundle-digest-'));
  for (const required of requiredAceRuntimeBundlePaths) {
    const target = join(root, required);
    if (required === 'runtime/model-cache') {
      await mkdir(target, { recursive: true });
    } else {
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, 'original');
    }
  }
  const bundleSha256 = await computeAceRuntimeBundleDigest(root);
  await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify({ ...validManifest, bundleSha256 }));
  await writeFile(join(root, 'dist/runtime-provenance.json'), JSON.stringify({
    bundleManifestSha256: bundleSha256,
    sourceCommit: validManifest.sourceCommit,
  }));
  assert.equal((await verifyAceRuntimeBundle(root, bundleSha256)).status, 'ready');
  await writeFile(join(root, 'dist/bin/ace-mcp.js'), 'modified');
  const tampered = await verifyAceRuntimeBundle(root, bundleSha256);
  assert.equal(tampered.status, 'not_ready');
  assert.match(tampered.reason, /bytes do not match/u);
});
