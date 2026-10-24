export interface AceRuntimeBundleManifest {
  readonly schemaVersion: 1;
  readonly runtimeId: 'ace-harbor-runtime-v1';
  readonly sourceCommit: string;
  readonly bundleSha256: string;
  readonly taskImages: readonly { readonly reference: string; readonly digest: string }[];
  readonly pythonVersions: readonly ('3.10' | '3.11')[];
  readonly fastembed: '0.7.4';
  readonly onnxruntime: '1.31.0';
  readonly numpy: '2.5.4';
  readonly huggingfaceHub: '1.33.0';
  readonly embeddingModelRevision: string;
  readonly embeddingArtifactRevision: string;
  readonly embeddingArtifactDigest: string;
}

export const requiredAceRuntimeBundlePaths = [
  'dist/bin/ace-mcp.js',
  'dist/bin/ace-context-bridge.js',
  'dist/runtime-provenance.json',
  'scripts/harbor-ace-context-bridge.sh',
  'integrations/hermes/ace_context_engine/engine.py',
  'node_modules/effect/package.json',
  'node_modules/.bin/ast-grep',
  'node_modules/.bin/typescript-language-server',
  'runtime-manifest.json',
  'runtime/model-cache',
] as const;

const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const isDockerDigest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export const validateAceRuntimeBundleManifest = (value: unknown): readonly string[] => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['manifest_invalid'];
  const manifest = value as Record<string, unknown>;
  const taskImages = manifest.taskImages;
  const pythonVersions = manifest.pythonVersions;
  const failures: string[] = [];
  if (manifest.schemaVersion !== 1) failures.push('manifest_schema_invalid');
  if (manifest.runtimeId !== 'ace-harbor-runtime-v1') failures.push('runtime_id_mismatch');
  if (!nonEmpty(manifest.sourceCommit)) failures.push('source_commit_missing');
  if (!isSha256(manifest.bundleSha256)) failures.push('bundle_digest_invalid');
  if (!Array.isArray(taskImages) || taskImages.length === 0) failures.push('task_images_missing');
  else if (taskImages.some((item) => typeof item !== 'object' || item === null
    || !nonEmpty((item as Record<string, unknown>).reference)
    || !isDockerDigest((item as Record<string, unknown>).digest))) {
    failures.push('task_images_invalid');
  }
  if (!Array.isArray(pythonVersions) || pythonVersions.length === 0
    || pythonVersions.some((version) => version !== '3.10' && version !== '3.11')) {
    failures.push('python_versions_invalid');
  }
  for (const [field, expected] of [
    ['fastembed', '0.7.4'],
    ['onnxruntime', '1.31.0'],
    ['numpy', '2.5.4'],
    ['huggingfaceHub', '1.33.0'],
  ] as const) {
    if (manifest[field] !== expected) failures.push(`${field}_pin_invalid`);
  }
  for (const field of ['embeddingModelRevision', 'embeddingArtifactRevision', 'embeddingArtifactDigest'] as const) {
    if (!isSha256(manifest[field]) && !(field !== 'embeddingArtifactDigest' && typeof manifest[field] === 'string' && /^[a-f0-9]{40}$/u.test(manifest[field]))) {
      failures.push(`${field}_invalid`);
    }
  }
  return failures;
};


