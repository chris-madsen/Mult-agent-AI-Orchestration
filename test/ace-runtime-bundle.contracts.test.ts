import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
  onnxruntime: '1.23.2',
  numpy: '2.2.6',
  huggingfaceHub: '1.33.0',
  embeddingModelRevision: 'd'.repeat(40),
  embeddingArtifactRevision: 'e'.repeat(40),
  embeddingArtifactDigest: 'f'.repeat(64),
};

test('validates a pinned runtime bundle manifest', () => {
  assert.deepEqual(validateAceRuntimeBundleManifest(validManifest), []);
});

test('rejects non-Git source commit identities in bundle manifests', () => {
  const failures = validateAceRuntimeBundleManifest({ ...validManifest, sourceCommit: 'not-a-git-commit' });
  assert.ok(failures.includes('source_commit_invalid'));
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
  for (const version of validManifest.pythonVersions) {
    for (const packageName of ['fastembed', 'onnxruntime']) {
      const target = join(root, 'runtime/python', version, 'site-packages', packageName, '__init__.py');
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
  const missingPythonFile = join(root, 'runtime/python/3.10/site-packages/onnxruntime/__init__.py');
  await rm(missingPythonFile);
  const missingPython = await verifyAceRuntimeBundle(root, bundleSha256);
  assert.equal(missingPython.status, 'not_ready');
  assert.match(missingPython.reason, /missing Python packages/u);
  await writeFile(missingPythonFile, 'original');
  await writeFile(join(root, 'dist/bin/ace-mcp.js'), 'modified');
  const tampered = await verifyAceRuntimeBundle(root, bundleSha256);
  assert.equal(tampered.status, 'not_ready');
  assert.match(tampered.reason, /bytes do not match/u);
});

test('Docker runtime uses the same valid NumPy pin as the Harbor bundle contract', async () => {
  const dockerfile = await readFile('Dockerfile.ace', 'utf8');
  assert.ok(dockerfile.includes('numpy==2.2.6'));
  assert.ok(dockerfile.includes('onnxruntime==1.23.2'));
  assert.ok(!dockerfile.includes('numpy==2.5.4'));
});

test('Hermes runtime probe missing-Python guard executes under POSIX sh', async () => {
  const script = await readFile('scripts/harbor-ace-runtime-probe.mjs', 'utf8');
  const line = script.split('\n').find((candidate) => candidate.trimStart().startsWith("'if ") && candidate.includes('Hermes Python runtime is not beside'));
  assert.ok(line, 'the missing-Hermes-Python guard is present');
  const guard = line.trim().slice(1, -2); // Unquote the JavaScript string passed to sh -lc.
  const result = spawnSync('sh', ['-c', `hermes_python=; ${guard}`], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
});

test('Harbor bundle builder refuses to delete the source checkout or a symlinked parent', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-harbor-builder-'));
  const checkout = join(parent, 'source');
  const alias = join(parent, 'source-alias');
  await mkdir(checkout);
  await writeFile(join(checkout, 'sentinel'), 'must survive');
  await symlink(checkout, alias, 'dir');
  try {
    for (const output of [checkout, parent, join(alias, 'bundle')]) {
      const result = spawnSync(process.execPath, [
        'scripts/build-harbor-ace-runtime.mjs',
        '--source-root', checkout,
        '--output', output,
        '--task-image', `example/task@sha256:${'a'.repeat(64)}`,
      ], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, 'overlapping output must fail');
      assert.match(result.stderr, /BLOCKED: --output overlaps the source checkout/u);
      assert.equal(await readFile(join(checkout, 'sentinel'), 'utf8'), 'must survive');
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('Harbor runtime scripts support verified local Docker image IDs', async () => {
  const builder = await readFile('scripts/build-harbor-ace-runtime.mjs', 'utf8');
  const probe = await readFile('scripts/harbor-ace-runtime-probe.mjs', 'utf8');
  assert.match(builder, /const executionImage = \(image\)/u);
  assert.match(builder, /localId === image\.digest \? localId :/u);
  assert.match(builder, /const prefetchImage = executionImage\(imageRefs\[0\]\)/u);
  assert.match(probe, /localId === imageDigest\) executionImage = localId/u);
  assert.match(probe, /readlink -f.*command -v hermes/u);
  assert.match(probe, /dirname.*hermes_bin.*python3/u);
  assert.doesNotMatch(probe, /raw\.githubusercontent\.com.*install\.sh/u);
});

test('Harbor runtime builder bootstraps missing source dependencies before TypeScript build', async () => {
  const builder = await readFile('scripts/build-harbor-ace-runtime.mjs', 'utf8');
  assert.match(builder, /node_modules\/\.bin\/tsc/u);
  assert.match(builder, /node_modules\/@types\/node/u);
  assert.match(builder, /npm', \['ci', '--ignore-scripts'\]/u);
  assert.match(builder, /chmod -R a\+rwX \/ace/u);
});

test('Harbor runtime builder validates exact embedding pins and native Python imports', async () => {
  const builder = await readFile('scripts/build-harbor-ace-runtime.mjs', 'utf8');
  assert.match(builder, /must be exactly \$\{length\} lowercase hexadecimal characters/u);
  assert.match(builder, /pinnedHex\('ACE_EMBEDDING_ARTIFACT_DIGEST'/u);
  assert.match(builder, /from PIL import Image; import PIL, fastembed, onnxruntime/u);
});
