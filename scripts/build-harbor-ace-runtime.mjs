#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const FASTEMBED = '0.7.4';
const ONNXRUNTIME = '1.23.2';
const NUMPY = '2.2.6';
const HUGGINGFACE_HUB = '1.33.0';
const pinnedHex = (name, value, length) => {
  if (!new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(value)) {
    throw new Error(`BLOCKED: ${name} must be exactly ${length} lowercase hexadecimal characters`);
  }
  return value;
};
const embeddingModelRevision = pinnedHex('ACE_EMBEDDING_MODEL_REVISION', process.env.ACE_EMBEDDING_MODEL_REVISION || 'e8f8c211226b894fcb81acc59f3b34ba3efd5f42', 40);
const embeddingArtifactRevision = pinnedHex('ACE_EMBEDDING_ARTIFACT_REVISION', process.env.ACE_EMBEDDING_ARTIFACT_REVISION || 'faf4aa4225822f3bc6376869cb1164e8e3feedd0', 40);
const embeddingArtifactDigest = pinnedHex('ACE_EMBEDDING_ARTIFACT_DIGEST', process.env.ACE_EMBEDDING_ARTIFACT_DIGEST || '4bb74885d054d77b15c33520114d7edc19c31699bdab813d893e4f58c3afb4a1', 64);

const usage = () => {
  process.stdout.write('Usage: node scripts/build-harbor-ace-runtime.mjs --source-root <clean-checkout> --output <bundle-dir> --task-image <reference>@sha256:<64hex> [--task-image ...]\n');
};

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}
const values = { sourceRoot: undefined, output: undefined, taskImages: [] };
while (args.length > 0) {
  const name = args.shift();
  if (name === '--task-image') {
    const value = args.shift();
    if (value === undefined) throw new Error('BLOCKED: --task-image requires a value');
    values.taskImages.push(value);
  } else if (name === '--source-root') values.sourceRoot = args.shift();
  else if (name === '--output') values.output = args.shift();
  else throw new Error(`Usage error: unknown argument ${name}`);
}
if (values.sourceRoot === undefined || values.output === undefined || values.taskImages.length === 0) {
  usage();
  process.exitCode = 2;
  process.exit();
}

const sourceRoot = resolve(values.sourceRoot);
const output = resolve(values.output);

// Resolve symlinked parents before any recursive deletion. --output must never
// replace all or part of the source checkout, including through an alias.
const canonicalTarget = async (target) => {
  const suffix = [];
  let ancestor = target;
  while (true) {
    try {
      return resolve(await realpath(ancestor), ...suffix);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
};
const containsPath = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};
const sourceCanonical = await canonicalTarget(sourceRoot);
const outputCanonical = await canonicalTarget(output);
if (containsPath(sourceCanonical, outputCanonical) || containsPath(outputCanonical, sourceCanonical)) {
  throw new Error('BLOCKED: --output overlaps the source checkout; refusing recursive deletion');
}

const dockerDigest = /^(.+)@sha256:([a-f0-9]{64})$/u;
const imageRefs = values.taskImages.map((value) => {
  const match = dockerDigest.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) throw new Error(`BLOCKED: task image must be pinned by digest: ${value}`);
  return { reference: match[1], digest: `sha256:${match[2]}` };
});

