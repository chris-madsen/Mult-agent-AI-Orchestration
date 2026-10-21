import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { CommandPort } from './harbor-runner.js';

export interface HarborTaskDefinition {
  readonly taskPath: string;
  readonly taskName: string;
  readonly version: string;
  readonly language: 'typescript' | 'devops';
  readonly repoBaseCommit: string;
}

export interface HarborJobOptions {
  readonly jobName: string;
  readonly modelName: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
  readonly jobsDir: string;
  readonly codexConfigPath?: string;
}

export interface HarborTaskJobConfig {
  readonly job_name: string;
  readonly tasks: readonly [{ readonly path: string }];
  readonly agents: readonly [{ readonly name: 'codex'; readonly model_name: string; readonly kwargs: { readonly reasoning_effort: string; readonly config?: string } }];
  readonly environment: { readonly type: 'docker'; readonly delete: true };
  readonly n_concurrent_trials: 1;
  readonly n_attempts: 1;
  readonly jobs_dir: string;
}

export interface HarborArtifactManifestEntry {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface HarborArtifactManifest {
  readonly taskName: string;
  readonly retained: readonly HarborArtifactManifestEntry[];
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;

const normalizedRelative = (value: string): string => relative('.', value).split(sep).join('/');
const escapesRoot = (value: string): boolean => {
  const normalized = value.split(sep).join('/');
  return normalized === '..' || normalized.startsWith('../');
};
const safeRelative = (value: string): boolean => !isAbsolute(value) && !escapesRoot(normalizedRelative(value));

const validateTask = (task: HarborTaskDefinition): Result<HarborTaskDefinition, ReturnType<typeof domainError>> => {
  if (!nonEmpty(task.taskPath) || !safeRelative(task.taskPath)) return err(domainError('INVALID_BENCHMARK', 'task_path', 'Harbor task path must be relative and contained'));
  if (!nonEmpty(task.taskName) || !nonEmpty(task.version) || !nonEmpty(task.repoBaseCommit)) return err(domainError('INVALID_BENCHMARK', 'task', 'task name, version and base commit are required'));
  return ok({ ...task, taskPath: task.taskPath.trim(), taskName: task.taskName.trim(), version: task.version.trim(), repoBaseCommit: task.repoBaseCommit.trim() });
};

export const makeHarborJobConfig = (
  task: HarborTaskDefinition,
  options: HarborJobOptions,
): Result<HarborTaskJobConfig, ReturnType<typeof domainError>> => {
  const checked = validateTask(task);
  if (checked._tag === 'Err') return checked;
  if (!nonEmpty(options.jobName) || !nonEmpty(options.modelName) || !nonEmpty(options.jobsDir) || !safeRelative(options.jobsDir)) {
    return err(domainError('INVALID_BENCHMARK', 'job', 'job name, model and relative jobs directory are required'));
  }
  if (options.codexConfigPath !== undefined && (!nonEmpty(options.codexConfigPath) || !safeRelative(options.codexConfigPath))) {
    return err(domainError('INVALID_BENCHMARK', 'codex_config_path', 'Codex config path must be relative and contained'));
  }
  const kwargs = {
    reasoning_effort: options.reasoningEffort,
    ...(options.codexConfigPath === undefined ? {} : { config: options.codexConfigPath.trim() }),
  };
  return ok({
    job_name: options.jobName.trim(),
    tasks: [{ path: checked.value.taskPath }],
    agents: [{ name: 'codex', model_name: options.modelName.trim(), kwargs }],
    environment: { type: 'docker', delete: true },
    n_concurrent_trials: 1,
    n_attempts: 1,
    jobs_dir: options.jobsDir.trim(),
  });
};

export const resetHarborWorktree = async (
  command: CommandPort,
  worktreePath: string,
  allowedWorktreeParent: string,
  repoBaseCommit: string,
): Promise<Result<void, ReturnType<typeof domainError>>> => {
  const worktree = resolve(worktreePath);
  const parent = resolve(allowedWorktreeParent);
  const containment = relative(parent, worktree);
  if (containment === '' || escapesRoot(containment) || isAbsolute(containment)) {
    return err(domainError('PATH_ESCAPE', 'worktree_path', 'Harbor reset requires a dedicated child worktree'));
  }
  if (!nonEmpty(repoBaseCommit)) return err(domainError('INVALID_BENCHMARK', 'repo_base_commit', 'base commit is required'));
  const reset = await command.run('git', ['-C', worktree, 'reset', '--hard', repoBaseCommit], 120_000);
  if (reset._tag === 'Err') return reset;
  if (reset.value.exitCode !== 0) return err(domainError('EXTERNAL_UNAVAILABLE', 'git_reset', 'isolated worktree reset failed'));
  const clean = await command.run('git', ['-C', worktree, 'clean', '-ffdx'], 120_000);
  if (clean._tag === 'Err') return clean;
  return clean.value.exitCode === 0
    ? ok(undefined)
    : err(domainError('EXTERNAL_UNAVAILABLE', 'git_clean', 'isolated worktree cleanup failed'));
};

export const retainHarborArtifacts = async (
  taskName: string,
  trialRoot: string,
  relativePaths: readonly string[],
  manifestPath: string,
): Promise<Result<HarborArtifactManifest, ReturnType<typeof domainError>>> => {
  if (!nonEmpty(taskName) || relativePaths.length === 0) return err(domainError('INVALID_BENCHMARK', 'artifacts', 'task name and artifacts are required'));
  const retained: HarborArtifactManifestEntry[] = [];
  try {
    for (const path of relativePaths) {
      if (!safeRelative(path)) return err(domainError('PATH_ESCAPE', 'artifact_path', 'artifact path must remain within trial root'));
      const absolute = resolve(trialRoot, path);
      const containment = relative(resolve(trialRoot), absolute);
      if (escapesRoot(containment) || isAbsolute(containment)) return err(domainError('PATH_ESCAPE', 'artifact_path', 'artifact path escapes trial root'));
      const bytes = await readFile(absolute);
      const metadata = await stat(absolute);
      retained.push({ path, sizeBytes: metadata.size, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const manifest = { taskName, retained } satisfies HarborArtifactManifest;
    await mkdir(resolve(manifestPath, '..'), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return ok(manifest);
  } catch {
    return err(domainError('PERSISTENCE_FAILED', 'artifacts', 'Harbor artifact manifest could not be written'));
  }
};
