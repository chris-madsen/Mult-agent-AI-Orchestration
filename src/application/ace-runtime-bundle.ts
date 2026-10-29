import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { requiredAceRuntimeBundlePaths, validateAceRuntimeBundleManifest } from '../domain/ace-runtime-bundle.js';

export const missingAceRuntimeBundlePaths = (runtimeRoot: string): readonly string[] =>
  requiredAceRuntimeBundlePaths.filter((path) => !existsSync(join(runtimeRoot, path)));

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

interface BundleEntry {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

// Deliberately uses the same stable ordering and exclusions as the release builder.
// The provenance file contains bundleSha256 (circular) and is checked separately.
const bundleEntries = async (root: string, current = root): Promise<readonly BundleEntry[]> => {
  const entries: BundleEntry[] = [];
  for (const name of (await readdir(current)).sort()) {
    const path = join(current, name);
    const info = await stat(path);
    if (info.isDirectory()) {
      entries.push(...await bundleEntries(root, path));
    } else if (info.isFile()) {
      const relPath = relative(root, path).split('\\').join('/');
      if (relPath === 'runtime-manifest.json' || relPath === 'dist/runtime-provenance.json') continue;
      const bytes = await readFile(path);
      entries.push({ path: relPath, sha256: sha256(bytes), sizeBytes: info.size });
    }
  }
  return entries;
};

export const computeAceRuntimeBundleDigest = async (runtimeRoot: string): Promise<string> =>
  sha256(Buffer.from(JSON.stringify(await bundleEntries(resolve(runtimeRoot)), null, 2) + '\n', 'utf8'));

export interface AceBundleVerification {
  readonly status: 'ready' | 'not_ready';
  readonly reason: string;
  readonly identity?: string;
}

export const verifyAceRuntimeBundle = async (
  runtimeRoot: string,
  expectedDigest?: string,
): Promise<AceBundleVerification> => {
  const root = resolve(runtimeRoot);
  try {
    const missing = missingAceRuntimeBundlePaths(root);
    if (missing.length !== 0) return { status: 'not_ready', reason: `ACE runtime bundle is incomplete: ${missing.join(',')}` };
    const manifest = JSON.parse(await readFile(join(root, 'runtime-manifest.json'), 'utf8')) as Record<string, unknown>;
    const failures = validateAceRuntimeBundleManifest(manifest);
    if (failures.length > 0) return { status: 'not_ready', reason: `ACE runtime manifest invalid: ${failures.join(',')}` };
    const missingPythonPackages = (manifest.pythonVersions as string[]).flatMap((version) => [
      `runtime/python/${version}/site-packages/PIL/__init__.py`,
      `runtime/python/${version}/site-packages/fastembed/__init__.py`,
      `runtime/python/${version}/site-packages/onnxruntime/__init__.py`,
    ].filter((path) => !existsSync(join(root, path))));
    if (missingPythonPackages.length > 0) {
      return { status: 'not_ready', reason: `ACE runtime bundle is missing Python packages: ${missingPythonPackages.join(',')}` };
    }
    const declared = manifest.bundleSha256 as string;
    if (expectedDigest !== undefined && expectedDigest !== declared) {
      return { status: 'not_ready', reason: 'ACE runtime bundle digest differs from expected digest' };
    }
    const actual = await computeAceRuntimeBundleDigest(root);
    if (actual !== declared) {
      return { status: 'not_ready', reason: 'ACE runtime bundle bytes do not match manifest bundleSha256' };
    }
    const provenance = JSON.parse(await readFile(join(root, 'dist/runtime-provenance.json'), 'utf8')) as Record<string, unknown>;
    if (provenance.bundleManifestSha256 !== declared || provenance.sourceCommit !== manifest.sourceCommit) {
      return { status: 'not_ready', reason: 'ACE runtime provenance does not match bundle manifest' };
    }
    return { status: 'ready', reason: 'ACE bundle content hashes and runtime provenance verified', identity: declared };
  } catch (error) {
    return { status: 'not_ready', reason: error instanceof Error ? error.message : 'ACE runtime bundle could not be verified' };
  }
};
