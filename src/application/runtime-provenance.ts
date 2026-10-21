import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  runtimeRelevantPath,
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

const gitOutput = (runtimeRoot: string, args: readonly string[]): Result<string, Error> => {
  try {
    return ok(execFileSync('git', ['-C', runtimeRoot, ...args], { encoding: 'utf8' }).trim());
  } catch (cause) {
    return err(cause instanceof Error ? cause : new Error('git command failed'));
  }
};

const relevantPaths = (runtimeRoot: string): Result<readonly string[], Error> => {
  const output = gitOutput(runtimeRoot, ['ls-files', '--cached', '--others', '--exclude-standard']);
  if (output._tag === 'Err') return output;
  return ok(output.value.split('\n').filter((path) => path.length > 0 && runtimeRelevantPath(path)).sort());
};

const dirtyRelevantPaths = (runtimeRoot: string): Result<readonly string[], Error> => {
  const output = gitOutput(runtimeRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (output._tag === 'Err') return output;
  const paths = output.value.split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).split(' -> ').at(-1) ?? '')
    .filter((path) => runtimeRelevantPath(path));
  return ok([...new Set(paths)].sort());
};

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

const currentObservation = async (runtimeRoot: string): Promise<RuntimeProvenanceObservation> => {
  const paths = relevantPaths(runtimeRoot);
  if (paths._tag === 'Err') throw paths.error;
  const dirty = dirtyRelevantPaths(runtimeRoot);
  if (dirty._tag === 'Err') throw dirty.error;
  const sourceFiles = await readSourceFiles(runtimeRoot, paths.value);
  const executable = await readFile(join(runtimeRoot, 'dist/bin/ace-mcp.js'));
  const revision = gitOutput(runtimeRoot, ['rev-parse', 'HEAD']);
  if (revision._tag === 'Err') throw revision.error;
  return {
    runtimeRoot,
    executableSha256: digest(executable),
    sourceCommit: revision.value,
    sourceClean: dirty.value.length === 0,
    sourceManifestSha256: sourceManifestDigest(sourceFiles),
    runtime: await readRuntimeIdentity(runtimeRoot),
  };
};

export const verifyCompiledRuntimeProvenance = async (
  runtimeRootInput: string,
): Promise<Result<RuntimeProvenanceManifest, ReturnType<typeof domainError>>> => {
  const runtimeRoot = resolve(runtimeRootInput);
  try {
    const manifestBytes = await readFile(join(runtimeRoot, 'dist/runtime-provenance.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as RuntimeProvenanceManifest;
    const observed = await currentObservation(runtimeRoot);
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
