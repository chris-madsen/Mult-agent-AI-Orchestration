import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { readHarborFeedbackTrialObservations } from '../src/adapters/harbor-feedback-trial-evidence.js';
import {
  reconcileFeedbackTrials,
  validateFeedbackExperimentManifest,
  validateFeedbackTaskManifest,
  type FeedbackArtifactHash,
  type FeedbackTaskIdentity,
  type FeedbackTaskManifest,
  type FeedbackTrialObservation,
} from '../src/domain/feedback-loop-experiment.js';

type JsonObject = Readonly<Record<string, unknown>>;

const object = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const usage = (): never => {
  throw new Error(
    'Usage: tsx scripts/collect-feedback-loop.ts <task-manifest.json> <experiment-manifest.json> <native-result.json> <ace-result.json> <output-dir>',
  );
};

const readJson = async (path: string): Promise<JsonObject> => {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const value = object(parsed);
  if (value === undefined) throw new Error(`BLOCKED: ${path} must contain a JSON object`);
  return value;
};

const trialDirectories = async (aggregatePath: string): Promise<readonly string[]> => {
  await readJson(aggregatePath);
  const parent = dirname(resolve(aggregatePath));
  const entries = await readdir(parent, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => join(parent, entry.name));
  const trials = await Promise.all(directories.map(async (directory) => {
    const resultPath = join(directory, 'result.json');
    try {
      const result = await readJson(resultPath);
      const startedAt = typeof result.started_at === 'string' ? Date.parse(result.started_at) : Number.NaN;
      const trialId = nonEmpty(result.trial_id) ? result.trial_id : basename(directory);
      return { directory, trialId, startedAt };
    } catch {
      return undefined;
    }
  }));
  const present = trials.filter((item): item is { readonly directory: string; readonly trialId: string; readonly startedAt: number } => item !== undefined);
  if (present.length === 0) throw new Error(`BLOCKED: no Harbor trial directories beside ${aggregatePath}`);
  const seen = new Set<string>();
  for (const trial of present) {
    if (seen.has(trial.trialId)) throw new Error(`BLOCKED: duplicate Harbor trial ID ${trial.trialId}`);
    seen.add(trial.trialId);
  }
  if (present.every((item) => Number.isFinite(item.startedAt))) present.sort((left, right) => left.startedAt - right.startedAt);
  else present.sort((left, right) => left.directory.localeCompare(right.directory));
  return present.map((item) => item.directory);
};

const walkFiles = async (root: string): Promise<readonly string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`BLOCKED: non-regular Harbor artifact is not safely capturable: ${path}`);
  }
  return files;
};

const copyDirectory = async (source: string, destination: string): Promise<readonly FeedbackArtifactHash[]> => {
  const files = await walkFiles(source);
  const hashes: FeedbackArtifactHash[] = [];
  for (const file of files) {
    const target = join(destination, relative(source, file));
    await mkdir(dirname(target), { recursive: true });
    const bytes = await readFile(file);
    // Write the exact bytes used for the digest; copying after hashing could
    // silently associate a changed source file with the old hash.
    await writeFile(target, bytes);
    hashes.push({ path: relative(destination, target).split(/\\/u).join('/'), sha256: sha256(bytes) });
  }
  return hashes.sort((left, right) => left.path.localeCompare(right.path));
};

const providerTraceFiles = async (trialDirectory: string): Promise<readonly string[]> => {
  const files = await walkFiles(trialDirectory);
  return files.filter((path) => basename(path) === 'provider-trace.jsonl');
};

const providerTraceRequestIds = async (trialDirectory: string): Promise<readonly string[]> => {
  const ids = new Set<string>();
  for (const path of await providerTraceFiles(trialDirectory)) {
    for (const line of (await readFile(path, 'utf8')).split(/\r?\n/u)) {
      if (line.trim().length === 0) continue;
      try {
        const event = object(JSON.parse(line) as unknown);
        if (typeof event?.requestId === 'string' && event.requestId.trim().length > 0) ids.add(event.requestId);
      } catch {
        throw new Error(`BLOCKED: malformed provider trace line in ${path}`);
      }
    }
  }
  return [...ids].sort();
};

