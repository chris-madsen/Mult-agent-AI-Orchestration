import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type CheckStatus = 'ready' | 'not_ready' | 'unknown';

interface PreflightCheck {
  readonly status: CheckStatus;
  readonly reason: string;
  readonly identity?: string;
}

interface PreflightManifest {
  readonly schemaVersion: 1;
  readonly status: 'READY' | 'BLOCKED';
  readonly generatedAt: string;
  readonly sourceCommit: string;
  readonly runtimeRoot: string;
  readonly checks: Readonly<Record<string, PreflightCheck>>;
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const command = (name: string, args: readonly string[]): PreflightCheck => {
  const result = spawnSync(name, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error !== undefined) return { status: 'not_ready', reason: `${name} unavailable` };
  if (result.status !== 0) return { status: 'not_ready', reason: `${name} exited ${String(result.status)}` };
  const identity = result.stdout.trim().split(/\r?\n/u)[0]?.trim();
  return {
    status: identity === undefined || identity.length === 0 ? 'unknown' : 'ready',
    reason: identity === undefined || identity.length === 0 ? `${name} returned no identity` : 'provider executable responded',
    ...(identity === undefined || identity.length === 0 ? {} : { identity: identity.slice(0, 200) }),
  };
};

const gitCommit = (): string => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

const qdrant = async (url: string): Promise<PreflightCheck> => {
  try {
    const response = await fetch(`${url.replace(/\/$/u, '')}/collections`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { status: 'not_ready', reason: `Qdrant returned HTTP ${response.status}` };
    return { status: 'ready', reason: 'Qdrant collections endpoint responded', identity: url };
  } catch (error) {
    return { status: 'not_ready', reason: error instanceof Error ? error.message : 'Qdrant request failed' };
  }
};

const parseArgs = (): { readonly outputDirectory: string; readonly embeddingPython: string; readonly qdrantUrl: string } => {
  const args = process.argv.slice(2);
  let outputDirectory = process.env.ACE_FEEDBACK_OUTPUT?.trim() || 'artifacts/feedback/preflight';
  let embeddingPython = process.env.ACE_EMBEDDING_PYTHON?.trim() || '.venv-embedding-fast/bin/python';
  let qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
  while (args.length > 0) {
    const current = args.shift();
    const value = args.shift();
    if (current === '--output' && value !== undefined) outputDirectory = value;
    else if (current === '--embedding-python' && value !== undefined) embeddingPython = value;
    else if (current === '--qdrant-url' && value !== undefined) qdrantUrl = value;
    else throw new Error('Usage: tsx scripts/feedback-loop-preflight.ts [--output dir] [--embedding-python path] [--qdrant-url url]');
  }
  return { outputDirectory: resolve(outputDirectory), embeddingPython, qdrantUrl };
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const checks: Record<string, PreflightCheck> = {
    node: command('node', ['--version']),
    npm: command('npm', ['--version']),
    astGrep: command('./node_modules/.bin/ast-grep', ['--version']),
    typescriptLanguageServer: command('./node_modules/.bin/typescript-language-server', ['--version']),
    embeddingPython: command(args.embeddingPython, ['-c', 'import fastembed, onnxruntime; print(fastembed.__version__)']),
    harbor: command('harbor', ['--version']),
    harborRun: command('harbor', ['run', '--help']),
    harborDatasets: command('harbor', ['datasets', 'list']),
  };
  checks.qdrant = await qdrant(args.qdrantUrl);
  const required = ['node', 'npm', 'astGrep', 'typescriptLanguageServer', 'embeddingPython', 'harbor', 'harborRun', 'qdrant'];
  const blocked = required.filter((name) => checks[name]?.status !== 'ready');
  const manifest: PreflightManifest = {
    schemaVersion: 1,
    status: blocked.length === 0 ? 'READY' : 'BLOCKED',
    generatedAt: new Date().toISOString(),
    sourceCommit: gitCommit(),
    runtimeRoot: resolve('.'),
    checks,
  };
  await mkdir(args.outputDirectory, { recursive: true });
  await writeFile(resolve(args.outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    status: manifest.status,
    blocked,
    output: resolve(args.outputDirectory, 'manifest.json'),
    manifestSha256: sha256(`${JSON.stringify(manifest, null, 2)}\n`),
  })}\n`);
  if (blocked.length > 0) process.exitCode = 2;
};

await main();
