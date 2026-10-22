import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateFeedbackTaskManifest, type FeedbackTaskIdentity } from '../src/domain/feedback-loop-experiment.js';

const revisionPattern = /^[a-f0-9]{40,64}$/iu;
const digestPattern = /^[a-f0-9]{64}$/u;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const usage = (): never => {
  throw new Error(
    'Usage: tsx scripts/freeze-feedback-task-manifest.ts --tasks <tasks.json|tasks.jsonl> --dataset-revision <40+hex> --dataset-sha256 <sha256> --output <external-dir> --main-id <id> x10 --holdout-id <id> x10',
  );
};

const parseArgs = (): {
  readonly tasksPath: string;
  readonly datasetRevision: string;
  readonly datasetSha256: string;
  readonly outputDirectory: string;
  readonly mainIds: readonly string[];
  readonly holdoutIds: readonly string[];
} => {
  const args = process.argv.slice(2);
  let tasksPath: string | undefined;
  let datasetRevision: string | undefined;
  let datasetSha256: string | undefined;
  let outputDirectory: string | undefined;
  const mainIds: string[] = [];
  const holdoutIds: string[] = [];
  while (args.length > 0) {
    const name = args.shift();
    const value = args.shift();
    if (name === '--tasks') tasksPath = value;
    else if (name === '--dataset-revision') datasetRevision = value;
    else if (name === '--dataset-sha256') datasetSha256 = value;
    else if (name === '--output') outputDirectory = value;
    else if (name === '--main-id' && value !== undefined) mainIds.push(value);
    else if (name === '--holdout-id' && value !== undefined) holdoutIds.push(value);
    else return usage();
  }
  if (tasksPath === undefined || datasetRevision === undefined || datasetSha256 === undefined || outputDirectory === undefined
    || mainIds.length !== 10 || holdoutIds.length !== 10) return usage();
  if (!revisionPattern.test(datasetRevision) || !digestPattern.test(datasetSha256)
    || new Set([...mainIds, ...holdoutIds]).size !== 20 || [...mainIds, ...holdoutIds].some((id) => !nonEmpty(id))) return usage();
  return {
    tasksPath: resolve(tasksPath),
    datasetRevision,
    datasetSha256,
    outputDirectory: resolve(outputDirectory),
    mainIds,
    holdoutIds,
  };
};

const parseTask = (value: unknown, index: number): FeedbackTaskIdentity => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`BLOCKED: task ${index} is not an object`);
  const task = value as Record<string, unknown>;
  const id = task.id ?? task.task_id;
  const sourceRevision = task.sourceRevision ?? task.source_revision ?? task.repo_commit;
  const sourceDigest = task.sourceDigest ?? task.source_digest;
  const taskDigest = task.taskDigest ?? task.task_digest;
  const taskPath = task.taskPath ?? task.task_path;
  if (!nonEmpty(id) || !nonEmpty(sourceRevision) || !nonEmpty(sourceDigest) || !nonEmpty(taskDigest)
    || !revisionPattern.test(sourceRevision) || !digestPattern.test(sourceDigest) || !digestPattern.test(taskDigest)) {
    throw new Error(`BLOCKED: task ${index} must carry exact source revision, source digest and task digest`);
  }
  if (taskPath !== undefined && !nonEmpty(taskPath)) throw new Error(`BLOCKED: task ${id} has an invalid task path`);
  return {
    id,
    sourceRevision,
    sourceDigest,
    taskDigest,
    ...(taskPath === undefined ? {} : { taskPath }),
  };
};

const readTasks = async (path: string): Promise<readonly FeedbackTaskIdentity[]> => {
  const bytes = await readFile(path);
  const text = bytes.toString('utf8').trim();
  const values: readonly unknown[] = text.startsWith('[')
    ? JSON.parse(text) as readonly unknown[]
    : text.split(/\r?\n/u).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as unknown);
  const tasks = values.map(parseTask);
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`BLOCKED: duplicate dataset task ID ${task.id}`);
    ids.add(task.id);
  }
  return tasks;
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  try {
    if (existsSync(resolve(args.outputDirectory, 'task-manifest.json'))) throw new Error('BLOCKED: frozen task manifest already exists and cannot be overwritten');
    const tasks = await readTasks(args.tasksPath);
    const byId = new Map(tasks.map((task) => [task.id, task] as const));
    const select = (ids: readonly string[], name: string): readonly FeedbackTaskIdentity[] => ids.map((id) => {
      const task = byId.get(id);
      if (task === undefined) throw new Error(`BLOCKED: ${name} task ${id} is missing from the pinned dataset export`);
      return task;
    });
    const manifest = {
      schemaVersion: 1 as const,
      selection: 'main' as const,
      dataset: {
        id: 'scale-ai/swe-atlas-qna' as const,
        revision: args.datasetRevision,
        rawSha256: args.datasetSha256,
      },
      tasks: select(args.mainIds, 'main'),
      holdout: select(args.holdoutIds, 'holdout'),
    };
    const validated = validateFeedbackTaskManifest(manifest);
    if (validated._tag === 'Err') throw new Error(`BLOCKED: ${validated.error.path}: ${validated.error.message}`);
    await mkdir(args.outputDirectory, { recursive: true });
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeFile(resolve(args.outputDirectory, 'task-manifest.json'), manifestBytes);
    await writeFile(resolve(args.outputDirectory, 'selection.json'), `${JSON.stringify({
      schemaVersion: 1,
      taskInputSha256: sha256(await readFile(args.tasksPath)),
      taskManifestSha256: sha256(manifestBytes),
      mainIds: args.mainIds,
      holdoutIds: args.holdoutIds,
    }, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ status: 'READY', output: resolve(args.outputDirectory, 'task-manifest.json'), taskManifestSha256: sha256(manifestBytes) })}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'task manifest freeze failed';
    await mkdir(args.outputDirectory, { recursive: true });
    await writeFile(resolve(args.outputDirectory, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, status: 'BLOCKED', reason }, null, 2)}\n`, 'utf8');
    process.stderr.write(`${reason}\n`);
    process.exitCode = 2;
  }
};

await main();