const taskFor = (tasks: readonly FeedbackTaskIdentity[], taskName: string): FeedbackTaskIdentity => {
  const task = tasks.find((candidate) => candidate.id === taskName);
  if (task === undefined) throw new Error(`BLOCKED: Harbor task ${taskName} is not present in frozen task-manifest.json`);
  return task;
};

const rawUsage = (result: JsonObject): {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
} => {
  const agent = object(result.agent_result);
  const inputTokens = typeof agent?.n_input_tokens === 'number' ? agent.n_input_tokens : undefined;
  const cachedInputTokens = typeof agent?.n_cache_tokens === 'number' ? agent.n_cache_tokens : undefined;
  const outputTokens = typeof agent?.n_output_tokens === 'number' ? agent.n_output_tokens : undefined;
  const costUsd = typeof agent?.cost_usd === 'number' ? agent.cost_usd : undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
};

const observationsFor = async (
  arm: 'native' | 'ace_optional',
  aggregatePath: string,
  taskManifest: FeedbackTaskManifest,
  outputRoot: string,
): Promise<{ readonly observations: readonly FeedbackTrialObservation[]; readonly providerTraceLines: readonly string[] }> => {
  const parsed = await readHarborFeedbackTrialObservations(arm, aggregatePath);
  const directories = await trialDirectories(aggregatePath);
  if (parsed.length !== directories.length) throw new Error(`BLOCKED: ${arm} raw trial count does not match Harbor directories`);
  const trialDirById = new Map<string, string>();
  for (const directory of directories) {
    const result = await readJson(join(directory, 'result.json'));
    const trialId = nonEmpty(result.trial_id) ? result.trial_id : basename(directory);
    if (trialDirById.has(trialId)) throw new Error(`BLOCKED: duplicate ${arm} trial ID ${trialId}`);
    trialDirById.set(trialId, directory);
  }
  const observations: FeedbackTrialObservation[] = [];
  const providerTraceLines: string[] = [];
  for (const trial of parsed) {
    const directory = trialDirById.get(trial.trialId);
    if (directory === undefined) throw new Error(`BLOCKED: missing ${arm} trial directory for ${trial.trialId}`);
    const task = taskFor(taskManifest.tasks, trial.taskName);
    // Task names are data from the Harbor dataset, not safe filesystem segments.
    const safeTaskDirectory = Buffer.from(task.id, 'utf8').toString('base64url');
    const destination = join(outputRoot, arm === 'native' ? 'raw-agent-native' : 'raw-agent-ace', safeTaskDirectory);
    const artifacts = await copyDirectory(directory, destination);
    const result = await readJson(join(directory, 'result.json'));
    const traceFiles = await providerTraceFiles(directory);
    for (const traceFile of traceFiles) providerTraceLines.push(await readFile(traceFile, 'utf8'));
    const observedRequestIds = [...new Set(trial.successfulRequestIds)];
    observations.push({
      arm,
      taskId: task.id,
      trialId: trial.trialId,
      sourceRevision: task.sourceRevision,
      sourceDigest: task.sourceDigest,
      taskDigest: task.taskDigest,
      quality: trial.success ? 'pass' : 'fail',
      usage: rawUsage(result),
      ...(trial.latencyMs === null ? {} : { durationMs: trial.latencyMs }),
      ...(trial.nativeFileReads === null ? {} : { nativeFileReads: trial.nativeFileReads }),
      observedAceCalls: arm === 'native' ? 0 : trial.observedAceCalls,
      observedAceRequestIds: arm === 'native' ? [] : observedRequestIds,
      providerTraceRequestIds: arm === 'native' ? [] : await providerTraceRequestIds(directory),
      rawArtifactHashes: artifacts,
    });
  }
  return { observations, providerTraceLines };
};

const parseArgs = (): {
  readonly taskManifestPath: string;
  readonly experimentManifestPath: string;
  readonly nativeResultPath: string;
  readonly aceResultPath: string;
  readonly outputDirectory: string;
} => {
  const [taskManifest, experimentManifest, nativeResult, aceResult, outputDirectory] = process.argv.slice(2);
  if ([taskManifest, experimentManifest, nativeResult, aceResult, outputDirectory].some((value) => value === undefined)) return usage();
  return {
    taskManifestPath: resolve(taskManifest as string),
    experimentManifestPath: resolve(experimentManifest as string),
    nativeResultPath: resolve(nativeResult as string),
    aceResultPath: resolve(aceResult as string),
    outputDirectory: resolve(outputDirectory as string),
  };
};

