export interface RuntimeSourceManifestEntry {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface RuntimeIdentity {
  readonly acePackage: string;
  readonly node: string;
  readonly typescript: string;
  readonly mcpClientSdk: string;
  readonly mcpServerSdk: string;
}

export interface RuntimeProvenanceManifest {
  readonly schemaVersion: 2;
  readonly runtimeId: 'ace-harbor-runtime-v1';
  readonly executablePath: 'dist/bin/ace-mcp.js';
  readonly executableSha256: string;
  readonly sourceCommit: string;
  readonly sourceCleanAtBuild: boolean;
  readonly dirtyRelevantPaths: readonly string[];
  readonly sourceManifestSha256: string;
  readonly sourceFiles: readonly RuntimeSourceManifestEntry[];
  readonly buildRuntime: RuntimeIdentity;
  readonly supportedNodeVersions: readonly string[];
  readonly bundleManifestSha256: string;
}

export interface RuntimeProvenanceObservation {
  readonly runtimeRoot: string;
  readonly runtimeId: string;
  readonly executableSha256: string;
  readonly sourceCommit: string;
  readonly sourceCleanAtBuild: boolean;
  readonly sourceManifestSha256: string;
  readonly runtime: RuntimeIdentity;
}

export const runtimeRelevantPath = (path: string): boolean =>
  path === 'package.json'
  || path === 'package-lock.json'
  || path === 'tsconfig.json'
  || path.startsWith('src/')
  || path.startsWith('scripts/');

export const sourceManifestBytes = (entries: readonly RuntimeSourceManifestEntry[]): string =>
  JSON.stringify([...entries].sort((left, right) => left.path.localeCompare(right.path)));

const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const commit = (value: string): boolean => /^[a-f0-9]{40,64}$/iu.test(value);
const nonEmpty = (value: string): boolean => value.trim().length > 0;

export const validateRuntimeProvenance = (
  manifest: RuntimeProvenanceManifest,
  observed: RuntimeProvenanceObservation,
  manifestDigest: (entries: readonly RuntimeSourceManifestEntry[]) => string,
): readonly string[] => {
  const failures: string[] = [];
  if (manifest.schemaVersion !== 2) failures.push('manifest_schema_invalid');
  if (manifest.runtimeId !== 'ace-harbor-runtime-v1' || observed.runtimeId !== manifest.runtimeId) {
    failures.push('runtime_id_mismatch');
  }
  if (manifest.executablePath !== 'dist/bin/ace-mcp.js' || !sha256(manifest.executableSha256)) {
    failures.push('executable_identity_invalid');
  }
  if (manifest.executableSha256 !== observed.executableSha256) failures.push('executable_digest_mismatch');
  if (!commit(manifest.sourceCommit) || manifest.sourceCommit !== observed.sourceCommit) failures.push('source_commit_mismatch');
  if (manifest.sourceCleanAtBuild !== true || observed.sourceCleanAtBuild !== true) failures.push('source_worktree_dirty');
  if (!sha256(manifest.sourceManifestSha256) || manifest.sourceManifestSha256 !== observed.sourceManifestSha256) {
    failures.push('source_manifest_mismatch');
  }
  if (!manifest.sourceFiles.every((entry) => nonEmpty(entry.path) && sha256(entry.sha256)
    && Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0)) {
    failures.push('source_manifest_invalid');
  } else if (manifestDigest(manifest.sourceFiles) !== manifest.sourceManifestSha256) {
    failures.push('manifest_content_digest_mismatch');
  }
  if (!manifest.supportedNodeVersions.includes(observed.runtime.node)) {
    failures.push('unsupported_node_runtime');
  }
  if (!sha256(manifest.bundleManifestSha256)) failures.push('bundle_manifest_invalid');
  if (manifest.buildRuntime.acePackage !== observed.runtime.acePackage
    || manifest.buildRuntime.typescript !== observed.runtime.typescript
    || manifest.buildRuntime.mcpClientSdk !== observed.runtime.mcpClientSdk
    || manifest.buildRuntime.mcpServerSdk !== observed.runtime.mcpServerSdk) {
    failures.push('runtime_identity_mismatch');
  }
  return failures;
};
