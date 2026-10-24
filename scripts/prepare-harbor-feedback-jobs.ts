import { verifyAceRuntimeBundle } from '../src/application/ace-runtime-bundle.js';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  dockerImageDigestPattern,
  dockerImageMatchesDigest,
  feedbackAceContextBridgeCommand,
  feedbackHermesAgentImportPath,
  feedbackHermesContextPluginPath,
  feedbackHermesProviderPrefix,
  feedbackHermesVersion,
} from '../src/domain/feedback-harbor-config.js';
import { hermesCodexAuthenticationRoute } from '../src/domain/feedback-preflight.js';
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
const filesystemTreeEntries = async (root: string, prefix: string): Promise<readonly { readonly path: string; readonly sizeBytes: number; readonly sha256: string }[]> => {
  const absolute = join(root, prefix);
  const entries: { path: string; sizeBytes: number; sha256: string }[] = [];
  for (const name of (await readdir(absolute)).sort((left, right) => left.localeCompare(right))) {
    const path = join(absolute, name);
    const info = await stat(path);
    const relativePath = join(prefix, name).split('\\').join('/');
    if (info.isDirectory()) entries.push(...await filesystemTreeEntries(root, relativePath));
    else if (info.isFile()) entries.push({ path: relativePath, sizeBytes: info.size, sha256: sha256(await readFile(path)) });
  }
  return entries;
};
const shellQuote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";

const usage = (): never => {
  throw new Error('Usage: tsx scripts/prepare-harbor-feedback-jobs.ts --task-manifest <path> --source-root <checkout> --ace-runtime-bundle <bundle> --output <dir> [--artifacts-root <external-dir>] --run-id <id> --model <model> --reasoning <low|medium|high> [--image-digest sha256:<64hex> | --task-image-digest <image>=sha256:<64hex> ...]');
};

interface ParsedArgs {
  readonly values: Readonly<Record<string, string>>;
  readonly taskImageDigests: readonly string[];
}

const parseArgs = (): ParsedArgs => {
  const values = process.argv.slice(2);
  const result: Record<string, string> = {};
  const taskImageDigests: string[] = [];
  while (values.length > 0) {
    const name = values.shift();
    const value = values.shift();
    if (name === undefined || value === undefined) return usage();
    if (name === '--task-image-digest') taskImageDigests.push(value);
    else result[name] = value;
  }
  const required = ['--task-manifest', '--source-root', '--output', '--run-id', '--model', '--reasoning'];
  if (required.some((name) => result[name] === undefined)) return usage();
  return { values: result, taskImageDigests };
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

const dockerImageReference = async (taskPath: string): Promise<string> => {
  const taskToml = await readFile(join(taskPath, 'task.toml'), 'utf8');
  const match = /^\s*docker_image\s*=\s*"([^"]+)"\s*$/mu.exec(taskToml);
  if (match?.[1] === undefined || match[1].trim().length === 0) {
    throw new Error(`BLOCKED: frozen task is missing an explicit docker_image: ${taskPath}`);
  }
  return match[1].trim();
};

const verifyDockerImageReference = (reference: string, digest: string): void => {
  if (!dockerImageDigestPattern.test(digest)) throw new Error(`BLOCKED: invalid Docker digest for ${reference}`);
  const inspected = spawnSync('docker', ['image', 'inspect', '--format', '{{json .}}', reference], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (inspected.error !== undefined || inspected.status !== 0) {
    throw new Error(`BLOCKED: Docker image ${reference} is not available for inspection at ${digest}`);
  }
  let image: unknown;
  try {
    image = JSON.parse(inspected.stdout.trim()) as unknown;
  } catch {
    throw new Error(`BLOCKED: Docker image inspection returned malformed JSON for ${reference}`);
  }
  if (!dockerImageMatchesDigest(digest, image)) {
    throw new Error(`BLOCKED: Docker image ${reference} does not match pinned digest ${digest}`);
  }
};

const parseTaskImageDigest = (value: string): { readonly reference: string; readonly digest: string } => {
  const separator = value.lastIndexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('BLOCKED: --task-image-digest must be <docker-image-reference>=sha256:<64hex>');
  }
  return { reference: value.slice(0, separator), digest: value.slice(separator + 1) };
};

