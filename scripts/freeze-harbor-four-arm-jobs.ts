import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  effectiveHarborConfigurationPayload,
  harborTaskBindingDigestInput,
  type HarborTaskByteBinding,
} from '../src/domain/harbor-byte-binding.js';
import { hashHarborPathBytes, hashHarborText } from '../src/application/harbor-byte-binding.js';

interface TaskManifestRepository {
  readonly id: string;
  readonly revision: string;
}

interface TaskManifestEntry {
  readonly id: string;
  readonly repositoryId: string;
  readonly path: string;
  readonly sha256: string;
}

interface TaskManifest {
  readonly schemaVersion: 1;
  readonly status: 'frozen_harbor_task_manifest';
  readonly repositories: readonly TaskManifestRepository[];
  readonly tasks: readonly TaskManifestEntry[];
}

const [manifestArg, outputDirectoryArg, denseConfigArg, hybridConfigArg, deltaConfigArg] = process.argv.slice(2);
if ([manifestArg, outputDirectoryArg, denseConfigArg, hybridConfigArg, deltaConfigArg].some((value) => value === undefined)) {
  throw new Error('Usage: ACE_HARBOR_MODEL_IDENTITY=... ACE_HARBOR_PROVIDER_IDENTITY=... ACE_HARBOR_RUNTIME_IMAGE_IDENTITY=... tsx scripts/freeze-harbor-four-arm-jobs.ts <task-manifest.json> <external-output-dir> <dense-config.toml> <hybrid-config.toml> <delta-config.toml>');
}

