#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

type ArmStatus = 'PASS' | 'BLOCKED';

type ArmResult = {
  readonly name: string;
  readonly status: ArmStatus;
  readonly reason?: string;
  readonly outputDirectory?: string;
  readonly sourceArtifact?: { readonly path: string; readonly sha256: string };
};

const usage = (): never => {
  throw new Error(
    'Usage: tsx scripts/retrieval-composition-benchmark.ts --manifest <frozen-holdout.json> --output <dir> [--runtime-root <dir>] [--mapping <id=checkout> ...] [--native-result <normalized.json>] [--repo-map-result <normalized.json>]',
  );
};

const parseArgs = (): {
  readonly manifest: string;
  readonly output: string;
  readonly runtimeRoot: string;
  readonly mappings: readonly string[];
  readonly nativeResult?: string;
  readonly repoMapResult?: string;
} => {
  const args = process.argv.slice(2);
  let manifest: string | undefined;
  let output: string | undefined;
  let runtimeRoot = resolve('.');
  let nativeResult: string | undefined;
  let repoMapResult: string | undefined;
  const mappings: string[] = [];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--manifest' || arg === '--holdout') manifest = args.shift();
    else if (arg === '--output') output = args.shift();
    else if (arg === '--runtime-root') runtimeRoot = resolve(args.shift() ?? usage());
    else if (arg === '--mapping') mappings.push(args.shift() ?? usage());
    else if (arg === '--native-result') nativeResult = resolve(args.shift() ?? usage());
    else if (arg === '--repo-map-result') repoMapResult = resolve(args.shift() ?? usage());
    else return usage();
  }
  if (manifest === undefined || output === undefined) return usage();
  return {
    manifest: resolve(manifest),
    output: resolve(output),
    runtimeRoot,
    mappings,
    ...(nativeResult === undefined ? {} : { nativeResult }),
    ...(repoMapResult === undefined ? {} : { repoMapResult }),
  };
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const externalArm = async (name: string, artifactPath: string | undefined): Promise<ArmResult> => {
  if (artifactPath === undefined) return { name, status: 'BLOCKED', reason: 'normalized external arm artifact was not supplied' };
  try {
    const bytes = await readFile(artifactPath);
    const value = JSON.parse(bytes.toString('utf8')) as { status?: unknown };
    if (value.status !== 'PASS') return { name, status: 'BLOCKED', reason: 'external arm artifact is not explicitly PASS' };
    return { name, status: 'PASS', sourceArtifact: { path: artifactPath, sha256: sha256(bytes) } };
  } catch (cause) {
    return { name, status: 'BLOCKED', reason: cause instanceof Error ? cause.message : 'external arm artifact could not be read' };
  }
};

const runAceArm = async (
  name: string,
  composition: 'legacy-hybrid' | 'repo-map-qdrant-lsp-v2',
  options: ReturnType<typeof parseArgs>,
): Promise<ArmResult> => {
  const outputDirectory = join(options.output, name);
  await mkdir(outputDirectory, { recursive: true });
  const runner = resolve('scripts/retrieval-benchmark-runner.ts');
  const tsx = resolve('node_modules/.bin/tsx');
  const args = [
    runner,
    options.manifest,
    outputDirectory,
    '--runtime-root',
    options.runtimeRoot,
    '--strategy',
    'dense',
    ...options.mappings,
  ];
  try {
    const result = await execFileAsync(tsx, args, {
      cwd: resolve('.'),
      env: { ...process.env, ACE_RETRIEVAL_COMPOSITION: composition },
      maxBuffer: 8 * 1024 * 1024,
    });
    await writeFile(join(outputDirectory, 'runner.stdout.log'), result.stdout, 'utf8');
    await writeFile(join(outputDirectory, 'runner.stderr.log'), result.stderr, 'utf8');
    return { name, status: 'PASS', outputDirectory };
  } catch (cause) {
    const error = cause as { code?: number; stdout?: string; stderr?: string };
    await writeFile(join(outputDirectory, 'runner.stdout.log'), error.stdout ?? '', 'utf8');
    await writeFile(join(outputDirectory, 'runner.stderr.log'), error.stderr ?? String(cause), 'utf8');
    return {
      name,
      status: 'BLOCKED',
      reason: `runner exited ${typeof error.code === 'number' ? error.code : 1}`,
      outputDirectory,
    };
  }
};

const run = async (): Promise<void> => {
  const options = parseArgs();
  await mkdir(options.output, { recursive: true });
  const [native, repoMapOnly, currentAce, newComposition] = await Promise.all([
    externalArm('native', options.nativeResult),
    externalArm('repomap-only', options.repoMapResult),
    runAceArm('current-ace', 'legacy-hybrid', options),
    runAceArm('new-composition', 'repo-map-qdrant-lsp-v2', options),
  ]);
  const arms = [native, currentAce, repoMapOnly, newComposition];
  const summary = {
    schemaVersion: 2,
    status: arms.every((arm) => arm.status === 'PASS') ? 'PASS' : 'BLOCKED',
    arms,
    requiredArms: ['native', 'current-ace', 'repomap-only', 'new-composition'],
    note: 'PASS requires valid completed artifacts for all four arms. This script does not synthesize native results, RepoMap-only results, quality, or token savings.',
  };
  await writeFile(join(options.output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== 'PASS') process.exitCode = 2;
};

await run();
