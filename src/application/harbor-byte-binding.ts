import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { domainError, type DomainError } from '../domain/errors.js';
import {
  effectiveHarborConfigurationPayload,
  harborTaskBindingDigestInput,
  type HarborExternalEvidence,
} from '../domain/harbor-byte-binding.js';
import { normalizeHarborJob, type NormalizedHarborJob } from '../domain/harbor-three-arm.js';
import { err, ok, type Result } from '../domain/result.js';

export interface HarborByteBindingVerification {
  readonly taskManifestSha256: string;
  readonly taskBytesSha256: string;
  readonly configBytesSha256: string | null;
  readonly effectiveConfigSha256: string;
}

export interface HarborByteBindingOptions {
  readonly workspaceRoot: string;
  readonly expectedModelIdentity?: string;
  readonly expectedProviderIdentity?: string;
  readonly expectedRuntimeImageIdentity?: string;
}

class HarborBindingError extends Error {
  readonly domainError: DomainError;

  constructor(error: DomainError) {
    super(error.message);
    this.name = 'HarborBindingError';
    this.domainError = error;
  }
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sha256Text = (value: string): string => sha256(Buffer.from(value, 'utf8'));
const escapeRoot = (value: string): boolean => {
  const normalized = value.split(sep).join('/');
  return normalized === '..' || normalized.startsWith('../');
};

const resolveBoundPath = (workspaceRoot: string, boundPath: string): string => {
  const root = resolve(workspaceRoot);
  if (isAbsolute(boundPath)) return resolve(boundPath);
  const candidate = resolve(root, boundPath);
  const containment = relative(root, candidate);
  if (escapeRoot(containment) || isAbsolute(containment)) throw new HarborBindingError(domainError('PATH_ESCAPE', 'binding.path', 'Harbor binding path escapes the workspace root'));
  return candidate;
};

const hashPathBytes = async (path: string): Promise<string> => {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) throw new HarborBindingError(domainError('PATH_ESCAPE', 'binding.path', 'Harbor binding does not follow symbolic links'));
  if (metadata.isFile()) return sha256(await readFile(path));
  if (!metadata.isDirectory()) throw new HarborBindingError(domainError('INVALID_BENCHMARK', 'binding.path', 'Harbor binding path must be a regular file or directory'));
  const entries = (await readdir(path, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const hash = createHash('sha256');
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new HarborBindingError(domainError('PATH_ESCAPE', 'binding.path', 'Harbor binding does not follow symbolic links'));
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      hash.update(`directory\0${entry.name}\0`, 'utf8');
      hash.update(await hashPathBytes(child), 'utf8');
    } else if (entry.isFile()) {
      hash.update(`file\0${entry.name}\0`, 'utf8');
      hash.update(await hashPathBytes(child), 'utf8');
    } else {
      throw new HarborBindingError(domainError('INVALID_BENCHMARK', 'binding.path', 'Harbor binding directory contains an unsupported entry'));
    }
  }
  return hash.digest('hex');
};

export const hashHarborPathBytes = hashPathBytes;
export const hashHarborText = sha256Text;

const errorFromUnknown = (cause: unknown): DomainError => {
  if (cause instanceof HarborBindingError) return cause.domainError;
  if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
    return domainError('FILE_NOT_FOUND', 'binding.path', 'Harbor binding path does not exist');
  }
  if (typeof cause === 'object' && cause !== null && 'code' in cause && 'path' in cause && 'message' in cause
    && typeof cause.code === 'string' && typeof cause.path === 'string' && typeof cause.message === 'string') {
    return cause as DomainError;
  }
  return domainError('EXTERNAL_UNAVAILABLE', 'binding.path', 'Harbor binding bytes could not be read');
};