const requiredIdentity = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} must pin the effective Harbor identity`);
  return value;
};

const aceRoot = resolve(process.cwd());
const outputDirectory = resolve(outputDirectoryArg as string);
const outputRelative = relative(aceRoot, outputDirectory);
if (outputRelative === '' || (!isAbsolute(outputRelative) && !outputRelative.startsWith(`..${sep}`) && outputRelative !== '..')) {
  throw new Error('Harbor job outputs must be outside the ACE checkout');
}
const manifestPath = resolve(manifestArg as string);
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8')) as TaskManifest;
if (manifest.schemaVersion !== 1 || manifest.status !== 'frozen_harbor_task_manifest') {
  throw new Error('task manifest must declare frozen_harbor_task_manifest schema version 1');
}
if (manifest.repositories.length < 2 || new Set(manifest.repositories.map((item) => item.id)).size !== manifest.repositories.length) {
  throw new Error('task manifest requires unique repository identities');
}
if (manifest.tasks.length !== 6 || new Set(manifest.tasks.map((item) => item.id)).size !== manifest.tasks.length) {
  throw new Error('external four-arm workload requires six distinct tasks');
}
for (const repository of manifest.repositories) {
  if (!/^[a-f0-9]{40,64}$/iu.test(repository.revision)) throw new Error(`invalid repository revision for ${repository.id}`);
  const count = manifest.tasks.filter((task) => task.repositoryId === repository.id).length;
  if (count < 3) throw new Error(`repository ${repository.id} requires at least three tasks`);
}

const taskBindings: HarborTaskByteBinding[] = [];
for (const task of manifest.tasks) {
  if (!/^[a-f0-9]{64}$/u.test(task.sha256) || task.id.trim().length === 0 || task.path.trim().length === 0) {
    throw new Error(`task ${task.id} must bind a non-empty path and SHA-256`);
  }
  if (!task.path.includes(task.repositoryId)) throw new Error(`task ${task.id} path must identify repository ${task.repositoryId}`);
  const actualSha256 = await hashHarborPathBytes(isAbsolute(task.path) ? resolve(task.path) : resolve(aceRoot, task.path));
  if (actualSha256 !== task.sha256) throw new Error(`BLOCKED: task ${task.id} bytes do not match the declared manifest SHA-256`);
  taskBindings.push({ id: task.id, repositoryId: task.repositoryId, path: task.path, sha256: actualSha256 });
}
const taskManifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
const taskBytesSha256 = hashHarborText(harborTaskBindingDigestInput(taskBindings));
const serializedTaskBindings = taskBindings.map((binding) => ({
  id: binding.id,
  repository_id: binding.repositoryId,
  path: binding.path,
  sha256: binding.sha256,
}));
const repositoryRevisions = Object.fromEntries(manifest.repositories.map((item) => [item.id, item.revision]));
const modelIdentity = requiredIdentity('ACE_HARBOR_MODEL_IDENTITY');
const providerIdentity = requiredIdentity('ACE_HARBOR_PROVIDER_IDENTITY');
const runtimeImageIdentity = requiredIdentity('ACE_HARBOR_RUNTIME_IMAGE_IDENTITY');
const repeatedTasks = manifest.tasks.flatMap((task) => Array.from({ length: 5 }, () => ({ path: task.path })));

const makeJob = async (name: string, configPath: string | null, jobName: string, strategyConfig: string | undefined) => {
  const configBytesSha256 = configPath === null
    ? null
    : await hashHarborPathBytes(isAbsolute(configPath) ? resolve(configPath) : resolve(aceRoot, configPath));
  const withoutEvidence = {
    tasks: repeatedTasks,
    agents: [{
      name: 'codex' as const,
      model_name: 'gpt-5.6-luna',
      env: { CODEX_FORCE_AUTH_JSON: '1' },
      kwargs: {
        reasoning_effort: 'high',
        ...(strategyConfig === undefined ? {} : { config: strategyConfig }),
      },
    }],
    environment: { type: 'docker' as const, delete: true as const },
    n_concurrent_trials: 1 as const,
    n_attempts: 1 as const,
    quiet: false,
    job_name: jobName,
    jobs_dir: `artifacts/${jobName}`,
  };
  const externalEvidence = {
    schema_version: 1 as const,
    task_manifest_path: manifestPath,
    task_manifest_sha256: taskManifestSha256,
    task_bytes_sha256: taskBytesSha256,
    task_bindings: serializedTaskBindings,
    repository_revisions: repositoryRevisions,
    model_identity: modelIdentity,
    provider_identity: providerIdentity,
    runtime_image_identity: runtimeImageIdentity,
    codex_config: {
      path: configPath,
      bytes_sha256: configBytesSha256,
      effective_sha256: hashHarborText(effectiveHarborConfigurationPayload(withoutEvidence, configBytesSha256)),
    },
  };
  return { name, job: { ...withoutEvidence, external_evidence: externalEvidence } };
};

const jobs = [
  await makeJob('native', null, 'ace-hybrid-h6-native', undefined),
  await makeJob('dense', denseConfigArg as string, 'ace-hybrid-h6-dense', denseConfigArg as string),
  await makeJob('hybrid', hybridConfigArg as string, 'ace-hybrid-h6-hybrid', hybridConfigArg as string),
  await makeJob('delta', deltaConfigArg as string, 'ace-hybrid-h6-hybrid-delta', deltaConfigArg as string),
] as const;
await mkdir(outputDirectory, { recursive: true });
const jobDigests: Record<string, string> = {};
const configBindings: Record<string, unknown> = {};
for (const { name, job } of jobs) {
  const path = resolve(outputDirectory, `${name}-job.json`);
  const bytes = Buffer.from(JSON.stringify(job, null, 2) + '\n', 'utf8');
  await writeFile(path, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  jobDigests[name] = digest;
  configBindings[name] = job.external_evidence.codex_config;
  await writeFile(`${path}.sha256`, `${digest}  ${basename(path)}\n`);
}
const binding = {
  schemaVersion: 2,
  status: 'frozen_harbor_job_bundle',
  taskManifestPath: manifestPath,
  taskManifestSha256,
  taskBytesSha256,
  taskBindings: serializedTaskBindings,
  repositoryRevisions,
  modelIdentity,
  providerIdentity,
  runtimeImageIdentity,
  configBindings,
  jobDigests,
};
await writeFile(resolve(outputDirectory, 'binding.json'), JSON.stringify(binding, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ outputDirectory, taskManifestSha256, taskBytesSha256, jobs: jobDigests }) + '\n');
