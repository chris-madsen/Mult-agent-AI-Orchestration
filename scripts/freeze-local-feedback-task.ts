import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { validateFeedbackTaskManifest } from '../src/domain/feedback-loop-experiment.js';

interface TreeEntry {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const gitBytes = (root: string, args: readonly string[]): Buffer => execFileSync('git', ['-C', root, ...args]);
const gitText = (root: string, args: readonly string[]): string => gitBytes(root, args).toString('utf8').trim();

const usage = (): never => {
  throw new Error('Usage: tsx scripts/freeze-local-feedback-task.ts --source-root <checkout> --task-path <relative-task-dir> --output <external-dir>');
};

const parseArgs = (): { readonly sourceRoot: string; readonly taskPath: string; readonly output: string } => {
  const values = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  while (values.length > 0) {
    const name = values.shift();
    const value = values.shift();
    if (name === undefined || value === undefined) return usage();
    parsed[name] = value;
  }
  if (parsed['--source-root'] === undefined || parsed['--task-path'] === undefined || parsed['--output'] === undefined) return usage();
  return {
    sourceRoot: resolve(parsed['--source-root']),
    taskPath: parsed['--task-path'],
    output: resolve(parsed['--output']),
  };
};

const containedRelativePath = (root: string, candidate: string): string => {
  const value = relative(resolve(root), resolve(candidate)).split('\\').join('/');
  if (isAbsolute(value) || value === '..' || value.startsWith('../') || value === '') {
    throw new Error('BLOCKED: local task path must remain inside the source checkout');
  }
  return value;
};

const treeEntries = (root: string, revision: string, prefix?: string): readonly TreeEntry[] => {
  const paths = gitText(root, [
    'ls-tree', '-r', '-z', '--name-only', revision,
    ...(prefix === undefined ? [] : [`${prefix}/`]),
  ]).split('\0').filter((path) => path.length > 0).sort((left, right) => left.localeCompare(right));
  if (paths.length === 0) throw new Error(`BLOCKED: Git tree is empty: ${prefix ?? '<root>'}`);
  return paths.map((path) => {
    const bytes = gitBytes(root, ['show', `${revision}:${path}`]);
    return { path, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
  });
};

const treeDigest = (identity: string, revision: string, entries: readonly TreeEntry[]): string =>
  sha256(new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 1, identity, revision, entries }, null, 2)}\n`));

const main = async (): Promise<void> => {
  const args = parseArgs();
  try {
    const actualRoot = resolve(gitText(args.sourceRoot, ['rev-parse', '--show-toplevel']));
    if (realpathSync(actualRoot) !== realpathSync(args.sourceRoot)) throw new Error('BLOCKED: --source-root must be the Git checkout root');
    if (gitText(args.sourceRoot, ['status', '--porcelain=v1', '--untracked-files=all']).length > 0) {
      throw new Error('BLOCKED: local task source checkout is dirty');
    }
    const taskPath = containedRelativePath(args.sourceRoot, join(args.sourceRoot, args.taskPath));
    const taskDirectory = resolve(args.sourceRoot, taskPath);
    if (!existsSync(join(taskDirectory, 'task.toml'))) throw new Error(`BLOCKED: task.toml is missing: ${taskPath}`);
    const outputRelative = relative(args.sourceRoot, args.output);
    if (!isAbsolute(outputRelative) && outputRelative !== '..' && !outputRelative.startsWith('../')) {
      throw new Error('BLOCKED: frozen local manifest output must remain outside the source checkout');
    }
    await mkdir(args.output, { recursive: true });
    const actualOutputRelative = relative(realpathSync(args.sourceRoot), realpathSync(args.output));
    if (!isAbsolute(actualOutputRelative) && actualOutputRelative !== '..' && !actualOutputRelative.startsWith('../')) {
      throw new Error('BLOCKED: frozen local manifest output resolves into the source checkout');
    }
    if (existsSync(join(args.output, 'task-manifest.json'))) throw new Error('BLOCKED: frozen local manifest already exists');

    const revision = gitText(args.sourceRoot, ['rev-parse', 'HEAD']);
    if (!/^[a-f0-9]{40,64}$/iu.test(revision)) throw new Error('BLOCKED: source revision is not an exact Git commit');
    // Freeze exactly the committed task definition, never a symlink target or
    // a working-tree file that might have changed after the cleanliness check.
    const taskToml = gitBytes(args.sourceRoot, ['show', `${revision}:${taskPath}/task.toml`]).toString('utf8');
    const taskSection = /^\[task\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/mu.exec(taskToml)?.[1];
    const taskName = taskSection === undefined ? undefined : /^\s*name\s*=\s*"([^"]+)"\s*$/mu.exec(taskSection)?.[1];
    if (taskName === undefined || taskName.trim().length === 0) throw new Error('BLOCKED: local task.toml has no [task].name');

    const sourceEntries = treeEntries(args.sourceRoot, revision);
    const taskEntries = treeEntries(args.sourceRoot, revision, taskPath);
    const sourceDigest = treeDigest('local/ace-suite', revision, sourceEntries);
    const taskDigest = treeDigest(taskName, revision, taskEntries);
    const manifest = {
      schemaVersion: 1 as const,
      selection: 'smoke' as const,
      dataset: {
        id: 'local/ace-suite' as const,
        revision,
        rawSha256: treeDigest('local/ace-suite-dataset', revision, taskEntries),
      },
      tasks: [{ id: taskName, sourceRevision: revision, sourceDigest, taskDigest, taskPath }],
      holdout: [],
    };
    const checked = validateFeedbackTaskManifest(manifest);
    if (checked._tag === 'Err') throw new Error(`BLOCKED: ${checked.error.path}: ${checked.error.message}`);
    await mkdir(args.output, { recursive: true });
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeFile(join(args.output, 'task-manifest.json'), manifestBytes);
    await writeFile(join(args.output, 'selection.json'), `${JSON.stringify({
      schemaVersion: 1,
      datasetId: manifest.dataset.id,
      taskPath,
      sourceRevision: revision,
      sourceDigest,
      taskDigest,
      taskManifestSha256: sha256(manifestBytes),
    }, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ status: 'READY', output: join(args.output, 'task-manifest.json'), taskName, sourceRevision: revision, taskManifestSha256: sha256(manifestBytes) })}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'local feedback task freeze failed';
    // Never write even a BLOCKED manifest through a symlink into the source.
    // The protected checkout is a frame condition on failure paths as well.
    if (existsSync(args.sourceRoot)) {
      const physicalRoot = realpathSync(args.sourceRoot);
      await mkdir(args.output, { recursive: true });
      const relation = relative(physicalRoot, realpathSync(args.output));
      if (isAbsolute(relation) || relation === '..' || relation.startsWith('../')) {
        await writeFile(join(args.output, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, status: 'BLOCKED', reason }, null, 2)}\n`, 'utf8');
      }
    }
    process.stderr.write(`${reason}\n`);
    process.exitCode = 2;
  }
};

await main();