const verifyTaskBindings = async (
  evidence: HarborExternalEvidence,
  normalized: NormalizedHarborJob,
  workspaceRoot: string,
): Promise<{ readonly taskBytesSha256: string } | DomainError> => {
  const taskPaths = new Set(normalized.tasks);
  const boundTaskPaths = new Set(evidence.taskBindings.map((binding) => binding.path));
  if ([...taskPaths].some((path) => !boundTaskPaths.has(path))) {
    return domainError('DIGEST_MISMATCH', 'binding.task_bindings', 'effective job contains a task path absent from the frozen task bindings');
  }
  for (const binding of evidence.taskBindings) {
    if (!taskPaths.has(binding.path)) return domainError('DIGEST_MISMATCH', 'binding.task_bindings', `frozen task is not present in the effective job: ${binding.path}`);
    const actual = await hashPathBytes(resolveBoundPath(workspaceRoot, binding.path));
    if (actual !== binding.sha256) return domainError('DIGEST_MISMATCH', `binding.task_bindings.${binding.id}`, 'actual task bytes do not match the frozen SHA-256');
  }
  const actualTaskBytesSha256 = sha256Text(harborTaskBindingDigestInput(evidence.taskBindings));
  if (actualTaskBytesSha256 !== evidence.taskBytesSha256) return domainError('DIGEST_MISMATCH', 'binding.task_bytes_sha256', 'task byte binding aggregate does not match its entries');
  return { taskBytesSha256: actualTaskBytesSha256 };
};

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const verifyManifestBinding = async (
  manifestPath: string,
  evidence: HarborExternalEvidence,
): Promise<DomainError | undefined> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse((await readFile(manifestPath)).toString('utf8')) as unknown;
  } catch {
    return domainError('INVALID_BENCHMARK', 'binding.task_manifest', 'task manifest is not valid JSON');
  }
  const root = object(parsed);
  const repositories = Array.isArray(root?.repositories) ? root.repositories : undefined;
  const tasks = Array.isArray(root?.tasks) ? root.tasks : undefined;
  if (root?.schemaVersion !== 1 || root.status !== 'frozen_harbor_task_manifest' || repositories === undefined || tasks === undefined) {
    return domainError('INVALID_BENCHMARK', 'binding.task_manifest', 'task manifest schema/status is not the frozen Harbor schema');
  }
  const manifestRevisions = new Map<string, string>();
  for (const raw of repositories) {
    const repository = object(raw);
    if (typeof repository?.id !== 'string' || typeof repository.revision !== 'string') return domainError('INVALID_BENCHMARK', 'binding.task_manifest.repositories', 'task manifest repository entry is invalid');
    manifestRevisions.set(repository.id, repository.revision);
  }
  if (manifestRevisions.size !== repositories.length
    || manifestRevisions.size !== Object.keys(evidence.repositoryRevisions).length
    || Object.entries(evidence.repositoryRevisions).some(([id, revision]) => manifestRevisions.get(id) !== revision)) {
    return domainError('DIGEST_MISMATCH', 'binding.repository_revisions', 'task manifest repository revisions do not match the frozen evidence');
  }
  const manifestTasks = new Map<string, { readonly repositoryId: string; readonly path: string; readonly sha256: string }>();
  for (const raw of tasks) {
    const task = object(raw);
    if (typeof task?.id !== 'string' || typeof task.repositoryId !== 'string' || typeof task.path !== 'string' || typeof task.sha256 !== 'string') {
      return domainError('INVALID_BENCHMARK', 'binding.task_manifest.tasks', 'task manifest task entry is invalid');
    }
    manifestTasks.set(task.id, { repositoryId: task.repositoryId, path: task.path, sha256: task.sha256 });
  }
  if (manifestTasks.size !== tasks.length
    || manifestTasks.size !== evidence.taskBindings.length
    || evidence.taskBindings.some((binding) => {
      const task = manifestTasks.get(binding.id);
      return task === undefined
        || task.repositoryId !== binding.repositoryId
        || task.path !== binding.path
        || task.sha256 !== binding.sha256;
    })) {
    return domainError('DIGEST_MISMATCH', 'binding.task_bindings', 'task manifest entries do not match the frozen task byte bindings');
  }
  return undefined;
};

export const verifyHarborJobByteBinding = async (
  value: unknown,
  options: HarborByteBindingOptions,
): Promise<Result<HarborByteBindingVerification, DomainError>> => {
  const normalized = normalizeHarborJob('native', value);
  if (normalized._tag === 'Err') return normalized;
  const evidence = normalized.value.externalEvidence;
  if (evidence === undefined) return err(domainError('INVALID_BENCHMARK', 'binding', 'Harbor job has no external byte binding'));
  try {
    const manifestPath = resolveBoundPath(options.workspaceRoot, evidence.taskManifestPath);
    const manifestSha256 = await hashPathBytes(manifestPath);
    if (manifestSha256 !== evidence.taskManifestSha256) return err(domainError('DIGEST_MISMATCH', 'binding.task_manifest_sha256', 'actual task manifest bytes do not match the frozen SHA-256'));
    const manifestBindingError = await verifyManifestBinding(manifestPath, evidence);
    if (manifestBindingError !== undefined) return err(manifestBindingError);
    if (options.expectedModelIdentity !== undefined && evidence.modelIdentity !== options.expectedModelIdentity) return err(domainError('DIGEST_MISMATCH', 'binding.model_identity', 'model identity does not match the execution identity'));
    if (options.expectedProviderIdentity !== undefined && evidence.providerIdentity !== options.expectedProviderIdentity) return err(domainError('DIGEST_MISMATCH', 'binding.provider_identity', 'provider identity does not match the execution identity'));
    if (options.expectedRuntimeImageIdentity !== undefined && evidence.runtimeImageIdentity !== options.expectedRuntimeImageIdentity) return err(domainError('DIGEST_MISMATCH', 'binding.runtime_image_identity', 'runtime image identity does not match the execution identity'));
    const taskResult = await verifyTaskBindings(evidence, normalized.value, options.workspaceRoot);
    if ('code' in taskResult) return err(taskResult);

    let configBytesSha256: string | null = null;
    if (evidence.codexConfig.path === null) {
      if (normalized.value.codexConfig !== undefined || evidence.codexConfig.bytesSha256 !== null) {
        return err(domainError('DIGEST_MISMATCH', 'binding.codex_config', 'job config declaration does not match the frozen no-config binding'));
      }
    } else {
      if (normalized.value.codexConfig !== evidence.codexConfig.path || evidence.codexConfig.bytesSha256 === null) {
        return err(domainError('DIGEST_MISMATCH', 'binding.codex_config', 'effective Codex config path or digest is not bound'));
      }
      configBytesSha256 = await hashPathBytes(resolveBoundPath(options.workspaceRoot, evidence.codexConfig.path));
      if (configBytesSha256 !== evidence.codexConfig.bytesSha256) return err(domainError('DIGEST_MISMATCH', 'binding.codex_config.bytes_sha256', 'actual Codex/MCP config bytes do not match the frozen SHA-256'));
    }
    const effectiveConfigSha256 = sha256Text(effectiveHarborConfigurationPayload(value, configBytesSha256));
    if (effectiveConfigSha256 !== evidence.codexConfig.effectiveSha256) return err(domainError('DIGEST_MISMATCH', 'binding.codex_config.effective_sha256', 'effective Codex/MCP configuration does not match the frozen digest'));
    return ok({
      taskManifestSha256: manifestSha256,
      taskBytesSha256: taskResult.taskBytesSha256,
      configBytesSha256,
      effectiveConfigSha256,
    });
  } catch (cause) {
    return err(errorFromUnknown(cause));
  }
};