const main = async (): Promise<void> => {
  const parsedArgs = parseArgs();
  const args = parsedArgs.values;
  const taskManifestPath = requiredArg(args, '--task-manifest');
  const sourceRootArg = requiredArg(args, '--source-root');
  const aceRootArg = args['--ace-runtime-bundle'] ?? args['--ace-root'];
  if (aceRootArg === undefined) throw new Error('BLOCKED: --ace-runtime-bundle is required');
  const runId = requiredArg(args, '--run-id');
  const modelArg = requiredArg(args, '--model');
  const reasoningArg = requiredArg(args, '--reasoning');
  const imageDigestArg = args['--image-digest'];
  const output = resolve(requiredArg(args, '--output'));
  try {
    const taskManifestBytes = await readFile(resolve(taskManifestPath));
    const taskManifestValue = JSON.parse(taskManifestBytes.toString('utf8')) as unknown;
    const checked = validateFeedbackTaskManifest(taskManifestValue);
    if (checked._tag === 'Err') throw new Error(`BLOCKED: ${checked.error.path}: ${checked.error.message}`);
    const taskManifest: FeedbackTaskManifest = checked.value;
    const validSelection = taskManifest.selection === 'smoke'
      ? taskManifest.tasks.length === 1 && taskManifest.holdout.length === 0
      : taskManifest.tasks.length === 10
        && (taskManifest.selection === 'holdout' ? taskManifest.holdout.length === 0 : taskManifest.holdout.length === 10);
    if (!validSelection) throw new Error('BLOCKED: Harbor preparation requires one smoke task, a frozen 10-task main/holdout manifest, or a frozen 10-task holdout manifest');
    const sourceRoot = resolve(sourceRootArg);
    const artifactsRoot = resolve(args['--artifacts-root'] ?? process.env.ACE_FEEDBACK_ARTIFACTS_ROOT ?? '/tmp/ace-feedback-artifacts');
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
    const runtimeBundleMode = args['--ace-runtime-bundle'] !== undefined;
    let runtimeManifest: Record<string, unknown> | undefined;
    if (runtimeBundleMode) {
      const runtimeManifestPath = join(aceRoot, 'runtime-manifest.json');
      if (!existsSync(runtimeManifestPath)) throw new Error(`BLOCKED: ACE runtime bundle manifest is missing: ${runtimeManifestPath}`);
      runtimeManifest = JSON.parse(await readFile(runtimeManifestPath, 'utf8')) as Record<string, unknown>;
      const requestedBundleDigest = args['--ace-runtime-bundle-sha256'];
      const verified = await verifyAceRuntimeBundle(
        aceRoot,
        requestedBundleDigest === undefined ? undefined : requestedBundleDigest,
      );
      if (verified.status !== 'ready') {
        throw new Error(`BLOCKED: ${verified.reason}`);
      }
    }
    const aceRuntime = join(aceRoot, 'dist', 'bin', 'ace-context-bridge.js');
    if (!existsSync(aceRuntime)) throw new Error(`BLOCKED: compiled ACE context bridge is missing: ${aceRuntime}`);
    if (runtimeBundleMode && !existsSync(join(aceRoot, 'node_modules', 'effect', 'package.json'))) throw new Error('BLOCKED: ACE runtime bundle is missing production dependency effect');
    const reasoning = reasoningArg;
    if (!['low', 'medium', 'high'].includes(reasoning)) throw new Error('BLOCKED: reasoning effort must be low, medium or high');
    const taskImageReferences = [...new Set(await Promise.all(taskPaths.map((path) => dockerImageReference(path))))];
    const explicitTaskImageDigests = new Map<string, string>();
    for (const value of parsedArgs.taskImageDigests) {
      const item = parseTaskImageDigest(value);
      if (explicitTaskImageDigests.has(item.reference)) throw new Error(`BLOCKED: duplicate Docker digest mapping for ${item.reference}`);
      explicitTaskImageDigests.set(item.reference, item.digest);
    }
    if (taskImageReferences.length === 1 && imageDigestArg !== undefined) {
      explicitTaskImageDigests.set(taskImageReferences[0]!, imageDigestArg);
    } else if (imageDigestArg !== undefined) {
      throw new Error('BLOCKED: multiple task Docker images require one --task-image-digest <reference>=<digest> per image');
    }
    if (explicitTaskImageDigests.size !== taskImageReferences.length
      || taskImageReferences.some((reference) => !explicitTaskImageDigests.has(reference))) {
      throw new Error(`BLOCKED: explicit Docker digests are required for every task image: ${taskImageReferences.join(', ')}`);
    }
    for (const reference of taskImageReferences) verifyDockerImageReference(reference, explicitTaskImageDigests.get(reference)!);
    const taskImages = taskImageReferences.map((reference) => ({ reference, digest: explicitTaskImageDigests.get(reference)! }));
    const imageDigest = taskImages.length === 1 ? taskImages[0]!.digest : undefined;
    const agentAdapter = join(aceRoot, 'scripts', 'harbor_hermes_codex_oauth.py');
    const aceContextBridge = join(aceRoot, 'scripts', 'harbor-ace-context-bridge.sh');
    const contextPlugin = join(aceRoot, 'integrations', 'hermes', 'ace_context_engine');
    if (!existsSync(agentAdapter)) throw new Error(`BLOCKED: Hermes Harbor adapter is missing: ${agentAdapter}`);
    if (!existsSync(aceContextBridge)) throw new Error(`BLOCKED: ACE context bridge is missing: ${aceContextBridge}`);
    if (!existsSync(contextPlugin)) throw new Error(`BLOCKED: Hermes ContextEngine plugin is missing: ${contextPlugin}`);
    const requestedModel = modelArg.trim().replace(/^openai-codex\//u, '');
    if (requestedModel.length === 0 || requestedModel.includes('/')) {
      throw new Error('BLOCKED: model must be one explicit OpenAI model name without a provider prefix');
    }
    const model = `${feedbackHermesProviderPrefix}${requestedModel}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(runId) || runId === '..') {
      throw new Error('BLOCKED: run ID must be a safe, portable identifier');
    }
    const aceSourceCommit = runtimeManifest?.sourceCommit as string | undefined
      ?? assertCleanCheckout(aceRoot, 'ACE runtime');
    if (!/^[a-f0-9]{40,64}$/iu.test(aceSourceCommit)) throw new Error('BLOCKED: ACE checkout did not provide a pinned source commit');
    const aceRuntimeSha256 = sha256(await readFile(aceRuntime));
    const agentAdapterSha256 = sha256(await readFile(agentAdapter));
    // Bind evidence to the compiled bridge executable that Node actually runs.
    // The shell entrypoint itself is source-bound by the clean ACE checkout.
    const aceContextBridgeSha256 = aceRuntimeSha256;
    const contextPluginSha256 = frozenTreeDigest(
      'hermes-ace-context-plugin',
      aceSourceCommit,
      runtimeBundleMode
        ? await filesystemTreeEntries(aceRoot, 'integrations/hermes/ace_context_engine')
        : frozenTreeEntries(aceRoot, aceSourceCommit, 'integrations/hermes/ace_context_engine'),
    );
    const agent = {
      import_path: feedbackHermesAgentImportPath,
      model_name: model,
      override_setup_timeout_sec: 1200,
      kwargs: { version: feedbackHermesVersion, reasoning_effort: reasoning, ace_context_enabled: false },
    } as const;
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
      jobs_dir: join(artifactsRoot, runId, 'raw-agent-native'),
    };
    const aceJob = {
      ...common,
      job_name: `${runId}-ace-optional`,
      agents: [{
        ...agent,
        kwargs: {
          ...agent.kwargs,
          ace_context_enabled: true,
          ace_context_bridge_sha256: aceContextBridgeSha256,
          context_plugin_sha256: contextPluginSha256,
        },
      }],
      environment: {},
      jobs_dir: join(artifactsRoot, runId, 'raw-agent-ace'),
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
    const aceCommand = `export PYTHONPATH=/ace:` + '${PYTHONPATH:-}' + '\n' + `exec harbor run --config ${shellQuote(aceJobPath)} --env docker --mounts ${shellQuote(mounts)}`;
    await writeFile(resolve(output, 'run-native.sh'), `#!/usr/bin/env bash\nset -euo pipefail\n${nativeCommand}\n`, 'utf8');
    await writeFile(resolve(output, 'run-ace-optional.sh'), `#!/usr/bin/env bash\nset -euo pipefail\n${aceCommand}\n`, 'utf8');
    await chmod(resolve(output, 'run-native.sh'), 0o755);
    await chmod(resolve(output, 'run-ace-optional.sh'), 0o755);
    const experimentManifest = {
      schemaVersion: 1 as const,
      runId,
      sourceCommit: aceSourceCommit,
      taskSourceCommit: sourceRevision,
      taskManifestSha256: sha256(taskManifestBytes),
      agent: 'hermes' as const,
      agentVersion: feedbackHermesVersion,
      model,
      reasoningEffort: reasoning as 'low' | 'medium' | 'high',
      harborVersion: execFileSync('harbor', ['--version'], { encoding: 'utf8' }).trim().split(/\r?\n/u)[0]?.trim() ?? 'unknown',
      ...(imageDigest === undefined ? {} : { imageDigest }),
      taskImages,
      agentAdapterSha256,
      aceContextBridgeSha256,
      contextPluginSha256,
      ...(runtimeManifest?.bundleSha256 === undefined ? {} : { aceRuntimeBundleSha256: runtimeManifest.bundleSha256 as string }),
      seed: 'unknown' as const,
      mode: 'cold' as const,
      nConcurrentTrials: 1 as const,
      nAttempts: 1 as const,
      authenticationRoute: hermesCodexAuthenticationRoute,
    };
    await writeFile(resolve(output, 'experiment-manifest.json'), `${JSON.stringify(experimentManifest, null, 2)}\n`, 'utf8');
    await writeFile(resolve(output, 'job-manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      status: 'READY',
      requiredHarborInvocation: 'run-native.sh and run-ace-optional.sh',
      runId,
      sourceRoot,
      artifactsRoot,
      aceRoot,
      aceSourceCommit,
      aceRuntime: '/ace/dist/bin/ace-context-bridge.js',
      aceRuntimeSha256,
      ...(runtimeManifest?.bundleSha256 === undefined ? {} : { aceRuntimeBundleSha256: runtimeManifest.bundleSha256 as string }),
      agent: 'hermes',
      agentVersion: feedbackHermesVersion,
      agentAdapter: 'scripts/harbor_hermes_codex_oauth.py',
      agentAdapterSha256,
      aceContextBridge: feedbackAceContextBridgeCommand,
      aceContextBridgeSha256,
      contextPlugin: feedbackHermesContextPluginPath,
      contextPluginSha256,
      taskSourceRevision: sourceRevision,
      verifiedSourceDigest: sourceDigest,
      taskManifestSha256: sha256(taskManifestBytes),
      model,
      reasoningEffort: reasoning,
      harborVersion: experimentManifest.harborVersion,
      ...(imageDigest === undefined ? {} : { imageDigest }),
      taskImages,
      experimentManifest: resolve(output, 'experiment-manifest.json'),
      selection: taskManifest.selection,
      mode: 'cold',
      seed: 'unknown',
      authenticationRoute: experimentManifest.authenticationRoute,
      nConcurrentTrials: 1,
      nAttempts: 1,
      taskIds: taskManifest.tasks.map((task) => task.id),
      taskPaths,
    }, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ status: 'READY', output, nativeJob: nativeJobPath, aceJob: aceJobPath, experimentManifest: resolve(output, 'experiment-manifest.json') })}\n`);
  } catch (error) {
    await blocked(output, error instanceof Error ? error.message : 'Harbor feedback job preparation failed');
  }
};

await main();
