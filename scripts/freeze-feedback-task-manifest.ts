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
    'Usage: tsx scripts/freeze-feedback-task-manifest.ts --tasks <tasks.json|tasks.jsonl> --dataset-revision <40+hex> --dataset-sha256 <sha256> --output <external-dir> (--smoke-id <id> | --main-id <id> x10 --holdout-id <id> x10 | --holdout-only-id <id> x10)',
  );
};

const parseArgs = (): {
  readonly tasksPath: string;
  readonly datasetRevision: string;
  readonly datasetSha256: string;
  readonly datasetId: string;
  readonly outputDirectory: string;
  readonly smokeId?: string;
  readonly mainIds: readonly string[];
  readonly holdoutIds: readonly string[];
  readonly holdoutOnlyIds: readonly string[];
} => {
  const args = process.argv.slice(2);
  let tasksPath: string | undefined;
  let datasetRevision: string | undefined;
  let datasetSha256: string | undefined;
  let datasetId = 'scale-ai/swe-atlas-qna';
  let outputDirectory: string | undefined;
  let smokeId: string | undefined;
  const mainIds: string[] = [];
  const holdoutIds: string[] = [];
  const holdoutOnlyIds: string[] = [];
  while (args.length > 0) {
    const name = args.shift();
    const value = args.shift();
    if (name === '--tasks') tasksPath = value;
    else if (name === '--dataset-revision') datasetRevision = value;
    else if (name === '--dataset-sha256') datasetSha256 = value;
    else if (name === '--dataset-id') datasetId = value ?? datasetId;
    else if (name === '--output') outputDirectory = value;
    else if (name === '--smoke-id') smokeId = value;
    else if (name === '--main-id' && value !== undefined) mainIds.push(value);
    else if (name === '--holdout-id' && value !== undefined) holdoutIds.push(value);
    else if (name === '--holdout-only-id' && value !== undefined) holdoutOnlyIds.push(value);
    else return usage();
  }
  const smokeSelection = smokeId !== undefined
    && mainIds.length === 0 && holdoutIds.length === 0 && holdoutOnlyIds.length === 0;
  const mainSelection = smokeId === undefined
    && mainIds.length === 10 && holdoutIds.length === 10 && holdoutOnlyIds.length === 0;
  const holdoutSelection = smokeId === undefined
    && mainIds.length === 0 && holdoutIds.length === 0 && holdoutOnlyIds.length === 10;
  if (tasksPath === undefined || datasetRevision === undefined || datasetSha256 === undefined || outputDirectory === undefined
    || [smokeSelection, mainSelection, holdoutSelection].filter(Boolean).length !== 1
    || (datasetId !== 'scale-ai/swe-atlas-qna' && datasetId !== 'local/ace-suite')) return usage();
  const selectedIds = smokeSelection ? [smokeId!] : mainSelection ? [...mainIds, ...holdoutIds] : holdoutOnlyIds;
  if (!revisionPattern.test(datasetRevision) || !digestPattern.test(datasetSha256)
    || new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !nonEmpty(id))) return usage();
  return {
    tasksPath: resolve(tasksPath),
    datasetRevision,
    datasetSha256,
    datasetId,
    outputDirectory: resolve(outputDirectory),
    ...(smokeId === undefined ? {} : { smokeId }),
    mainIds,
    holdoutIds,
    holdoutOnlyIds,
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
    const smoke = args.smokeId === undefined ? undefined : select([args.smokeId], 'smoke')[0];
    if (args.smokeId !== undefined && smoke === undefined) throw new Error('BLOCKED: smoke task selection is empty');
    const manifest = {
      schemaVersion: 1 as const,
      selection: args.smokeId !== undefined ? 'smoke' as const : args.holdoutOnlyIds.length > 0 ? 'holdout' as const : 'main' as const,
      dataset: {
        id: args.datasetId,
        revision: args.datasetRevision,
        rawSha256: args.datasetSha256,
      },
      tasks: args.smokeId !== undefined ? [smoke] : args.holdoutOnlyIds.length > 0
        ? select(args.holdoutOnlyIds, 'holdout-only') : select(args.mainIds, 'main'),
      holdout: args.smokeId !== undefined || args.holdoutOnlyIds.length > 0 ? [] : select(args.holdoutIds, 'holdout'),
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
      ...(args.smokeId === undefined
        ? args.holdoutOnlyIds.length > 0
          ? { holdoutOnlyIds: args.holdoutOnlyIds }
          : { mainIds: args.mainIds, holdoutIds: args.holdoutIds }
        : { smokeId: args.smokeId }),
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
