import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  repoBenchSourceManifestExclusions,
  repoBenchSourceManifestSha256,
  type RepoBenchManifest,
} from '../src/domain/repobench-r.js';
import { retrievalSourceManifestExcludedPath } from '../src/domain/retrieval-source-manifest.js';

type Config = 'python_cff' | 'python_cfr' | 'java_cff' | 'java_cfr';
type Split = 'test_easy' | 'test_hard' | 'train_easy' | 'train_hard';

const revisionPattern = /^[a-f0-9]{40,64}$/iu;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const usage = (): never => {
  throw new Error(
    'Usage: tsx scripts/repobench-r-acquire.ts --records-url <official-url> --revision <40+hex> --config <config> --split <split> --output <external-dir> --source-revision <repository-id>=<40+hex> <repository-id>=<checkout-root> [...mappings]',
  );
};

const parseArgs = (): {
  readonly recordsUrl: string;
  readonly revision: string;
  readonly config: Config;
  readonly split: Split;
  readonly outputDirectory: string;
  readonly mappings: readonly string[];
  readonly sourceRevisions: ReadonlyMap<string, string>;
} => {
  const args = process.argv.slice(2);
  let recordsUrl: string | undefined;
  let revision: string | undefined;
  let config: Config | undefined;
  let split: Split | undefined;
  let outputDirectory = process.env.REPOBENCH_OUTPUT?.trim() || 'artifacts/feedback/repobench-r';
  const mappings: string[] = [];
  const sourceRevisions = new Map<string, string>();
  while (args.length > 0) {
    const current = args.shift();
    const value = args[0];
    if (current === '--records-url') {
      args.shift();
      recordsUrl = value;
    } else if (current === '--revision') {
      args.shift();
      revision = value;
    } else if (current === '--config') {
      args.shift();
      config = value as Config | undefined;
    } else if (current === '--split') {
      args.shift();
      split = value as Split | undefined;
    } else if (current === '--output') {
      args.shift();
      outputDirectory = value ?? usage();
    } else if (current === '--source-revision') {
      args.shift();
      if (value === undefined) return usage();
      const separator = value.indexOf('=');
      if (separator <= 0 || separator === value.length - 1 || !revisionPattern.test(value.slice(separator + 1))) return usage();
      sourceRevisions.set(value.slice(0, separator), value.slice(separator + 1));
    } else if (current !== undefined) mappings.push(current);
  }
  if (recordsUrl === undefined || revision === undefined || config === undefined || split === undefined) return usage();
  if (!/^https:\/\//u.test(recordsUrl) || !revisionPattern.test(revision)
    || !['python_cff', 'python_cfr', 'java_cff', 'java_cfr'].includes(config)
    || !['test_easy', 'test_hard', 'train_easy', 'train_hard'].includes(split)) return usage();
  return { recordsUrl, revision, config, split, outputDirectory: resolve(outputDirectory), mappings, sourceRevisions };
};

const git = (root: string, args: readonly string[], encoding: BufferEncoding = 'utf8'): Buffer =>
  execFileSync('git', ['-C', root, ...args], { encoding: encoding as 'buffer' }) as unknown as Buffer;
const gitText = (root: string, args: readonly string[]): string => git(root, args).toString('utf8').trim();

