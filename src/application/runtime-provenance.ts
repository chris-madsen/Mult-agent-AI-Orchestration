import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  sourceManifestBytes,
  validateRuntimeProvenance,
  type RuntimeIdentity,
  type RuntimeProvenanceManifest,
  type RuntimeProvenanceObservation,
  type RuntimeSourceManifestEntry,
} from '../domain/runtime-provenance.js';

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sourceManifestDigest = (entries: readonly RuntimeSourceManifestEntry[]): string =>
  digest(Buffer.from(sourceManifestBytes(entries), 'utf8'));

const readSourceFiles = async (
  runtimeRoot: string,
  paths: readonly string[],
): Promise<readonly RuntimeSourceManifestEntry[]> => Promise.all(paths.map(async (path) => {
  const bytes = await readFile(join(runtimeRoot, path));
  return { path, sha256: digest(bytes), sizeBytes: bytes.byteLength };
}));

const readRuntimeIdentity = async (runtimeRoot: string): Promise<RuntimeIdentity> => {
  const packageBytes = await readFile(join(runtimeRoot, 'package.json'));
  const packageJson = JSON.parse(packageBytes.toString('utf8')) as Record<string, unknown>;
  const dependencies = typeof packageJson.dependencies === 'object' && packageJson.dependencies !== null
    ? packageJson.dependencies as Record<string, unknown>
    : {};
  return {
    acePackage: `${String(packageJson.name ?? 'unknown')}@${String(packageJson.version ?? 'unknown')}`,
    node: process.version,
    typescript: String(dependencies.typescript ?? 'unknown'),
    mcpClientSdk: String(dependencies['@modelcontextprotocol/client'] ?? 'unknown'),
    mcpServerSdk: String(dependencies['@modelcontextprotocol/server'] ?? 'unknown'),
  };
};

const currentObservation = async (
  runtimeRoot: string,
  manifest: RuntimeProvenanceManifest,
): Promise<RuntimeProvenanceObservation> => {
  const sourceFiles = await readSourceFiles(runtimeRoot, manifest.sourceFiles.map((entry) => entry.path));
  const executable = await readFile(join(runtimeRoot, 'dist/bin/ace-mcp.js'));
  return {
    runtimeRoot,
    runtimeId: process.env.ACE_RUNTIME_ID?.trim() || 'ace-harbor-runtime-v1',
    executableSha256: digest(executable),
    sourceCommit: manifest.sourceCommit,
    sourceCleanAtBuild: manifest.sourceCleanAtBuild,
    sourceManifestSha256: sourceManifestDigest(sourceFiles),
    runtime: await readRuntimeIdentity(runtimeRoot),
  };
};

export const verifyCompiledRuntimeProvenance = async (
  runtimeRootInput: string,
  runningExecutablePath: string,
): Promise<Result<RuntimeProvenanceManifest, ReturnType<typeof domainError>>> => {
  const runtimeRoot = resolve(runtimeRootInput);
  // Check the module Node is *actually executing*, not a clean checkout
  // that ACE_RUNTIME_ROOT points to while another executable runs.
  if (resolve(runningExecutablePath) !== resolve(runtimeRoot, 'dist/bin/ace-mcp.js')) {
    return err(domainError('NOT_READY', 'runtime_provenance', 'compiled executable path does not match the verified runtime root'));
  }
  try {
    const manifestBytes = await readFile(join(runtimeRoot, 'dist/runtime-provenance.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as RuntimeProvenanceManifest;
    const observed = await currentObservation(runtimeRoot, manifest);
    const failures = validateRuntimeProvenance(manifest, observed, sourceManifestDigest);
    return failures.length === 0
      ? ok(manifest)
      : err(domainError('NOT_READY', 'runtime_provenance', `compiled ACE runtime provenance rejected: ${failures.join(',')}`));
  } catch (cause) {
    return err(domainError(
      'NOT_READY',
      'runtime_provenance',
      `compiled ACE runtime provenance unavailable: ${cause instanceof Error ? cause.message : 'unknown error'}`,
    ));
  }
};
