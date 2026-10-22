import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type JsonObject = Record<string, unknown>;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown, path: string): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`BLOCKED: ${path} must be an object`);
  return value as JsonObject;
};
const string = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`BLOCKED: ${path} must be a non-empty string`);
  return value;
};
const revision = (value: string): boolean => /^[a-f0-9]{40,64}$/iu.test(value);

const usage = (): never => {
  throw new Error('Usage: tsx scripts/harbor-task-identities.ts --registry <registry.json> --dataset-id scale-ai/swe-atlas-qna --version 1.0 --source-root <checkout> --output <tasks.jsonl>');
};

const args = (): { readonly registryPath: string; readonly datasetId: string; readonly version: string; readonly sourceRoot: string; readonly outputPath: string } => {
  const values = process.argv.slice(2);
  const result: Record<string, string> = {};
  while (values.length > 0) {
    const name = values.shift();
    const value = values.shift();
    if (name === undefined || value === undefined) return usage();
    result[name] = value;
  }
  if (result['--registry'] === undefined || result['--dataset-id'] === undefined || result['--version'] === undefined
    || result['--source-root'] === undefined || result['--output'] === undefined) return usage();
  return {
    registryPath: resolve(result['--registry']),
    datasetId: result['--dataset-id'],
    version: result['--version'],
    sourceRoot: resolve(result['--source-root']),
    outputPath: resolve(result['--output']),
  };
};

const gitBytes = (root: string, gitArgs: readonly string[]): Buffer => execFileSync('git', ['-C', root, ...gitArgs]);
const gitText = (root: string, gitArgs: readonly string[]): string => gitBytes(root, gitArgs).toString('utf8').trim();

const treeEntries = (root: string, revisionValue: string, prefix = ''): readonly { readonly path: string; readonly sizeBytes: number; readonly sha256: string }[] => {
  const paths = gitText(root, ['ls-tree', '-r', '-z', '--name-only', revisionValue, ...(prefix.length === 0 ? [] : [`${prefix}/`])])
    .split('\0').filter((path) => path.length > 0).sort((left, right) => left.localeCompare(right));
  return paths.map((path) => {
    const bytes = gitBytes(root, ['show', `${revisionValue}:${path}`]);
    return { path, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
  });
};

const treeDigest = (identity: string, revisionValue: string, entries: readonly { readonly path: string; readonly sizeBytes: number; readonly sha256: string }[]): string =>
  sha256(new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 1, identity, revision: revisionValue, entries }, null, 2)}\n`));

const main = async (): Promise<void> => {
  const configuration = args();
  try {
    const registryBytes = await readFile(configuration.registryPath);
    const registry = JSON.parse(registryBytes.toString('utf8')) as unknown;
    if (!Array.isArray(registry)) throw new Error('BLOCKED: Harbor registry JSON must be an array');
    const dataset = registry.map((item, index) => object(item, `registry[${index}]`))
      .find((item) => item.name === configuration.datasetId && item.version === configuration.version);
    if (dataset === undefined) throw new Error(`BLOCKED: dataset ${configuration.datasetId}@${configuration.version} is absent from pinned registry JSON`);
    if (!Array.isArray(dataset.tasks) || dataset.tasks.length === 0) throw new Error('BLOCKED: pinned Harbor dataset has no tasks');
    const sourceRevision = gitText(configuration.sourceRoot, ['rev-parse', 'HEAD']);
    if (!revision(sourceRevision)) throw new Error('BLOCKED: source checkout revision is invalid');
    const expectedGitCommit = string(object(dataset.tasks[0], 'dataset.tasks[0]').git_commit_id, 'dataset.tasks[0].git_commit_id');
    if (sourceRevision !== expectedGitCommit) throw new Error(`BLOCKED: source checkout is ${sourceRevision}, registry requires ${expectedGitCommit}`);
    const sourceEntries = treeEntries(configuration.sourceRoot, sourceRevision);
    const sourceDigest = treeDigest(configuration.datasetId, sourceRevision, sourceEntries);
    const rows = dataset.tasks.map((item, index) => {
      const task = object(item, `dataset.tasks[${index}]`);
      const id = string(task.name, `dataset.tasks[${index}].name`);
      const taskRevision = string(task.git_commit_id, `dataset.tasks[${index}].git_commit_id`);
      const path = string(task.path, `dataset.tasks[${index}].path`);
      const gitUrl = string(task.git_url, `dataset.tasks[${index}].git_url`);
      if (taskRevision !== sourceRevision || gitUrl !== 'https://github.com/scaleapi/SWE-Atlas.git') {
        throw new Error(`BLOCKED: task ${id} is not bound to the pinned SWE-Atlas source`);
      }
      const taskEntries = treeEntries(configuration.sourceRoot, sourceRevision, path);
      if (taskEntries.length === 0) throw new Error(`BLOCKED: task ${id} source path is empty or missing: ${path}`);
      return {
        id,
        sourceRevision,
        sourceDigest,
        taskDigest: treeDigest(id, sourceRevision, taskEntries),
        taskPath: path,
      };
    });
    const ids = new Set(rows.map((row) => row.id));
    if (ids.size !== rows.length) throw new Error('BLOCKED: pinned Harbor dataset contains duplicate task IDs');
    await mkdir(resolve(configuration.outputPath, '..'), { recursive: true });
    const output = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
    await writeFile(configuration.outputPath, output, 'utf8');
    await writeFile(resolve(configuration.outputPath, '..', 'task-identities-manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      status: 'READY',
      datasetId: configuration.datasetId,
      version: configuration.version,
      registrySha256: sha256(registryBytes),
      sourceRevision,
      sourceDigest,
      taskCount: rows.length,
      outputSha256: sha256(new TextEncoder().encode(output)),
    }, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ status: 'READY', taskCount: rows.length, sourceRevision, sourceDigest, output: configuration.outputPath })}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Harbor task identity export failed';
    await mkdir(resolve(configuration.outputPath, '..'), { recursive: true });
    await writeFile(resolve(configuration.outputPath, '..', 'task-identities-manifest.json'), `${JSON.stringify({ schemaVersion: 1, status: 'BLOCKED', reason }, null, 2)}\n`, 'utf8');
    process.stderr.write(`${reason}\n`);
    process.exitCode = 2;
  }
};

await main();
