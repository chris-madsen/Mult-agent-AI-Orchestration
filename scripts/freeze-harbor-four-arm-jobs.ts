import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

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
  throw new Error('Usage: tsx scripts/freeze-harbor-four-arm-jobs.ts <task-manifest.json> <external-output-dir> <dense-config.toml> <hybrid-config.toml> <delta-config.toml>');
}

const aceRoot = resolve(process.cwd());
const outputDirectory = resolve(outputDirectoryArg as string);
const outputRelative = relative(aceRoot, outputDirectory);
if (outputRelative === '' || (!isAbsolute(outputRelative) && !outputRelative.startsWith(`..${sep}`) && outputRelative !== '..')) {
  throw new Error('Harbor job outputs must be outside the ACE checkout');
}
const manifestBytes = await readFile(resolve(manifestArg as string));
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
for (const task of manifest.tasks) {
  if (!existsSync(resolve(task.path)) || !/^[a-f0-9]{64}$/u.test(task.sha256)) {
    throw new Error(`task ${task.id} must bind an existing path and SHA-256`);
  }
  if (!task.path.includes(task.repositoryId)) throw new Error(`task ${task.id} path must identify repository ${task.repositoryId}`);
}

const taskManifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
const repositoryRevisions = Object.fromEntries(manifest.repositories.map((item) => [item.id, item.revision]));
const repeatedTasks = manifest.tasks.flatMap((task) => Array.from({ length: 5 }, () => ({ path: task.path })));
const base = {
  tasks: repeatedTasks,
  agents: [{
    name: 'codex',
    model_name: 'gpt-5.6-luna',
    env: { CODEX_FORCE_AUTH_JSON: '1' },
    kwargs: { reasoning_effort: 'high' },
  }],
  environment: { type: 'docker', delete: true },
  n_concurrent_trials: 1,
  n_attempts: 1,
  quiet: false,
  external_evidence: { task_manifest_sha256: taskManifestSha256, repository_revisions: repositoryRevisions },
};
const jobs = {
  native: { ...base, job_name: 'ace-hybrid-h6-native', jobs_dir: 'artifacts/ace-hybrid-h6-native' },
  dense: { ...base, job_name: 'ace-hybrid-h6-dense', jobs_dir: 'artifacts/ace-hybrid-h6-dense', agents: [{ ...base.agents[0], kwargs: { ...base.agents[0].kwargs, config: denseConfigArg } }] },
  hybrid: { ...base, job_name: 'ace-hybrid-h6-hybrid', jobs_dir: 'artifacts/ace-hybrid-h6-hybrid', agents: [{ ...base.agents[0], kwargs: { ...base.agents[0].kwargs, config: hybridConfigArg } }] },
  delta: { ...base, job_name: 'ace-hybrid-h6-hybrid-delta', jobs_dir: 'artifacts/ace-hybrid-h6-hybrid-delta', agents: [{ ...base.agents[0], kwargs: { ...base.agents[0].kwargs, config: deltaConfigArg } }] },
} as const;
await mkdir(outputDirectory, { recursive: true });
const jobDigests: Record<string, string> = {};
for (const [name, job] of Object.entries(jobs)) {
  const path = resolve(outputDirectory, `${name}-job.json`);
  const bytes = Buffer.from(JSON.stringify(job, null, 2) + '\n', 'utf8');
  await writeFile(path, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  jobDigests[name] = digest;
  await writeFile(`${path}.sha256`, `${digest}  ${basename(path)}\n`);
}
const binding = {
  schemaVersion: 1,
  status: 'frozen_harbor_job_bundle',
  taskManifestSha256,
  repositoryRevisions,
  jobDigests,
};
await writeFile(resolve(outputDirectory, 'binding.json'), JSON.stringify(binding, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ outputDirectory, taskManifestSha256, jobs: jobDigests }) + '\n');
