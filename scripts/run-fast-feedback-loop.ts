import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

interface ParsedArgs {
  readonly sourceRoot: string;
  readonly taskPath: string;
  readonly aceRuntimeBundle: string;
  readonly taskImage: string;
  readonly taskImageDigest: string;
  readonly model: string;
  readonly reasoning: string;
  readonly output: string;
  readonly maxRuntimeSec: number;
}

interface CommandResult {
  readonly status: 'PASS' | 'FAILED' | 'TIMEOUT';
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly elapsedMs: number;
}

const usage = (): never => {
  throw new Error('Usage: npm run bench:feedback-fast -- --source-root <checkout> --task-path <relative-task-dir> --ace-runtime-bundle <bundle> --task-image <reference> --task-image-digest <reference>=sha256:<64hex> --model <model> --reasoning <low|medium|high> --output <external-dir> [--max-runtime-sec 150]');
};

const parseArgs = (): ParsedArgs => {
  const values = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  while (values.length > 0) {
    const name = values.shift();
    const value = values.shift();
    if (name === undefined || value === undefined) return usage();
    parsed[name] = value;
  }
  const required = ['--source-root', '--task-path', '--ace-runtime-bundle', '--task-image', '--task-image-digest', '--model', '--reasoning', '--output'];
  if (required.some((name) => parsed[name] === undefined)) return usage();
  const maxRuntimeSec = Number(parsed['--max-runtime-sec'] ?? '150');
  if (!Number.isSafeInteger(maxRuntimeSec) || maxRuntimeSec < 1 || maxRuntimeSec > 180) {
    throw new Error('BLOCKED: --max-runtime-sec must be an integer between 1 and 180');
  }
  return {
    sourceRoot: resolve(parsed['--source-root']!),
    taskPath: parsed['--task-path']!,
    aceRuntimeBundle: resolve(parsed['--ace-runtime-bundle']!),
    taskImage: parsed['--task-image']!,
    taskImageDigest: parsed['--task-image-digest']!,
    model: parsed['--model']!,
    reasoning: parsed['--reasoning']!,
    output: resolve(parsed['--output']!),
    maxRuntimeSec,
  };
};

const commandPath = resolve('node_modules/.bin/tsx');
const runIdFor = (output: string): string => {
  const value = basename(output);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(value) || value === '..') {
    throw new Error('BLOCKED: output basename must be a safe run ID');
  }
  return value;
};

const assertOutsideSource = (sourceRoot: string, output: string): void => {
  const relation = relative(resolve(sourceRoot), resolve(output));
  if (!isAbsolute(relation) && relation !== '..' && !relation.startsWith('../')) {
    throw new Error('BLOCKED: fast benchmark output must remain outside the source checkout');
  }
};

const runCommand = async (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly stdoutPath: string;
    readonly stderrPath: string;
    readonly timeoutMs: number;
  },
): Promise<CommandResult> => {
  await mkdir(resolve(options.stdoutPath, '..'), { recursive: true });
  const started = Date.now();
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
  const result = await new Promise<CommandResult>((resolveResult) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      }
    }, options.timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      stderr.push(Buffer.from(String(error)));
      resolveResult({ status: 'FAILED', exitCode: null, signal: null, elapsedMs: Date.now() - started });
    });
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      resolveResult({
        status: timedOut ? 'TIMEOUT' : exitCode === 0 ? 'PASS' : 'FAILED',
        exitCode,
        signal,
        elapsedMs: Date.now() - started,
      });
    });
  });
  await writeFile(options.stdoutPath, Buffer.concat(stdout));
  await writeFile(options.stderrPath, Buffer.concat(stderr));
  return result;
};

