import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { validateFeedbackTaskManifest, type FeedbackTaskManifest } from '../src/domain/feedback-loop-experiment.js';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
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
    const taskPaths = taskManifest.tasks.map((task) => {
      if (task.taskPath === undefined) throw new Error(`BLOCKED: frozen task ${task.id} has no taskPath`);
      const absolute = resolve(sourceRoot, task.taskPath);
      const containment = relative(sourceRoot, absolute);
      if (isAbsolute(containment) || containment === '..' || containment.startsWith('../') || !existsSync(absolute)) {
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
    const aceSourceCommit = execFileSync('git', ['-C', aceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (!/^[a-f0-9]{40,64}$/iu.test(aceSourceCommit)) throw new Error('BLOCKED: ACE checkout did not provide a pinned source commit');
    const aceRuntimeSha256 = sha256(await readFile(aceRuntime));
    const agent = { name: 'codex', model_name: model, override_setup_timeout_sec: 900, env: { CODEX_FORCE_AUTH_JSON: '1' }, kwargs: { reasoning_effort: reasoning } } as const;
    const common = {
      tasks: taskPaths.map((path) => ({ path })),
      agents: [agent],
      environment: { type: 'docker', delete: true },
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
      environment: {
        type: 'docker',
        delete: true,
        mounts: [{ type: 'bind', source: aceRoot, target: '/ace', read_only: true }],
      },
      jobs_dir: `artifacts/feedback/${runId}/raw-agent-ace`,
    };
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'native-job.json'), `${JSON.stringify(nativeJob, null, 2)}\n`, 'utf8');
    await writeFile(resolve(output, 'ace-optional-job.json'), `${JSON.stringify(aceJob, null, 2)}\n`, 'utf8');
    await writeFile(resolve(output, 'job-manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      status: 'READY',
      runId,
      sourceRoot,
      aceRoot,
      aceSourceCommit,
      aceRuntime: '/ace/dist/bin/ace-mcp.js',
      aceRuntimeSha256,
      taskSourceRevision: taskManifest.tasks[0]!.sourceRevision,
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
    process.stdout.write(`${JSON.stringify({ status: 'READY', output, nativeJob: resolve(output, 'native-job.json'), aceJob: resolve(output, 'ace-optional-job.json') })}\n`);
  } catch (error) {
    await blocked(output, error instanceof Error ? error.message : 'Harbor feedback job preparation failed');
  }
};

await main();
