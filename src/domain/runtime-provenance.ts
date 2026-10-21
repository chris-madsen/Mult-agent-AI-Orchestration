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
  readonly schemaVersion: 1;
  readonly runtimeRoot: string;
  readonly executablePath: 'dist/bin/ace-mcp.js';
  readonly executableSha256: string;
  readonly sourceCommit: string;
  readonly sourceClean: boolean;
  readonly dirtyRelevantPaths: readonly string[];
  readonly sourceManifestSha256: string;
  readonly sourceFiles: readonly RuntimeSourceManifestEntry[];
  readonly runtime: RuntimeIdentity;
}

export interface RuntimeProvenanceObservation {
  readonly runtimeRoot: string;
  readonly executableSha256: string;
  readonly sourceCommit: string;
  readonly sourceClean: boolean;
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
  if (manifest.schemaVersion !== 1) failures.push('manifest_schema_invalid');
  if (manifest.runtimeRoot !== observed.runtimeRoot) failures.push('runtime_root_mismatch');
  if (manifest.executablePath !== 'dist/bin/ace-mcp.js' || !sha256(manifest.executableSha256)) {
    failures.push('executable_identity_invalid');
  }
  if (manifest.executableSha256 !== observed.executableSha256) failures.push('executable_digest_mismatch');
  if (!commit(manifest.sourceCommit) || manifest.sourceCommit !== observed.sourceCommit) failures.push('source_commit_mismatch');
  if (manifest.sourceClean !== true || observed.sourceClean !== true) failures.push('source_worktree_dirty');
  if (!sha256(manifest.sourceManifestSha256) || manifest.sourceManifestSha256 !== observed.sourceManifestSha256) {
    failures.push('source_manifest_mismatch');
  }
  if (!manifest.sourceFiles.every((entry) => nonEmpty(entry.path) && sha256(entry.sha256)
    && Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0)) {
    failures.push('source_manifest_invalid');
  } else if (manifestDigest(manifest.sourceFiles) !== manifest.sourceManifestSha256) {
    failures.push('manifest_content_digest_mismatch');
  }
  if (manifest.runtime.acePackage !== observed.runtime.acePackage
    || manifest.runtime.node !== observed.runtime.node
    || manifest.runtime.typescript !== observed.runtime.typescript
    || manifest.runtime.mcpClientSdk !== observed.runtime.mcpClientSdk
    || manifest.runtime.mcpServerSdk !== observed.runtime.mcpServerSdk) {
    failures.push('runtime_identity_mismatch');
  }
  return failures;
};