const writeBlocked = async (outputDirectory: string, reason: string): Promise<void> => {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'metrics.json'), `${JSON.stringify({ schemaVersion: 1, status: 'BLOCKED', reason }, null, 2)}\n`, 'utf8');
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  try {
    const taskManifestBytes = await readFile(args.taskManifestPath);
    const taskManifestValue = JSON.parse(taskManifestBytes.toString('utf8')) as unknown;
    const taskManifest = validateFeedbackTaskManifest(taskManifestValue);
    if (taskManifest._tag === 'Err') throw new Error(`BLOCKED: ${taskManifest.error.path}: ${taskManifest.error.message}`);
    const experimentManifestValue = await readJson(args.experimentManifestPath);
    const experimentManifest = validateFeedbackExperimentManifest(experimentManifestValue);
    if (experimentManifest._tag === 'Err') throw new Error(`BLOCKED: ${experimentManifest.error.path}: ${experimentManifest.error.message}`);
    const actualTaskManifestSha256 = sha256(taskManifestBytes);
    if (actualTaskManifestSha256 !== experimentManifest.value.taskManifestSha256) throw new Error('BLOCKED: task manifest SHA-256 does not match experiment manifest');
    await mkdir(args.outputDirectory, { recursive: true });
    await writeFile(resolve(args.outputDirectory, 'task-manifest.json'), taskManifestBytes);
    const native = await observationsFor('native', args.nativeResultPath, taskManifest.value, args.outputDirectory);
    const ace = await observationsFor('ace_optional', args.aceResultPath, taskManifest.value, args.outputDirectory);
    const report = reconcileFeedbackTrials({ taskManifest: taskManifest.value, native: native.observations, ace: ace.observations });
    if (report._tag === 'Err') throw new Error(`BLOCKED: ${report.error.path}: ${report.error.message}`);
    const traceLines = [...native.providerTraceLines, ...ace.providerTraceLines];
    await writeFile(resolve(args.outputDirectory, 'provider-trace.jsonl'), traceLines.join('').endsWith('\n') ? traceLines.join('') : `${traceLines.join('')}\n`);
    await mkdir(resolve(args.outputDirectory, 'receipts'), { recursive: true });
    const metricsBytes = Buffer.from(`${JSON.stringify(report.value, null, 2)}\n`, 'utf8');
    await writeFile(resolve(args.outputDirectory, 'metrics.json'), metricsBytes);
    const manifest = {
      schemaVersion: 1,
      status: report.value.status,
      experiment: experimentManifest.value,
      taskManifestSha256: actualTaskManifestSha256,
      metricsSha256: sha256(metricsBytes),
      rawArtifactHashes: [
        ...native.observations.flatMap((observation) => observation.rawArtifactHashes.map((artifact) => ({
          arm: 'native',
          path: `raw-agent-native/${Buffer.from(observation.taskId, 'utf8').toString('base64url')}/${artifact.path}`,
          sha256: artifact.sha256,
        }))),
        ...ace.observations.flatMap((observation) => observation.rawArtifactHashes.map((artifact) => ({
          arm: 'ace_optional',
          path: `raw-agent-ace/${Buffer.from(observation.taskId, 'utf8').toString('base64url')}/${artifact.path}`,
          sha256: artifact.sha256,
        }))),
      ],
      rawArtifactRoot: args.outputDirectory,
      limitations: report.value.status === 'PASS' ? [] : ['Unknown values are retained and excluded from token ratio claims.'],
    };
    await writeFile(resolve(args.outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ status: report.value.status, output: args.outputDirectory, metrics: resolve(args.outputDirectory, 'metrics.json') })}\n`);
    if (report.value.status === 'BLOCKED' || report.value.status === 'QUALITY_REGRESSION') process.exitCode = 2;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'feedback collector failed';
    await writeBlocked(args.outputDirectory, reason);
    process.stderr.write(`${reason}\n`);
    process.exitCode = 2;
  }
};

await main();