const readStatus = async (path: string): Promise<string | undefined> => {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { readonly status?: unknown };
    return typeof value.status === 'string' ? value.status : undefined;
  } catch {
    return undefined;
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const runId = runIdFor(args.output);
  assertOutsideSource(args.sourceRoot, args.output);
  if (!existsSync(args.aceRuntimeBundle)) throw new Error(`BLOCKED: ACE runtime bundle is missing: ${args.aceRuntimeBundle}`);
  if (!/^.+=[^=]+$/u.test(args.taskImageDigest)) throw new Error('BLOCKED: --task-image-digest must bind the task image reference to a digest');
  if (!args.taskImageDigest.startsWith(`${args.taskImage}=`)) throw new Error('BLOCKED: task image digest reference does not match --task-image');
  if (!['low', 'medium', 'high'].includes(args.reasoning)) throw new Error('BLOCKED: reasoning effort must be low, medium or high');

  const frozen = join(args.output, 'frozen');
  const jobs = join(args.output, 'jobs');
  const artifacts = join(args.output, 'artifacts');
  const preflight = join(args.output, 'preflight');
  const reconciled = join(args.output, 'reconciled');
  const manifestPath = join(frozen, 'task-manifest.json');
  const experimentPath = join(jobs, 'experiment-manifest.json');
  const commonEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
  const runStep = async (label: string, command: string, commandArgs: readonly string[], timeoutMs: number): Promise<CommandResult> =>
    runCommand(command, commandArgs, {
      cwd: resolve('.'),
      env: commonEnv,
      stdoutPath: join(args.output, 'logs', `${label}.stdout.log`),
      stderrPath: join(args.output, 'logs', `${label}.stderr.log`),
      timeoutMs,
    });

  await mkdir(args.output, { recursive: true });
  const freeze = await runStep('freeze-local', commandPath, [
    'scripts/freeze-local-feedback-task.ts',
    '--source-root', args.sourceRoot,
    '--task-path', args.taskPath,
    '--output', frozen,
  ], 30_000);
  if (freeze.status !== 'PASS') throw new Error(`BLOCKED: local task freeze ${freeze.status}`);

  const prepare = await runStep('prepare', commandPath, [
    'scripts/prepare-harbor-feedback-jobs.ts',
    '--task-manifest', manifestPath,
    '--source-root', args.sourceRoot,
    '--ace-runtime-bundle', args.aceRuntimeBundle,
    '--output', jobs,
    '--artifacts-root', artifacts,
    '--run-id', runId,
    '--model', args.model,
    '--reasoning', args.reasoning,
    '--task-image', args.taskImage,
    '--task-image-digest', args.taskImageDigest,
  ], 45_000);
  if (prepare.status !== 'PASS') throw new Error(`BLOCKED: Harbor job preparation ${prepare.status}`);

  const preflightResult = await runStep('preflight', commandPath, [
    'scripts/feedback-loop-preflight.ts',
    '--output', preflight,
    '--task-manifest', manifestPath,
    '--native-job', join(jobs, 'native-job.json'),
    '--ace-job', join(jobs, 'ace-optional-job.json'),
    '--ace-runtime-bundle', args.aceRuntimeBundle,
    '--experiment-manifest', experimentPath,
  ], 45_000);
  if (preflightResult.status !== 'PASS' || await readStatus(join(preflight, 'manifest.json')) !== 'READY') {
    throw new Error(`BLOCKED: preflight ${preflightResult.status}`);
  }

  const deadline = Date.now() + args.maxRuntimeSec * 1000;
  const runArm = async (name: 'native' | 'ace-optional', script: string): Promise<CommandResult> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { status: 'TIMEOUT', exitCode: null, signal: 'SIGTERM', elapsedMs: 0 };
    return runCommand('bash', [script], {
      cwd: resolve('.'),
      env: commonEnv,
      stdoutPath: join(args.output, 'logs', `${name}.stdout.log`),
      stderrPath: join(args.output, 'logs', `${name}.stderr.log`),
      timeoutMs: remaining,
    });
  };
  const native = await runArm('native', join(jobs, 'run-native.sh'));
  const ace = await runArm('ace-optional', join(jobs, 'run-ace-optional.sh'));
  const summaryPath = join(args.output, 'run-summary.json');
  const baseSummary = {
    schemaVersion: 1,
    runId,
    maxRuntimeSec: args.maxRuntimeSec,
    native,
    ace,
    deadlineExceeded: Date.now() > deadline,
    taskManifest: manifestPath,
    experimentManifest: experimentPath,
    preflight: join(preflight, 'manifest.json'),
  };
  if (native.status !== 'PASS' || ace.status !== 'PASS') {
    await writeFile(summaryPath, `${JSON.stringify({ ...baseSummary, status: native.status === 'TIMEOUT' || ace.status === 'TIMEOUT' ? 'TIMEOUT' : 'BLOCKED' }, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: native.status === 'TIMEOUT' || ace.status === 'TIMEOUT' ? 'TIMEOUT' : 'BLOCKED', output: args.output })}\n`);
    process.exitCode = 2;
    return;
  }

  const collect = await runStep('collect', commandPath, [
    'scripts/collect-feedback-loop.ts',
    manifestPath,
    experimentPath,
    join(artifacts, runId, 'raw-agent-native', 'result.json'),
    join(artifacts, runId, 'raw-agent-ace', 'result.json'),
    reconciled,
  ], 30_000);
  if (collect.status !== 'PASS') {
    await writeFile(summaryPath, `${JSON.stringify({ ...baseSummary, status: 'BLOCKED', collect }, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', output: args.output })}\n`);
    process.exitCode = 2;
    return;
  }
  const reportPath = join('benchmarks', 'reports', `fast-feedback-${runId}.md`);
  const report = await runStep('report', commandPath, ['scripts/render-feedback-summary.ts', reconciled, reportPath], 15_000);
  const metricsStatus = await readStatus(join(reconciled, 'metrics.json'));
  await writeFile(summaryPath, `${JSON.stringify({ ...baseSummary, status: metricsStatus ?? 'UNKNOWN', collect, report, reportPath }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: metricsStatus ?? 'UNKNOWN', output: args.output, report: reportPath })}\n`);
  if (metricsStatus === 'BLOCKED' || metricsStatus === 'QUALITY_REGRESSION') process.exitCode = 2;
};

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'fast feedback loop failed'}\n`);
  process.exitCode = 2;
}