const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, {
  cwd: options.cwd,
  encoding: 'utf8',
  stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ...(options.env || {}) },
});
const executionImage = (image) => {
  try {
    const localId = run('docker', ['image', 'inspect', '--format', '{{.Id}}', image.reference]).trim();
    // Execute the verified immutable IMAGE ID, never a mutable tag that could be retargeted.
    return localId === image.digest ? localId : `${image.reference}@${image.digest}`;
  } catch {
    return `${image.reference}@${image.digest}`;
  }
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileDigest = async (path) => digest(await readFile(path));
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

const sourceStatus = run('git', ['-C', sourceRoot, 'status', '--porcelain=v1', '--untracked-files=all']).trim();
if (sourceStatus.length > 0) throw new Error('BLOCKED: ACE source checkout is dirty');
const sourceCommit = run('git', ['-C', sourceRoot, 'rev-parse', 'HEAD']).trim();
if (!/^[a-f0-9]{40,64}$/iu.test(sourceCommit)) throw new Error('BLOCKED: source checkout has no valid commit');

try {
  await stat(join(sourceRoot, 'node_modules/.bin/tsc'));
  await stat(join(sourceRoot, 'node_modules/@types/node'));
} catch {
  run('npm', ['ci', '--ignore-scripts'], { cwd: sourceRoot, stdio: 'inherit' });
}

run('npm', ['run', 'build'], { cwd: sourceRoot, stdio: 'inherit' });
try {
  await stat(output);
  const writableImage = executionImage(imageRefs[0]);
  run('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${output}:/ace`, writableImage, '-lc', 'chmod -R a+rwX /ace'], { stdio: 'inherit' });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ['dist', 'src', 'scripts', 'integrations/hermes/ace_context_engine', 'package.json', 'package-lock.json', 'tsconfig.json']) {
  await cp(join(sourceRoot, path), join(output, path), { recursive: true });
}
for (const path of ['scripts/harbor-ace-context-bridge.sh', 'scripts/fastembed-worker.sh', 'scripts/fastembed-sparse-worker.sh']) {
  await chmod(join(output, path), 0o755);
}
await mkdir(join(output, 'runtime/python'), { recursive: true });
await mkdir(join(output, 'runtime/model-cache'), { recursive: true });
run('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: output, stdio: 'inherit' });

const pythonVersions = new Set();
for (const image of imageRefs) {
  const pinnedImage = executionImage(image);
  const pythonVersion = run('docker', ['run', '--rm', '--entrypoint', 'python3', pinnedImage, '-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")']).trim();
  if (pythonVersion !== '3.10' && pythonVersion !== '3.11') {
    throw new Error(`BLOCKED: unsupported task-image Python ${pythonVersion} in ${pinnedImage}`);
  }
  pythonVersions.add(pythonVersion);
  const target = `/ace/runtime/python/${pythonVersion}/site-packages`;
  await mkdir(join(output, 'runtime/python', pythonVersion, 'site-packages'), { recursive: true });
  run('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${output}:/ace`, pinnedImage, '-lc',
    `python3 -m pip install --disable-pip-version-check --no-input --target ${shellQuote(target)} fastembed==${FASTEMBED} onnxruntime==${ONNXRUNTIME} numpy==${NUMPY} huggingface-hub==${HUGGINGFACE_HUB}`], { stdio: 'inherit' });
  run('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${output}:/ace:ro`, pinnedImage, '-lc', [
    `export PYTHONPATH=${target}:/ace/scripts`,
    `python3 -c ${shellQuote('from PIL import Image; import PIL, fastembed, onnxruntime; print(f"pillow={PIL.__version__} fastembed={fastembed.__version__} onnxruntime={onnxruntime.__version__}")')}`,
  ].join(' && ')], { stdio: 'inherit' });
}

const prefetchImage = executionImage(imageRefs[0]);
const prefetchPython = [...pythonVersions][0];
const prefetchTarget = `/ace/runtime/python/${prefetchPython}/site-packages`;
run('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${output}:/ace`, prefetchImage, '-lc', [
  `export PYTHONPATH=${prefetchTarget}:/ace/scripts`,
  'export FASTEMBED_CACHE_PATH=/ace/runtime/model-cache',
  `python3 -c ${shellQuote('from fastembed import TextEmbedding, SparseTextEmbedding; TextEmbedding(model_name="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"); SparseTextEmbedding(model_name="Qdrant/bm25"); print("models_ready")')}`,
].join(' && ')], { stdio: 'inherit' });
run('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${output}:/ace`, prefetchImage, '-lc', 'chmod -R a+rX /ace/runtime'], { stdio: 'inherit' });

const walk = async (root, current = root) => {
  const entries = [];
  for (const name of (await readdir(current)).sort()) {
    const path = join(current, name);
    const info = await stat(path);
    if (info.isDirectory()) {
      // Include installed production dependencies: a package-lock pin is not proof
      // that the mounted node_modules content has not changed after npm ci.
      entries.push(...await walk(root, path));
    } else if (info.isFile() && relative(root, path) !== 'runtime-manifest.json' && relative(root, path) !== 'dist/runtime-provenance.json') {
      entries.push({ path: relative(root, path).split('\\').join('/'), sha256: await fileDigest(path), sizeBytes: info.size });
    }
  }
  return entries;
};
const bundleEntries = await walk(output);
const bundleSha256 = digest(Buffer.from(JSON.stringify(bundleEntries, null, 2) + '\n', 'utf8'));
const provenancePath = join(output, 'dist/runtime-provenance.json');
const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
provenance.bundleManifestSha256 = bundleSha256;
await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
const runtimeManifest = {
  schemaVersion: 1,
  runtimeId: 'ace-harbor-runtime-v1',
  sourceCommit,
  bundleSha256,
  taskImages: imageRefs,
  pythonVersions: [...pythonVersions].sort(),
  fastembed: FASTEMBED,
  onnxruntime: ONNXRUNTIME,
  numpy: NUMPY,
  huggingfaceHub: HUGGINGFACE_HUB,
  embeddingModelRevision,
  embeddingArtifactRevision,
  embeddingArtifactDigest,
};
await writeFile(join(output, 'runtime-manifest.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ status: 'READY', output, sourceCommit, bundleSha256, taskImages: imageRefs, pythonVersions: [...pythonVersions].sort() })}\n`);
