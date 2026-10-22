import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { validateFeedbackTaskManifest, type FeedbackTaskManifest } from '../src/domain/feedback-loop-experiment.js';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const gitBytes = (root: string, args: readonly string[]): Buffer =>
  execFileSync('git', ['-C', root, ...args]);
const gitText = (root: string, args: readonly string[]): string => gitBytes(root, args).toString('utf8').trim();

const assertCleanCheckout = (root: string, label: string): string => {
  const actualRoot = resolve(gitText(root, ['rev-parse', '--show-toplevel']));
  if (realpathSync(actualRoot) !== realpathSync(root)) throw new Error(`BLOCKED: ${label} must be a Git checkout root`);
  if (gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']).length > 0) {
    throw new Error(`BLOCKED: ${label} checkout is dirty; frozen source bytes would not match the job`);
  }
  return gitText(root, ['rev-parse', 'HEAD']);
};

// Use exactly the canonical task-identities freezer algorithm; hash actual Git blobs,
// not unverified strings copied from a task manifest.
const frozenTreeEntries = (root: string, revision: string, prefix?: string): readonly {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}[] => {
  const paths = gitText(root, ['ls-tree', '-r', '-z', '--name-only', revision,
    ...(prefix === undefined ? [] : [`${prefix}/`])])
    .split('\0').filter((path) => path.length > 0).sort((a, b) => a.localeCompare(b));
  return paths.map((path) => {
    const bytes = gitBytes(root, ['show', `${revision}:${path}`]);
    return { path, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
  });
};

const frozenTreeDigest = (identity: string, revision: string, entries: ReturnType<typeof frozenTreeEntries>): string =>
  sha256(Buffer.from(`${JSON.stringify({ schemaVersion: 1, identity, revision, entries }, null, 2)}\n`, 'utf8'));
const shellQuote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";

const usage = (): never => {
  throw new Error('Usage: tsx scripts/prepare-harbor-feedback-jobs.ts --task-manifest <path> --source-root <checkout> --ace-root <checkout> --output <dir> --run-id <id> --model <model> --reasoning <low|medium|high> --image-digest sha256:<64hex> --ace-config <path>');
};

const parseArgs = (): Record<string, string> => {
  const values = process.argv.slice(2);
  const result: Record<string, string> = {};
  while (values.length > 0) {
    const name = values.shift();
    const value = values.shift();
    if (name === undefined || value === undefined) return usage();
    result[name] = value;
  }
  const required = ['--task-manifest', '--source-root', '--ace-root', '--output', '--run-id', '--model', '--reasoning', '--image-digest', '--ace-config'];
  if (required.some((name) => result[name] === undefined)) return usage();
  return result;
};

const requiredArg = (args: Readonly<Record<string, string>>, name: string): string => {
  const value = args[name];
  if (value === undefined) throw new Error(`BLOCKED: missing ${name}`);
  return value;
};

const blocked = async (output: string, reason: string): Promise<void> => {
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'job-manifest.json'), `${JSON.stringify({ schemaVersion: 1, status: 'BLOCKED', reason }, null, 2)}\n`, 'utf8');
  process.stderr.write(`${reason}\n`);
  process.exitCode = 2;
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const taskManifestPath = requiredArg(args, '--task-manifest');
  const sourceRootArg = requiredArg(args, '--source-root');
  const aceRootArg = requiredArg(args, '--ace-root');
  const runId = requiredArg(args, '--run-id');
  const modelArg = requiredArg(args, '--model');
  const reasoningArg = requiredArg(args, '--reasoning');
  const imageDigestArg = requiredArg(args, '--image-digest');
  const aceConfigArg = requiredArg(args, '--ace-config');
  const output = resolve(requiredArg(args, '--output'));
  try {
    const taskManifestBytes = await readFile(resolve(taskManifestPath));
    const taskManifestValue = JSON.parse(taskManifestBytes.toString('utf8')) as unknown;
    const checked = validateFeedbackTaskManifest(taskManifestValue);
    if (checked._tag === 'Err') throw new Error(`BLOCKED: ${checked.error.path}: ${checked.error.message}`);
    const taskManifest: FeedbackTaskManifest = checked.value;
    if (taskManifest.selection !== 'main' || taskManifest.tasks.length !== 10) throw new Error('BLOCKED: Harbor main job preparation requires the frozen 10-task manifest');
    const sourceRoot = resolve(sourceRootArg);
    const sourceRevision = assertCleanCheckout(sourceRoot, 'task source');
    const allTasks = [...taskManifest.tasks, ...taskManifest.holdout];
    if (allTasks.some((task) => task.sourceRevision !== sourceRevision)) {
      throw new Error('BLOCKED: task/holdout revision does not match actual source checkout');
    }
    const sourceDigest = frozenTreeDigest(taskManifest.dataset.id, sourceRevision, frozenTreeEntries(sourceRoot, sourceRevision));
    if (allTasks.some((task) => task.sourceDigest !== sourceDigest)) {
      throw new Error('BLOCKED: task/holdout source digest does not match actual Git source blobs');
    }
    for (const task of allTasks) {
      if (task.taskPath === undefined) throw new Error(`BLOCKED: frozen task ${task.id} has no taskPath`);
      const expected = frozenTreeDigest(task.id, sourceRevision, frozenTreeEntries(sourceRoot, sourceRevision, task.taskPath));
      if (task.taskDigest !== expected) throw new Error(`BLOCKED: task ${task.id} digest does not match actual Git task blobs`);
    }
    const taskPaths = taskManifest.tasks.map((task) => {
      if (task.taskPath === undefined) throw new Error(`BLOCKED: frozen task ${task.id} has no taskPath`);
      const absolute = resolve(sourceRoot, task.taskPath);
      const containment = relative(sourceRoot, absolute);
      if (isAbsolute(containment) || containment === '..' || containment.startsWith('../') || !existsSync(absolute)
        || !realpathSync(absolute).startsWith(`${realpathSync(sourceRoot)}/`)) {
        throw new Error(`BLOCKED: frozen task path is missing or escapes source root: ${task.id}`);
      }
      return absolute;
    });
    const aceRoot = resolve(aceRootArg);
    const aceRuntime = join(aceRoot, 'dist', 'bin', 'ace-mcp.js');
    if (!existsSync(aceRuntime)) throw new Error(`BLOCKED: compiled ACE runtime is missing: ${aceRuntime}`);
    const reasoning = reasoningArg;
    if (!['low', 'medium', 'high'].includes(reasoning)) throw new Error('BLOCKED: reasoning effort must be low, medium or high');
    const imageDigest = imageDigestArg;
    if (!/^sha256:[a-f0-9]{64}$/u.test(imageDigest)) throw new Error('BLOCKED: explicit Docker image digest is required');
    const aceConfig = resolve(aceConfigArg);
    if (!existsSync(aceConfig)) throw new Error(`BLOCKED: ACE Codex config is missing: ${aceConfig}`);
    const aceConfigContainment = relative(aceRoot, aceConfig);
    if (isAbsolute(aceConfigContainment) || aceConfigContainment === '..' || aceConfigContainment.startsWith('../')) {
      throw new Error('BLOCKED: ACE Codex config must be inside the mounted ACE checkout');
    }
    const model = modelArg.trim();
    if (model.length === 0) throw new Error('BLOCKED: model must be explicit and non-empty');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(runId) || runId === '..') {
      throw new Error('BLOCKED: run ID must be a safe, portable identifier');
    }
    const aceSourceCommit = assertCleanCheckout(aceRoot, 'ACE runtime');
    if (!/^[a-f0-9]{40,64}$/iu.test(aceSourceCommit)) throw new Error('BLOCKED: ACE checkout did not provide a pinned source commit');
    const aceRuntimeSha256 = sha256(await readFile(aceRuntime));
    const agent = { name: 'codex', model_name: model, override_setup_timeout_sec: 900, env: { CODEX_FORCE_AUTH_JSON: '1' }, kwargs: { reasoning_effort: reasoning } } as const;
    const common = {
      tasks: taskPaths.map((path) => ({ path })),
      agents: [agent],
      // Docker is selected via the generated Harbor CLI invocation.
      // "type", "delete" and "mounts" are NOT EnvironmentConfig fields.
      environment: {},
      n_concurrent_trials: 1,
      n_attempts: 1,
      quiet: false,
    } as const;
    const nativeJob = {
      ...common,
      job_name: `${runId}-native`,
      jobs_dir: `artifacts/feedback/${runId}/raw-agent-native`,
    };
    const aceJob = {
      ...common,
      job_name: `${runId}-ace-optional`,
      agents: [{ ...agent, kwargs: { reasoning_effort: reasoning, config: aceConfig } }],
      environment: {},
      jobs_dir: `artifacts/feedback/${runId}/raw-agent-ace`,
    };
    await mkdir(output, { recursive: true });
    const nativeJobPath = resolve(output, 'native-job.json');
    const aceJobPath = resolve(output, 'ace-optional-job.json');
    await writeFile(nativeJobPath, `${JSON.stringify(nativeJob, null, 2)}\n`, 'utf8');
    await writeFile(aceJobPath, `${JSON.stringify(aceJob, null, 2)}\n`, 'utf8');
    // Harbor supplies mounts through the CLI --mounts option, not JobConfig.environment.
    // Embed fully shell-quoted arguments so the checkout path cannot inject commands.
    const mounts = JSON.stringify([{ type: 'bind', source: aceRoot, target: '/ace', read_only: true }]);
    const nativeCommand = `exec harbor run --config ${shellQuote(nativeJobPath)} --env docker`;
    const aceCommand = `exec harbor run --config ${shellQuote(aceJobPath)} --env docker --mounts ${shellQuote(mounts)}`;
    await writeFile(resolve(output, 'run-native.sh'), `#!/usr/bin/env bash\nset -euo pipefail\n${nativeCommand}\n`, 'utf8');
    await writeFile(resolve(output, 'run-ace-optional.sh'), `#!/usr/bin/env bash\nset -euo pipefail\n${aceCommand}\n`, 'utf8');
    await chmod(resolve(output, 'run-native.sh'), 0o755);
    await chmod(resolve(output, 'run-ace-optional.sh'), 0o755);
    await writeFile(resolve(output, 'job-manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      // The Docker image digest is declared, not enforced by the job config.
      // Real container image/agent identity must be checked after trial startup.
      status: 'PREPARED',
      runtimeImageVerification: 'NOT_VERIFIED',
      requiredHarborInvocation: 'run-native.sh and run-ace-optional.sh',
      runId,
      sourceRoot,
      aceRoot,
      aceSourceCommit,
      aceRuntime: '/ace/dist/bin/ace-mcp.js',
      aceRuntimeSha256,
      taskSourceRevision: sourceRevision,
      verifiedSourceDigest: sourceDigest,
      taskManifestSha256: sha256(taskManifestBytes),
      model,
      reasoningEffort: reasoning,
      imageDigest,
      aceConfig: aceConfig,
      aceConfigSha256: sha256(await readFile(aceConfig)),
      nConcurrentTrials: 1,
      nAttempts: 1,
      taskIds: taskManifest.tasks.map((task) => task.id),
      taskPaths,
    }, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ status: 'PREPARED', output, nativeJob: nativeJobPath, aceJob: aceJobPath, runtimeImageVerification: 'NOT_VERIFIED' })}\n`);
  } catch (error) {
    await blocked(output, error instanceof Error ? error.message : 'Harbor feedback job preparation failed');
  }
};

await main();
