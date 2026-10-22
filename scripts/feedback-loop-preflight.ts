import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

const command = (name: string, args: readonly string[], environment?: Readonly<Record<string, string>>): PreflightCheck => {
  const result = spawnSync(name, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(environment === undefined ? {} : { env: { ...process.env, ...environment } }),
  });
  if (result.error !== undefined) return { status: 'not_ready', reason: `${name} unavailable` };
  if (result.status !== 0) return { status: 'not_ready', reason: `${name} exited ${String(result.status)}` };
  const identity = result.stdout.trim().split(/\r?\n/u)[0]?.trim();
  return {
    status: identity === undefined || identity.length === 0 ? 'unknown' : 'ready',
    reason: identity === undefined || identity.length === 0 ? `${name} returned no identity` : 'provider executable responded',
    ...(identity === undefined || identity.length === 0 ? {} : { identity: identity.slice(0, 200) }),
  };
};

const requiredEnvironment = (name: string, pattern?: RegExp): PreflightCheck => {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) return { status: 'not_ready', reason: `${name} is not explicitly configured` };
  if (pattern !== undefined && !pattern.test(value)) return { status: 'not_ready', reason: `${name} has an invalid identity` };
  return { status: 'ready', reason: `${name} is explicitly configured`, identity: '[set]' };
};

const embeddingCache = async (): Promise<PreflightCheck> => {
  const configured = process.env.FASTEMBED_CACHE_PATH?.trim();
  const candidates = configured === undefined || configured.length === 0
    ? ['.cache/ace-fastembed', '.venv-embedding-fast']
    : [configured];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return { status: 'ready', reason: 'embedding cache path is accessible', identity: resolve(candidate) };
    } catch {
      // Probe the next explicitly permitted local candidate.
    }
  }
  return { status: 'not_ready', reason: 'embedding cache path is not accessible' };
};

const harborDataset = (): PreflightCheck => {
  const result = spawnSync('harbor', ['datasets', 'list', '--legacy'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error !== undefined || result.status !== 0) return { status: 'not_ready', reason: 'Harbor dataset registry could not be queried' };
  return result.stdout.includes('scale-ai/swe-atlas-qna')
    ? { status: 'ready', reason: 'pinned SWE-Atlas dataset is listed by the registry', identity: 'scale-ai/swe-atlas-qna' }
    : { status: 'not_ready', reason: 'pinned scale-ai/swe-atlas-qna is not listed by the Harbor registry' };
};

const codexAuth = (): PreflightCheck => {
  const codexHome = process.env.CODEX_HOME?.trim() || `${process.env.HOME ?? ''}/.codex`;
  const authPath = resolve(codexHome, 'auth.json');
  return existsSync(authPath)
    ? { status: 'ready', reason: 'Codex auth file is present; token bytes are not retained', identity: authPath }
    : { status: 'not_ready', reason: 'Codex auth file is unavailable' };
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
    embeddingPython: command(args.embeddingPython, ['-c', 'import fastembed, onnxruntime; print(fastembed.__version__)'], {
      ...(process.env.LD_PRELOAD?.trim() === undefined ? {} : { LD_PRELOAD: process.env.LD_PRELOAD.trim() }),
      ...(process.env.ACE_EMBEDDING_LD_PRELOAD?.trim() === undefined ? {} : { LD_PRELOAD: process.env.ACE_EMBEDDING_LD_PRELOAD.trim() }),
    }),
    harbor: command('harbor', ['--version']),
    harborRun: command('harbor', ['run', '--help']),
    harborDatasets: command('harbor', ['datasets', 'list']),
    harborDatasetPinned: harborDataset(),
    codex: command('codex', ['--version']),
    codexAuth: codexAuth(),
    codexModel: requiredEnvironment('CODEX_MODEL'),
    codexReasoningEffort: requiredEnvironment('CODEX_REASONING_EFFORT', /^(?:low|medium|high)$/u),
    docker: command('docker', ['--version']),
    harborImageDigest: requiredEnvironment('ACE_HARBOR_IMAGE_DIGEST', /^sha256:[a-f0-9]{64}$/u),
  };
  checks.qdrant = await qdrant(args.qdrantUrl);
  checks.embeddingCache = await embeddingCache();
  const required = [
    'node', 'npm', 'astGrep', 'typescriptLanguageServer', 'embeddingPython', 'harbor', 'harborRun',
    'harborDatasetPinned', 'codex', 'codexAuth', 'codexModel', 'codexReasoningEffort', 'docker',
    'harborImageDigest', 'embeddingCache', 'qdrant',
  ];
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