const repositoryManifest = (id: string, root: string, expectedRevision: string | undefined): {
  readonly id: string;
  readonly revision: string;
  readonly sourceManifestSha256: string;
  readonly checkoutRoot: string;
} => {
  if (!existsSync(root)) throw new Error(`BLOCKED: missing source checkout for ${id}: ${root}`);
  const actualRevision = gitText(root, ['rev-parse', 'HEAD']);
  if (!revisionPattern.test(actualRevision)) throw new Error(`BLOCKED: source checkout ${id} returned an invalid commit identity`);
  if (expectedRevision !== undefined && actualRevision !== expectedRevision) {
    throw new Error(`BLOCKED: source revision mismatch for ${id}: expected ${expectedRevision}, got ${actualRevision}`);
  }
  if (gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']).length > 0) {
    throw new Error(`BLOCKED: source checkout ${id} is dirty; exact frozen source bytes are required`);
  }
  const paths = git(root, ['ls-tree', '-r', '-z', '--name-only', actualRevision]).toString('utf8')
    .split('\0').filter((path) => path.length > 0).sort((left, right) => left.localeCompare(right));
  const entries: Array<{ readonly path: string; readonly sizeBytes: number; readonly sha256: string }> = [];
  for (const path of paths) {
    if (retrievalSourceManifestExcludedPath(path)) continue;
    const bytes = git(root, ['show', `${actualRevision}:${path}`]);
    if (bytes.includes(0)) continue;
    entries.push({ path, sizeBytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return {
    id,
    revision: actualRevision,
    sourceManifestSha256: repoBenchSourceManifestSha256(id, actualRevision, entries),
    checkoutRoot: resolve(root),
  };
};

const parseMapping = (value: string): { readonly id: string; readonly root: string } => {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) throw new Error(`BLOCKED: invalid repository mapping ${value}`);
  return { id: value.slice(0, separator), root: resolve(value.slice(separator + 1)) };
};

const blocked = async (outputDirectory: string, reason: string): Promise<never> => {
  await mkdir(outputDirectory, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    status: 'BLOCKED',
    dataset: 'tianyang/repobench-r',
    reason,
    syntheticRepositories: false,
  };
  await writeFile(resolve(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stderr.write(`${reason}\n`);
  process.exitCode = 2;
  throw new Error(reason);
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  try {
    if (args.mappings.length === 0) throw new Error('BLOCKED: at least one exact source checkout mapping is required; RepoBench records do not carry source snapshots');
    if (args.sourceRevisions.size !== args.mappings.length) throw new Error('BLOCKED: every source checkout requires an explicit pinned source revision; current dataset metadata does not provide one');
    const response = await fetch(args.recordsUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`BLOCKED: records URL returned HTTP ${response.status}`);
    const recordsBytes = new Uint8Array(await response.arrayBuffer());
    if (recordsBytes.byteLength === 0) throw new Error('BLOCKED: records response was empty');
    const repositoryInputs = args.mappings.map(parseMapping);
    const repositoryIds = new Set<string>();
    const repositories: Array<{ readonly id: string; readonly revision: string; readonly sourceManifestSha256: string }> = [];
    const checkoutRoots: Record<string, string> = {};
    for (const input of repositoryInputs) {
      if (repositoryIds.has(input.id)) throw new Error(`BLOCKED: duplicate repository id ${input.id}`);
      repositoryIds.add(input.id);
      const expectedRevision = args.sourceRevisions.get(input.id);
      if (expectedRevision === undefined) throw new Error(`BLOCKED: source revision is not pinned for ${input.id}`);
      const identity = repositoryManifest(input.id, input.root, expectedRevision);
      repositories.push({ id: identity.id, revision: identity.revision, sourceManifestSha256: identity.sourceManifestSha256 });
      checkoutRoots[input.id] = identity.checkoutRoot;
    }
    const manifest: RepoBenchManifest = {
      schemaVersion: 1,
      dataset: {
        datasetId: 'tianyang/repobench-r',
        config: args.config,
        split: args.split,
        revision: args.revision,
        recordsSha256: sha256(recordsBytes),
      },
      repositories,
    };
    await mkdir(resolve(args.outputDirectory, 'source-snapshots'), { recursive: true });
    await writeFile(resolve(args.outputDirectory, 'records.raw'), recordsBytes);
    const acquisitionManifest = {
      ...manifest,
      dataset: { ...manifest.dataset, rawRecordsSha256: manifest.dataset.recordsSha256 },
    };
    await writeFile(resolve(args.outputDirectory, 'manifest.json'), `${JSON.stringify(acquisitionManifest, null, 2)}\n`, 'utf8');
    await writeFile(resolve(args.outputDirectory, 'source-snapshots.json'), `${JSON.stringify({
      schemaVersion: 1,
      repositories: checkoutRoots,
      exclusions: repoBenchSourceManifestExclusions,
    }, null, 2)}\n`, 'utf8');
    await writeFile(resolve(args.outputDirectory, 'acquisition.json'), `${JSON.stringify({
      schemaVersion: 1,
      status: 'READY',
      recordsUrl: args.recordsUrl,
      recordsSha256: manifest.dataset.recordsSha256,
      sourceManifestSha256: Object.fromEntries(repositories.map((repository) => [repository.id, repository.sourceManifestSha256])),
    }, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ status: 'READY', output: args.outputDirectory, recordsSha256: manifest.dataset.recordsSha256 })}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'RepoBench acquisition failed';
    await blocked(args.outputDirectory, reason).catch(() => undefined);
  }
};

await main();
